/**
 * Token Interceptor - Wallapop Tools v2.0
 *
 * Runs at document_start in MAIN world (same as Wallapop's JS).
 * Monkey-patches fetch and XMLHttpRequest to capture
 * Authorization and DeviceID headers from Wallapop's own requests.
 *
 * Sends captured tokens via window.postMessage to the bridge script
 * (which runs in the ISOLATED world and can talk to the service worker).
 */

(() => {
  'use strict';

  let _capturedToken = null;
  let _capturedDeviceId = null;

  function sendToken(token, deviceId) {
    if (token === _capturedToken && (!deviceId || deviceId === _capturedDeviceId)) return;
    const nextDeviceId = token === _capturedToken
      ? (deviceId || _capturedDeviceId)
      : (deviceId || null);
    window.postMessage({
      type: 'WT_TOKEN',
      token,
      deviceId: nextDeviceId,
    }, '*');
    _capturedToken = token;
    _capturedDeviceId = nextDeviceId;
  }

  function isWallapopUrl(url) {
    return new URL(url, location.href).origin === 'https://api.wallapop.com';
  }

  function extractFromHeaders(headers) {
    const normalized = new Headers(headers);
    const auth = normalized.get('Authorization');
    return {
      token: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
      deviceId: normalized.get('DeviceID'),
    };
  }

  // Patch fetch
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = input instanceof Request ? input.url : input;
      let headers = init?.headers;
      if (headers === undefined && input instanceof Request) headers = input.headers;

      if (isWallapopUrl(url)) {
        const { token, deviceId } = extractFromHeaders(headers);
        if (token) sendToken(token, deviceId);
      }
    } catch (_) {
      // Never break the original fetch
    }
    return originalFetch.apply(this, arguments);
  };

  // Patch XMLHttpRequest as fallback
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    const result = originalOpen.apply(this, arguments);
    try {
      this._wtIsWallapop = false;
      this._wtToken = null;
      this._wtDeviceId = null;
      this._wtIsWallapop = isWallapopUrl(url);
    } catch (_) {
      // Observation must not change a successful native call.
    }
    return result;
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const result = originalSetHeader.apply(this, arguments);
    try {
      if (this._wtIsWallapop) {
        const { token, deviceId } = extractFromHeaders([[name, value]]);
        if (token) this._wtToken = token;
        if (deviceId) this._wtDeviceId = deviceId;
        if (this._wtToken) sendToken(this._wtToken, this._wtDeviceId);
      }
    } catch (_) {
      // Observation must not change a successful native call.
    }
    return result;
  };
})();
