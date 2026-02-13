/**
 * Background Service Worker - Wallapop Tools
 *
 * Handles:
 * - Scheduled auto-republishing (chrome.alarms)
 * - Badge updates
 * - Communication between popup and content scripts
 */

// ============================================================
// ALARMS - Auto-republish scheduling
// ============================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'auto-republish') {
    console.log('[WallapopTools] Auto-republish alarm triggered');

    // Find the active Wallapop tab and trigger republish
    const tabs = await chrome.tabs.query({ url: 'https://es.wallapop.com/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'republishAll' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[WallapopTools] Could not reach content script:', chrome.runtime.lastError);
        }
      });
    } else {
      console.warn('[WallapopTools] No Wallapop tab open for auto-republish');
    }
  }
});

// ============================================================
// MESSAGE HANDLING - From popup
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'setAutoRepublish':
      if (message.enabled) {
        // Create repeating alarm (minimum 1 minute in Chrome, use hours for production)
        const intervalMinutes = message.intervalHours * 60;
        chrome.alarms.create('auto-republish', {
          delayInMinutes: intervalMinutes,
          periodInMinutes: intervalMinutes,
        });
        chrome.storage.local.set({
          auto_republish: {
            enabled: true,
            intervalHours: message.intervalHours,
          },
        });
        sendResponse({ success: true, msg: `Auto-republish cada ${message.intervalHours}h activado` });
      } else {
        chrome.alarms.clear('auto-republish');
        chrome.storage.local.set({
          auto_republish: { enabled: false },
        });
        sendResponse({ success: true, msg: 'Auto-republish desactivado' });
      }
      break;

    case 'getAutoRepublishStatus':
      chrome.storage.local.get(['auto_republish', 'last_republish'], (data) => {
        sendResponse({
          autoRepublish: data.auto_republish || { enabled: false },
          lastRepublish: data.last_republish || null,
        });
      });
      return true; // Async response

    default:
      break;
  }
});

// ============================================================
// BADGE - Show item count on extension icon
// ============================================================

chrome.storage.onChanged.addListener((changes) => {
  if (changes.wallapop_item_count) {
    const count = changes.wallapop_item_count.newValue;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#13b987' });
    }
  }
});

// ============================================================
// INSTALL / UPDATE
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[WallapopTools] Extension installed');
    chrome.storage.local.set({
      settings: {
        republishDelay: 3000,    // ms between republishes
        priceChangeStep: 5,      // default % for price changes
        autoRepublishHours: 12,  // default auto-republish interval
      },
    });
  }
});
