/**
 * Bridge - Wallapop Tools v2.0
 *
 * Runs in ISOLATED world (default). Relays token messages from
 * the MAIN world interceptor to the service worker.
 */

(() => {
  'use strict';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'WT_TOKEN') return;

    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_CAPTURED',
        token: event.data.token,
        deviceId: event.data.deviceId,
        hostname: location.hostname,
      });
    } catch (_) {
      // Extension context invalidated — ignore
    }
  });
})();
