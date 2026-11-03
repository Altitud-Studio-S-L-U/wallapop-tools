/**
 * Background Service Worker - Wallapop Tools v5.0
 *
 * Central hub: receives tokens from interceptor, stores in session storage,
 * executes all API calls, handles rate limiting, alarms, badge updates,
 * activity logging, statistics, and item tracking.
 *
 * Features: republish all/selected, batch price adjust, auto-republish,
 * single item price edit, CSV export.
 */

importScripts('../utils/wallapop-api.js');

// ============================================================
// STATE
// ============================================================

const COOLDOWN_MS = 5 * 60 * 1000;
let _lastRepublishStart = 0;
let _operationInProgress = false;
let _cachedItems = null;
let _verifiedSession = null;
let _sessionRevision = 0;
let _itemsRevision = 0;
let _sessionUpdates = Promise.resolve();
let _sessionError = null;
let _hostname = 'es.wallapop.com';

// ============================================================
// SESSION TOKEN HELPERS
// ============================================================

async function readSession() {
  const data = await chrome.storage.session.get(['token', 'deviceId', 'userId', 'hostname']);
  return {
    token: data.token || null,
    deviceId: data.deviceId || null,
    userId: data.userId || null,
    hostname: data.hostname || _hostname,
  };
}

function queueSessionUpdate(action) {
  const update = _sessionUpdates.then(action);
  // The caller receives the failure; subsequent captures must still be usable.
  _sessionUpdates = update.catch(() => {});
  return update;
}

async function getSession() {
  while (true) {
    const pending = _sessionUpdates;
    await pending;
    if (_sessionError) throw _sessionError;
    const revision = _sessionRevision;
    const session = await readSession();
    if (pending === _sessionUpdates && revision === _sessionRevision) {
      return { ...session, revision };
    }
  }
}

function sessionChangedError() {
  return new Error(chrome.i18n.getMessage('errorSessionChanged'));
}

function matchesSession(current, expected) {
  return _sessionRevision === expected.revision && current.token === expected.token
    && current.deviceId === expected.deviceId && current.hostname === expected.hostname;
}

async function assertCurrentSession(expected) {
  const current = await getSession();
  if (!matchesSession(current, expected)) throw sessionChangedError();
}

function updateForSession(expected, action) {
  return queueSessionUpdate(async () => {
    if (_sessionError || !matchesSession(await readSession(), expected)) throw sessionChangedError();
    return action();
  });
}

function invalidateItems() {
  _cachedItems = null;
  _itemsRevision++;
}

async function setSession(fields) {
  await chrome.storage.session.set(fields);
  if (fields.hostname) {
    await updateOriginRules(fields.hostname);
  }
}

// Rewrite Origin + Referer so Wallapop's API accepts PUT/POST from the extension
async function updateOriginRules(hostname) {
  const origin = `https://${hostname}`;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: origin },
            { header: 'Referer', operation: 'set', value: origin + '/' },
          ],
        },
        condition: {
          urlFilter: 'https://api.wallapop.com/*',
          resourceTypes: ['xmlhttprequest', 'other'],
        },
      }],
    });
  } catch (err) {
    console.error('[WallapopTools] Failed to set Origin rules:', err);
  }
}

async function ensureUserId() {
  const session = await getSession();
  if (!session.token) throw new Error(chrome.i18n.getMessage('errorNoToken'));

  if (_verifiedSession && matchesSession(_verifiedSession, session)) {
    return { ...session, userId: _verifiedSession.userId };
  }

  let profile;
  try {
    profile = await WallapopAPI.getMyProfile(session.token, session.deviceId);
  } catch (error) {
    await handleSessionError(error, session);
  }
  if (profile?.id) {
    await updateForSession(session, async () => {
      await setSession({ userId: profile.id });
      _verifiedSession = { ...session, userId: profile.id };
    });
    await assertCurrentSession(session);
    return { ...session, userId: profile.id };
  }

  await assertCurrentSession(session);
  throw new Error(chrome.i18n.getMessage('errorProfileFailed'));
}

async function handleSessionError(error, session) {
  if (error.message === 'TOKEN_EXPIRED') {
    if (!await clearToken(session)) throw sessionChangedError();
    throw new Error(chrome.i18n.getMessage('errorTokenExpired'));
  }
  await assertCurrentSession(session);
  throw error;
}

async function captureSession(token, deviceId, hostname) {
  let shouldLoad = false;
  await queueSessionUpdate(async () => {
    try {
      const current = await readSession();
      const nextDeviceId = deviceId || (current.token === token ? current.deviceId : null);
      const changed = current.token !== token || current.deviceId !== nextDeviceId || current.hostname !== hostname;
      shouldLoad = changed || !_verifiedSession;
      if (changed) {
        _sessionRevision++;
        _verifiedSession = null;
        invalidateItems();
        await chrome.storage.local.remove(['wallapop_item_count', 'last_republish']);
        updateBadge(0);
      }
      await setSession({ token, deviceId: nextDeviceId, hostname, ...(changed ? { userId: null } : {}) });
      _hostname = hostname;
      _sessionError = null;
    } catch (error) {
      _sessionError = new Error(chrome.i18n.getMessage('errorProfileFailed'));
      _sessionRevision++;
      _verifiedSession = null;
      invalidateItems();
      throw error;
    }
  });
  if (shouldLoad) await loadAllItems();
}

function captureHostname(sender) {
  try {
    if (chrome.runtime.id && sender.id !== chrome.runtime.id) return null;
    const url = new URL(sender.url);
    const origins = ['https://es.wallapop.com', 'https://it.wallapop.com', 'https://fr.wallapop.com', 'https://pt.wallapop.com'];
    if (!origins.includes(url.origin)) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

// ============================================================
// INPUT VALIDATION
// ============================================================

function validatePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0 || Math.abs(num) > 50) {
    throw new Error(chrome.i18n.getMessage('errorPercentInvalid'));
  }
  return num;
}

function validateItemId(id) {
  if (id == null || id === '') throw new Error(chrome.i18n.getMessage('errorInvalidItemId'));
  return String(id);
}

function validatePrice(value) {
  const price = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(chrome.i18n.getMessage('errorPriceInvalid'));
  }
  return price;
}

// ============================================================
// ACTIVITY LOG & STATS
// ============================================================

async function logActivity(entry) {
  const data = await chrome.storage.local.get(['activity_log']);
  const log = data.activity_log || [];
  log.unshift({ ...entry, timestamp: Date.now() });
  await chrome.storage.local.set({ activity_log: log.slice(0, 50) });
}

async function updateRepublishStats(success, failed) {
  const data = await chrome.storage.local.get(['stats']);
  const stats = data.stats || { totalRepublishes: 0, totalPriceChanges: 0, totalSuccess: 0, totalFailed: 0 };
  stats.totalRepublishes += (success + failed);
  stats.totalSuccess += success;
  stats.totalFailed += failed;
  await chrome.storage.local.set({ stats });
}

async function updatePriceStats(success, failed) {
  const data = await chrome.storage.local.get(['stats']);
  const stats = data.stats || { totalRepublishes: 0, totalPriceChanges: 0, totalSuccess: 0, totalFailed: 0 };
  stats.totalPriceChanges += (success + failed);
  stats.totalSuccess += success;
  stats.totalFailed += failed;
  await chrome.storage.local.set({ stats });
}

// ============================================================
// ITEM TRACKING (days since listed)
// ============================================================

async function updateItemTracking(items) {
  const data = await chrome.storage.local.get(['item_tracking']);
  const tracking = data.item_tracking || {};
  const now = Date.now();

  for (const item of items) {
    const id = String(item.id);
    const price = WallapopAPI.getItemPrice(item);
    const creationDate = item.creation_date || item.modified_date || item.publish_date;

    if (!tracking[id]) {
      tracking[id] = {
        firstSeen: creationDate ? new Date(creationDate).getTime() : now,
        lastPrice: price,
      };
    } else {
      if (tracking[id].lastPrice !== price) {
        tracking[id].lastPrice = price;
      }
    }
  }

  const currentIds = new Set(items.map((i) => String(i.id)));
  for (const id of Object.keys(tracking)) {
    if (!currentIds.has(id)) {
      delete tracking[id];
    }
  }

  await chrome.storage.local.set({ item_tracking: tracking });
  return tracking;
}

function getDaysListed(trackingEntry) {
  if (!trackingEntry?.firstSeen) return 0;
  return Math.floor((Date.now() - trackingEntry.firstSeen) / 86400000);
}

// ============================================================
// CORE OPERATIONS
// ============================================================

async function loadAllItems(expectedSession) {
  const session = expectedSession || await ensureUserId();
  await assertCurrentSession(session);
  const revision = _itemsRevision;
  let items;
  try {
    items = await WallapopAPI.getAllMyItems(session.token, session.deviceId, session.userId);
  } catch (error) {
    await handleSessionError(error, session);
  }
  await updateForSession(session, async () => {
    if (revision !== _itemsRevision) throw new Error(chrome.i18n.getMessage('errorOperationInProgress'));
    _cachedItems = items;
    await chrome.storage.local.set({ wallapop_item_count: items.length });
    updateBadge(items.length);
    await updateItemTracking(items);
  });
  await assertCurrentSession(session);
  return items;
}

async function getSelectedIds(session, itemIds) {
  const ids = itemIds.map(validateItemId);
  const items = _cachedItems || await loadAllItems(session);
  await assertCurrentSession(session);
  const available = new Set(items.map((item) => String(item.id)));
  if (ids.some((id) => !available.has(id))) {
    throw new Error(chrome.i18n.getMessage('errorInvalidItemId'));
  }
  return ids;
}

async function writeItemPrice(session, itemId, newPrice) {
  await updateForSession(session, invalidateItems);
  try {
    await assertCurrentSession(session);
    await WallapopAPI.updateItemPrice(session.token, session.deviceId, itemId, newPrice, session.hostname,
      () => assertCurrentSession(session));
    await assertCurrentSession(session);
  } finally {
    // A failed response can follow a successful remote write. Re-read the server
    // before the next operation, and discard reads started during this write.
    if (_sessionRevision === session.revision) invalidateItems();
  }
}

async function republishAll(sendProgress) {
  const now = Date.now();
  if (now - _lastRepublishStart < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - _lastRepublishStart)) / 1000);
    throw new Error(chrome.i18n.getMessage('errorCooldown', [String(remaining)]));
  }

  if (_operationInProgress) {
    throw new Error(chrome.i18n.getMessage('errorOperationInProgress'));
  }

  _operationInProgress = true;
  _lastRepublishStart = now;

  try {
    const session = await ensureUserId();
    let items = _cachedItems;
    if (!items) {
      items = await loadAllItems(session);
    }

    const total = items.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      await assertCurrentSession(session);
      if (sendProgress) {
        sendProgress({ current: i + 1, total, success, failed });
      }

      try {
        await WallapopAPI.republishItem(session.token, session.deviceId, items[i].id, session.hostname,
          () => assertCurrentSession(session));
        await assertCurrentSession(session);
        success++;
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') {
          await handleSessionError(err, session);
        }
        await assertCurrentSession(session);
        failed++;
      }

      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    const result = { total, success, failed, date: new Date().toISOString() };
    await updateForSession(session, async () => {
      await chrome.storage.local.set({ last_republish: result });
      await logActivity({ type: 'republish', total, success, failed });
      await updateRepublishStats(success, failed);
    });

    return result;
  } finally {
    _operationInProgress = false;
  }
}

async function republishSelected(itemIds, sendProgress) {
  if (_operationInProgress) {
    throw new Error(chrome.i18n.getMessage('errorOperationInProgress'));
  }

  _operationInProgress = true;

  try {
    const session = await ensureUserId();
    const validIds = await getSelectedIds(session, itemIds);
    const total = validIds.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < validIds.length; i++) {
      await assertCurrentSession(session);
      if (sendProgress) {
        sendProgress({ current: i + 1, total, success, failed });
      }

      try {
        await WallapopAPI.republishItem(session.token, session.deviceId, validIds[i], session.hostname,
          () => assertCurrentSession(session));
        await assertCurrentSession(session);
        success++;
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') {
          await handleSessionError(err, session);
        }
        await assertCurrentSession(session);
        failed++;
      }

      if (i < validIds.length - 1) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    const result = { total, success, failed, date: new Date().toISOString() };
    await updateForSession(session, async () => {
      await logActivity({ type: 'republish_selected', total, success, failed });
      await updateRepublishStats(success, failed);
    });

    return result;
  } finally {
    _operationInProgress = false;
  }
}

async function adjustAllPrices(percentChange, sendProgress, itemIds) {
  if (_operationInProgress) {
    throw new Error(chrome.i18n.getMessage('errorOperationInProgress'));
  }

  const percent = validatePercent(percentChange);
  _operationInProgress = true;

  try {
    const session = await ensureUserId();
    let items = _cachedItems;
    if (!items) {
      if (sendProgress) sendProgress({ current: 0, total: 0, loading: true });
      items = await loadAllItems(session);
    }

    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      const idSet = new Set(await getSelectedIds(session, itemIds));
      items = items.filter((i) => idSet.has(String(i.id)));
    }

    const total = items.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      await assertCurrentSession(session);
      const item = items[i];
      const currentPrice = WallapopAPI.getItemPrice(item);
      if (currentPrice <= 0) continue;

      const newPrice = validatePrice(currentPrice * (1 + percent / 100));

      if (sendProgress) {
        sendProgress({ current: i + 1, total, success, failed });
      }

      try {
        await writeItemPrice(session, item.id, newPrice);
        success++;
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') {
          await handleSessionError(err, session);
        }
        await assertCurrentSession(session);
        failed++;
      }

      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
      }
    }

    const result = { total, success, failed, percent };
    await updateForSession(session, async () => {
      await logActivity({ type: 'prices', percent, total, success, failed });
      await updatePriceStats(success, failed);
    });

    return result;
  } finally {
    _operationInProgress = false;
  }
}

async function updateSingleItemPrice(itemId, newPrice) {
  if (_operationInProgress) throw new Error(chrome.i18n.getMessage('errorOperationInProgress'));
  const id = validateItemId(itemId);
  const price = validatePrice(newPrice);
  _operationInProgress = true;
  try {
    const session = await ensureUserId();
    await getSelectedIds(session, [id]);
    try {
      await writeItemPrice(session, id, price);
    } catch (error) {
      await handleSessionError(error, session);
    }
    await updateForSession(session, async () => {
      await logActivity({ type: 'price_exact', itemId: id, newPrice: price });
      await updatePriceStats(1, 0);
    });
    return { success: true, itemId: id, newPrice: price };
  } finally {
    _operationInProgress = false;
  }
}

async function clearToken(expectedSession) {
  return queueSessionUpdate(async () => {
    if (expectedSession && !matchesSession(await readSession(), expectedSession)) return false;
    _sessionRevision++;
    _verifiedSession = null;
    invalidateItems();
    await chrome.storage.session.remove(['token', 'deviceId', 'userId']);
    await chrome.storage.local.remove(['wallapop_item_count', 'last_republish']);
    updateBadge(0);
    return true;
  });
}

// ============================================================
// BADGE
// ============================================================

function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#6366F1' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  switch (type) {
    case 'TOKEN_CAPTURED': {
      const token = message.token;
      const deviceId = message.deviceId;
      const hostname = captureHostname(sender);
      if (hostname && token && typeof token === 'string' && token.length > 10
        && (deviceId == null || typeof deviceId === 'string')) {
        captureSession(token, deviceId, hostname).then(
          () => sendResponse({ success: true }),
          (error) => sendResponse({ error: error.message }),
        );
        return true;
      }
      break;
    }

    case 'GET_STATUS': {
      (async () => {
        try {
          const session = await getSession();
          const data = await chrome.storage.local.get(['wallapop_item_count', 'last_republish']);
          await assertCurrentSession(session);
          const cooldownRemaining = Math.max(0, COOLDOWN_MS - (Date.now() - _lastRepublishStart));
          sendResponse({
            authenticated: !!session.token,
            itemCount: data.wallapop_item_count || 0,
            lastRepublish: data.last_republish || null,
            operationInProgress: _operationInProgress,
            cooldownRemaining: Math.ceil(cooldownRemaining / 1000),
          });
        } catch (err) {
          sendResponse({ authenticated: false, error: err.message });
        }
      })();
      return true;
    }

    case 'LOAD_ITEMS': {
      (async () => {
        try {
          const session = await ensureUserId();
          const items = await loadAllItems(session);
          const trackingData = await chrome.storage.local.get(['item_tracking']);
          const tracking = trackingData.item_tracking || {};
          await assertCurrentSession(session);

          sendResponse({
            items: items.map((item) => {
              const id = String(item.id);
              const entry = tracking[id];
              return {
                id: item.id,
                title: WallapopAPI.getItemTitle(item),
                price: WallapopAPI.getItemPrice(item),
                daysListed: entry ? getDaysListed(entry) : null,
                category: (Array.isArray(item.taxonomy) ? item.taxonomy[item.taxonomy.length - 1]?.name : '') || '',
                webSlug: item.web_slug || null,
                imageUrl: (item.images || item.pictures || [])[0]?.urls?.small || null,
              };
            }),
          });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    case 'REPUBLISH_ALL': {
      (async () => {
        try {
          const sendProgress = (progress) => {
            chrome.runtime.sendMessage({ type: 'PROGRESS', operation: 'republish', ...progress }).catch(() => {});
          };
          const result = await republishAll(sendProgress);
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'republish', ...result }).catch(() => {});
          sendResponse({ started: true });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    case 'REPUBLISH_SELECTED': {
      if (!message.itemIds?.length) {
        sendResponse({ error: chrome.i18n.getMessage('errorNoItemsSelected') });
        return true;
      }
      sendResponse({ started: true });
      (async () => {
        try {
          const sendProgress = (progress) => {
            chrome.runtime.sendMessage({ type: 'PROGRESS', operation: 'republish', ...progress }).catch(() => {});
          };
          const result = await republishSelected(message.itemIds, sendProgress);
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'republish', ...result }).catch(() => {});
        } catch (err) {
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'republish', success: 0, failed: 0, error: err.message }).catch(() => {});
        }
      })();
      return true;
    }

    case 'UPDATE_ITEM_PRICE': {
      (async () => {
        try {
          const result = await updateSingleItemPrice(message.itemId, message.newPrice);
          sendResponse(result);
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    case 'ADJUST_PRICES': {
      try {
        validatePercent(message.percent);
      } catch (err) {
        sendResponse({ error: err.message });
        return true;
      }
      sendResponse({ started: true });
      (async () => {
        try {
          const sendProgress = (progress) => {
            chrome.runtime.sendMessage({ type: 'PROGRESS', operation: 'prices', ...progress }).catch(() => {});
          };
          const result = await adjustAllPrices(message.percent, sendProgress);
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'prices', ...result }).catch(() => {});
        } catch (err) {
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'prices', success: 0, failed: 0, error: err.message }).catch(() => {});
        }
      })();
      return true;
    }

    case 'ADJUST_SELECTED_PRICES': {
      try {
        validatePercent(message.percent);
      } catch (err) {
        sendResponse({ error: err.message });
        return true;
      }
      sendResponse({ started: true });
      (async () => {
        try {
          const sendProgress = (progress) => {
            chrome.runtime.sendMessage({ type: 'PROGRESS', operation: 'prices', ...progress }).catch(() => {});
          };
          const result = await adjustAllPrices(message.percent, sendProgress, message.itemIds);
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'prices', ...result }).catch(() => {});
        } catch (err) {
          chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'prices', success: 0, failed: 0, error: err.message }).catch(() => {});
        }
      })();
      return true;
    }

    case 'EXPORT_CSV': {
      (async () => {
        try {
          const session = await ensureUserId();
          let items = _cachedItems;
          if (!items) items = await loadAllItems(session);
          await assertCurrentSession(session);
          const csv = WallapopAPI.exportItemsToCSV(items);
          sendResponse({ csv });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    case 'SET_AUTO_REPUBLISH': {
      (async () => {
        try {
          if (message.enabled) {
            const hours = Math.max(1, Math.min(168, Number(message.intervalHours) || 12));
            const intervalMinutes = hours * 60;
            chrome.alarms.create('auto-republish', {
              delayInMinutes: intervalMinutes,
              periodInMinutes: intervalMinutes,
            });
            await chrome.storage.local.set({
              auto_republish: { enabled: true, intervalHours: hours },
            });
            sendResponse({ success: true });
          } else {
            chrome.alarms.clear('auto-republish');
            await chrome.storage.local.set({
              auto_republish: { enabled: false },
            });
            sendResponse({ success: true });
          }
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    case 'GET_AUTO_REPUBLISH_STATUS': {
      (async () => {
        const data = await chrome.storage.local.get(['auto_republish', 'last_republish']);
        sendResponse({
          autoRepublish: data.auto_republish || { enabled: false },
          lastRepublish: data.last_republish || null,
        });
      })();
      return true;
    }

    case 'GET_ACTIVITY_LOG': {
      (async () => {
        const data = await chrome.storage.local.get(['activity_log']);
        const limit = message.limit || 10;
        sendResponse({ log: (data.activity_log || []).slice(0, limit) });
      })();
      return true;
    }

    case 'GET_STATS': {
      (async () => {
        const data = await chrome.storage.local.get(['stats']);
        sendResponse({ stats: data.stats || { totalRepublishes: 0, totalPriceChanges: 0, totalSuccess: 0, totalFailed: 0 } });
      })();
      return true;
    }

    default:
      break;
  }
});

// ============================================================
// ALARMS
// ============================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'auto-republish') {
    try {
      const sendProgress = (progress) => {
        chrome.runtime.sendMessage({ type: 'PROGRESS', operation: 'republish', ...progress }).catch(() => {});
      };
      const result = await republishAll(sendProgress);
      chrome.runtime.sendMessage({ type: 'OPERATION_COMPLETE', operation: 'republish', ...result }).catch(() => {});

      try {
        chrome.notifications.create('auto-republish-' + Date.now(), {
          type: 'basic',
          iconUrl: '../icons/icon128.png',
          title: 'Wallapop Tools',
          message: chrome.i18n.getMessage('toastRepublished', [String(result.success), String(result.failed)]),
        });
      } catch {}
    } catch (err) {
      console.warn('[WallapopTools] Auto-republish failed:', err.message);
    }
  }
});

// ============================================================
// BADGE - React to storage changes
// ============================================================

chrome.storage.onChanged.addListener((changes) => {
  if (changes.wallapop_item_count?.newValue != null) {
    updateBadge(changes.wallapop_item_count.newValue);
  }
});

// ============================================================
// INSTALL / UPDATE
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      stats: {
        totalRepublishes: 0,
        totalPriceChanges: 0,
        totalSuccess: 0,
        totalFailed: 0,
      },
      activity_log: [],
      item_tracking: {},
    });
  }
  // Initialize Origin rules on install/update
  chrome.storage.session.get(['hostname']).then((data) => {
    if (data.hostname) updateOriginRules(data.hostname);
    else updateOriginRules(_hostname);
  });
});

// Also initialize on service worker startup (wake from idle)
chrome.storage.session.get(['hostname']).then((data) => {
  const host = data.hostname || _hostname;
  updateOriginRules(host);
});
