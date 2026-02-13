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

  let _captured = false;

  function sendToken(token, deviceId) {
    if (_captured && !deviceId) return;
    _captured = true;
    window.postMessage({
      type: 'WT_TOKEN',
      token,
      deviceId: deviceId || null,
    }, '*');
  }

  function extractFromHeaders(headers) {
    let token = null;
    let deviceId = null;

    if (headers instanceof Headers) {
      const auth = headers.get('Authorization');
      if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
      deviceId = headers.get('DeviceID');
    } else if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'authorization' && typeof value === 'string' && value.startsWith('Bearer ')) {
          token = value.slice(7);
        }
        if (lower === 'deviceid') {
          deviceId = value;
        }
      }
    }

    return { token, deviceId };
  }

  // Patch fetch
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      let url = null;
      let headers = null;

      if (input instanceof Request) {
        url = input.url;
        headers = input.headers;
      } else {
        url = typeof input === 'string' ? input : input?.url;
        headers = init?.headers;
      }

      if (url && url.includes('api.wallapop.com') && headers) {
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
    this._wtUrl = url;
    this._wtToken = null;
    this._wtDeviceId = null;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._wtUrl && this._wtUrl.includes('api.wallapop.com')) {
      const lower = name.toLowerCase();
      if (lower === 'authorization' && value.startsWith('Bearer ')) {
        this._wtToken = value.slice(7);
      }
      if (lower === 'deviceid') {
        this._wtDeviceId = value;
      }
      if (this._wtToken) {
        sendToken(this._wtToken, this._wtDeviceId);
      }
    }
    return originalSetHeader.apply(this, arguments);
  };
})();
