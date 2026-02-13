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
let _cachedUserId = null;
let _hostname = 'es.wallapop.com';

// ============================================================
// SESSION TOKEN HELPERS
// ============================================================

async function getSession() {
  const data = await chrome.storage.session.get(['token', 'deviceId', 'userId', 'hostname']);
  return {
    token: data.token || null,
    deviceId: data.deviceId || null,
    userId: data.userId || null,
    hostname: data.hostname || _hostname,
  };
}

async function setSession(fields) {
  await chrome.storage.session.set(fields);
}

async function ensureUserId() {
  const session = await getSession();
  if (!session.token) throw new Error(chrome.i18n.getMessage('errorNoToken'));

  if (session.userId) {
    _cachedUserId = session.userId;
    return session;
  }

  if (_cachedUserId) {
    await setSession({ userId: _cachedUserId });
    return { ...session, userId: _cachedUserId };
  }

  const profile = await WallapopAPI.getMyProfile(session.token, session.deviceId);
  if (profile?.id) {
    _cachedUserId = profile.id;
    await setSession({ userId: profile.id });
    return { ...session, userId: profile.id };
  }

  throw new Error(chrome.i18n.getMessage('errorProfileFailed'));
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

async function loadAllItems() {
  const session = await ensureUserId();
  const items = await WallapopAPI.getAllMyItems(session.token, session.deviceId, session.userId);
  _cachedItems = items;

  await chrome.storage.local.set({ wallapop_item_count: items.length });
  updateBadge(items.length);
  await updateItemTracking(items);

  return items;
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
      items = await loadAllItems();
    }

    const total = items.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      if (sendProgress) {
        sendProgress({ current: i + 1, total, success, failed });
      }

      try {
        await WallapopAPI.republishItem(session.token, session.deviceId, items[i].id);
        success++;
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') {
          await clearToken();
          throw new Error(chrome.i18n.getMessage('errorTokenExpired'));
        }
        failed++;
      }

      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    const result = { total, success, failed, date: new Date().toISOString() };
    await chrome.storage.local.set({ last_republish: result });
    await logActivity({ type: 'republish', total, success, failed });
    await updateRepublishStats(success, failed);

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
    const validIds = itemIds.map(validateItemId);
    const total = validIds.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < validIds.length; i++) {
      if (sendProgress) {
        sendProgress({ current: i + 1, total, success, failed });
      }

      try {
        await WallapopAPI.republishItem(session.token, session.deviceId, validIds[i]);
        success++;
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') {
          await clearToken();
          throw new Error(chrome.i18n.getMessage('errorTokenExpired'));
        }
        failed++;
      }

      if (i < validIds.length - 1) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    const result = { total, success, failed, date: new Date().toISOString() };
    await logActivity({ type: 'republish_selected', total, success, failed });
    await updateRepublishStats(success, failed);

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
      items = await loadAllItems();
    }

    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      const idSet = new Set(itemIds.map(validateItemId));
      items = items.filter((i) => idSet.has(String(i.id)));
    }

    const total = items.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const currentPrice = WallapopAPI.getItemPrice(item);
      if (currentPrice <= 0) continue;

      const newPrice = Math.round(currentPrice * (1 + percent / 100) * 100) / 100;

      if (sendProgress) {
        sendProgress({ current: i + 1, total, success, failed });
      }

      try {
        await WallapopAPI.updateItemPrice(session.token, session.deviceId, item.id, newPrice);
        success++;
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED') {
          await clearToken();
          throw new Error(chrome.i18n.getMessage('errorTokenExpired'));
        }
        failed++;
      }

      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
      }
    }

    const result = { total, success, failed, percent };
    await logActivity({ type: 'prices', percent, total, success, failed });
    await updatePriceStats(success, failed);

    return result;
  } finally {
    _operationInProgress = false;
  }
}

async function updateSingleItemPrice(itemId, newPrice) {
  const session = await ensureUserId();
  const id = validateItemId(itemId);
  await WallapopAPI.updateItemPrice(session.token, session.deviceId, id, newPrice);
  await logActivity({ type: 'price_exact', itemId: id, newPrice });
  await updatePriceStats(1, 0);
  return { success: true, itemId: id, newPrice };
}

async function clearToken() {
  await chrome.storage.session.remove(['token', 'deviceId', 'userId']);
  _cachedUserId = null;
  _cachedItems = null;
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
      if (token && typeof token === 'string' && token.length > 10) {
        const fields = { token };
        if (deviceId) fields.deviceId = deviceId;
        if (message.hostname) {
          fields.hostname = message.hostname;
          _hostname = message.hostname;
        }
        setSession(fields).then(() => {
          if (!_cachedItems) {
            loadAllItems().catch(() => {});
          }
        });
      }
      break;
    }

    case 'GET_STATUS': {
      (async () => {
        try {
          const session = await getSession();
          const data = await chrome.storage.local.get(['wallapop_item_count', 'last_republish']);
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
          const items = await loadAllItems();
          const trackingData = await chrome.storage.local.get(['item_tracking']);
          const tracking = trackingData.item_tracking || {};

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
          let items = _cachedItems;
          if (!items) items = await loadAllItems();
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
});
