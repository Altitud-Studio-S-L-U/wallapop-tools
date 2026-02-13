/**
 * Wallapop API Interceptor & Client
 *
 * Wallapop's web app makes calls to api.wallapop.com.
 * We intercept those calls to capture:
 *   - Bearer token (Authorization header)
 *   - X-Signature generation params
 *   - DeviceID
 *   - User ID
 *
 * Then we reuse them to make our own API calls, mimicking
 * the exact same request pattern Wallapop's web client uses.
 *
 * IMPORTANT: The write endpoints (republish, edit, delete) are
 * NOT publicly documented. They must be discovered via DevTools
 * Network tab while performing those actions manually on Wallapop.
 * The endpoints below marked with [NEEDS VERIFICATION] are educated
 * guesses that MUST be confirmed before use.
 *
 * Verified endpoints (from open source clients):
 *   GET /api/v3/users/{id}/         → user profile
 *   GET /api/v3/users/{id}/items    → user's listed items
 *   GET /api/v3/users/{id}/reviews  → user reviews
 *   GET /api/v3/categories          → category list
 *   GET /api/v3/general/search      → item search
 *   GET /api/v3/payments/perks/me   → payment perks (auth required)
 *
 * Auth mechanism (reverse-engineered):
 *   - Authorization: Bearer <token> (from login session)
 *   - X-Signature: HMAC-SHA256 of "{METHOD}|{URL}|{TIMESTAMP}|"
 *   - Timestamp: Unix ms
 *   - DeviceOS: 0 (web)
 *   - DeviceID: unique fingerprint
 *
 * Sources:
 *   https://github.com/rmonvfer/wallapop_secret
 *   https://github.com/Neufal777/wallapop-go
 *   https://github.com/toniprada/wallapopy
 *   https://github.com/josemamira/uapop
 *
 * This runs as a content script on es.wallapop.com
 */

const WallapopAPI = (() => {
  const BASE_URL = 'https://api.wallapop.com';

  // X-Signature key (from Wallapop's React source, post-migration)
  // Base64 decode = "Now that you've found this, are you ready to join us? jobs@wallapop.com"
  const SIGNATURE_KEY =
    'Tm93IHRoYXQgeW91J3ZlIGZvdW5kIHRoaXMsIGFyZSB5b3UgcmVhZHkgdG8gam9pbiB1cz8gam9ic0B3YWxsYXBvcC5jb20=';

  let _accessToken = null;
  let _userId = null;
  let _deviceId = null;

  // ============================================================
  // TOKEN & HEADER INTERCEPTION
  // Monkey-patch fetch to capture Wallapop's auth headers
  // ============================================================
  const _originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    if (url && url.includes('api.wallapop.com')) {
      const headers = args[1]?.headers;
      if (headers) {
        _extractHeaders(headers);
      }
    }

    return response;
  };

  // Also intercept XMLHttpRequest as fallback
  const _originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
      _accessToken = value.replace('Bearer ', '');
      chrome.storage.local.set({ wallapop_token: _accessToken });
    }
    if (name === 'DeviceID' || name === 'deviceid') {
      _deviceId = value;
      chrome.storage.local.set({ wallapop_device_id: _deviceId });
    }
    return _originalXHRSetHeader.apply(this, arguments);
  };

  function _extractHeaders(headers) {
    const get = (name) => {
      if (headers instanceof Headers) return headers.get(name);
      return headers[name] || headers[name.toLowerCase()] || null;
    };

    const auth = get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      _accessToken = auth.replace('Bearer ', '');
      chrome.storage.local.set({ wallapop_token: _accessToken });
    }

    const deviceId = get('DeviceID');
    if (deviceId) {
      _deviceId = deviceId;
      chrome.storage.local.set({ wallapop_device_id: _deviceId });
    }
  }

  // ============================================================
  // RESTORE CAPTURED DATA FROM STORAGE ON LOAD
  // ============================================================
  chrome.storage.local.get(
    ['wallapop_token', 'wallapop_user_id', 'wallapop_device_id'],
    (data) => {
      if (data.wallapop_token) _accessToken = data.wallapop_token;
      if (data.wallapop_user_id) _userId = data.wallapop_user_id;
      if (data.wallapop_device_id) _deviceId = data.wallapop_device_id;
    }
  );

  // ============================================================
  // X-SIGNATURE GENERATION
  // Reverse-engineered from Wallapop's React source code.
  // Formula: Base64(HMAC-SHA256(KEY, "{METHOD}|{URL}|{TIMESTAMP}|"))
  // See: https://github.com/rmonvfer/wallapop_secret
  // ============================================================

  async function _generateSignature(url, method, timestamp) {
    const separator = '|';
    const message = [method.toUpperCase(), url, timestamp].join(separator) + separator;

    const encoder = new TextEncoder();
    const keyData = Uint8Array.from(atob(SIGNATURE_KEY), (c) => c.charCodeAt(0));
    const messageData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  // ============================================================
  // API CALL HELPER
  // Builds the full request with all required Wallapop headers
  // ============================================================

  async function _apiCall(endpoint, options = {}) {
    if (!_accessToken) {
      throw new Error(
        'No hay token de autenticacion. Navega por Wallapop para capturarlo.'
      );
    }

    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const timestamp = String(Date.now());

    // Generate X-Signature matching Wallapop's own algorithm
    const signature = await _generateSignature(url, method, timestamp);

    const response = await _originalFetch(url, {
      ...options,
      method,
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'X-Signature': signature,
        Timestamp: timestamp,
        'X-DeviceOS': '0',
        DeviceOS: '0',
        ...(_deviceId ? { DeviceID: _deviceId } : {}),
        Origin: 'https://es.wallapop.com',
        Referer: 'https://es.wallapop.com/',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      _accessToken = null;
      chrome.storage.local.remove('wallapop_token');
      throw new Error('Token expirado. Navega por Wallapop para obtener uno nuevo.');
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    return response;
  }

  // ============================================================
  // VERIFIED READ ENDPOINTS (confirmed by open source clients)
  // ============================================================

  /**
   * Get the current user's profile.
   * Endpoint verified: GET /api/v3/users/{id}/
   * Endpoint NOT verified for /me — must discover via DevTools.
   * Fallback: intercept user_id from Wallapop's own API calls.
   */
  async function getMyProfile() {
    // Try the /me endpoint first (common pattern, needs verification)
    try {
      const data = await _apiCall('/api/v3/users/me');
      if (data?.id) {
        _userId = data.id;
        chrome.storage.local.set({ wallapop_user_id: _userId });
      }
      return data;
    } catch (err) {
      // If /me doesn't work and we have a userId from interception, use that
      if (_userId) {
        return _apiCall(`/api/v3/users/${_userId}/`);
      }
      throw err;
    }
  }

  /**
   * Get items listed by the current user.
   * Verified endpoint: GET /api/v3/users/{id}/items
   * Pagination: items come in pages of ~20, use "start" param.
   * Source: https://github.com/Neufal777/wallapop-go
   */
  async function getMyItems(start = 0) {
    if (!_userId) {
      await getMyProfile();
    }
    return _apiCall(`/api/v3/users/${_userId}/items?start=${start}`);
  }

  /**
   * Get ALL items (handles pagination).
   * The Go client uses start+=20 increments with 1s delay.
   */
  async function getAllMyItems() {
    const allItems = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await getMyItems(start);

      // Response structure varies — try known patterns
      const items =
        response?.data?.section?.payload?.items ||
        response?.data?.items ||
        response?.items ||
        response?.data ||
        [];

      if (!Array.isArray(items) || items.length === 0) {
        hasMore = false;
        break;
      }

      allItems.push(...items);

      // Check for cursor-based pagination (meta.next)
      if (response?.meta?.next) {
        start = response.meta.next;
      } else if (items.length >= 20) {
        start += 20;
      } else {
        hasMore = false;
      }

      // Rate limit: 1s between requests (matches wallapop-go pattern)
      await new Promise((r) => setTimeout(r, 1000));
    }

    return allItems;
  }

  // ============================================================
  // WRITE ENDPOINTS — [NEEDS VERIFICATION]
  //
  // These endpoints are NOT documented in any public source.
  // You MUST discover them using Chrome DevTools:
  //
  // 1. Open es.wallapop.com, open DevTools (F12) → Network tab
  // 2. Filter by "api.wallapop.com"
  // 3. Perform the action manually (edit price, reserve, delete)
  // 4. Look at the request: URL, method, request body
  // 5. Update the endpoints below with the real ones
  //
  // The methods below are STUBS that will likely fail until
  // the real endpoints are discovered and filled in.
  // ============================================================

  /**
   * [NEEDS VERIFICATION] Republish/bump an item.
   *
   * Strategy: Wallapop may not have a direct "republish" endpoint.
   * Common workarounds used by other marketplace automators:
   *   - Reserve → unreserve (toggles visibility, may bump)
   *   - Edit item with minimal change (triggers re-index)
   *   - Delete and recreate (nuclear option)
   *
   * To discover the real method:
   *   1. Open DevTools Network tab on Wallapop
   *   2. Click "Reservar" on one of your items
   *   3. Note the exact URL, method, and body
   *   4. Click "Quitar reserva"
   *   5. Note that request too
   *   6. Update this function with the real endpoints
   */
  async function republishItem(itemId) {
    // STUB — replace with real endpoints after DevTools discovery
    console.warn(
      `[WallapopTools] republishItem(${itemId}): endpoint no verificado. ` +
        'Usa DevTools para descubrir el endpoint real.'
    );

    // Attempt: reserve then unreserve (common workaround)
    await _apiCall(`/api/v3/items/${itemId}/reserve`, {
      method: 'PUT',
      body: JSON.stringify({ reserved: true }),
    });

    await new Promise((r) => setTimeout(r, 1000));

    return _apiCall(`/api/v3/items/${itemId}/reserve`, {
      method: 'PUT',
      body: JSON.stringify({ reserved: false }),
    });
  }

  /**
   * [NEEDS VERIFICATION] Update an item's price.
   *
   * To discover:
   *   1. Open DevTools Network tab
   *   2. Edit the price of one of your items on Wallapop
   *   3. Note the URL, method (likely PUT or PATCH), and body structure
   *   4. Update this function
   */
  async function updateItemPrice(itemId, newPrice) {
    console.warn(
      `[WallapopTools] updateItemPrice(${itemId}, ${newPrice}): endpoint no verificado.`
    );

    return _apiCall(`/api/v3/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ sale_price: newPrice }),
    });
  }

  /**
   * [NEEDS VERIFICATION] Mark item as reserved.
   */
  async function reserveItem(itemId, reserved = true) {
    console.warn(
      `[WallapopTools] reserveItem(${itemId}): endpoint no verificado.`
    );

    return _apiCall(`/api/v3/items/${itemId}/reserve`, {
      method: 'PUT',
      body: JSON.stringify({ reserved }),
    });
  }

  /**
   * [NEEDS VERIFICATION] Delete an item.
   */
  async function deleteItem(itemId) {
    console.warn(
      `[WallapopTools] deleteItem(${itemId}): endpoint no verificado.`
    );

    return _apiCall(`/api/v3/items/${itemId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get item details.
   * Likely verified: GET /api/v3/items/{id} (common REST pattern,
   * matches the /users/{id}/ structure from the Go client).
   */
  async function getItemDetails(itemId) {
    return _apiCall(`/api/v3/items/${itemId}`);
  }

  // ============================================================
  // STATUS & HELPERS
  // ============================================================

  function isAuthenticated() {
    return !!_accessToken;
  }

  function getStatus() {
    return {
      authenticated: !!_accessToken,
      userId: _userId,
      deviceId: _deviceId ? `${_deviceId.substring(0, 8)}...` : null,
      tokenPreview: _accessToken
        ? `${_accessToken.substring(0, 10)}...`
        : null,
    };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    getMyProfile,
    getMyItems,
    getAllMyItems,
    republishItem,
    updateItemPrice,
    reserveItem,
    deleteItem,
    getItemDetails,
    isAuthenticated,
    getStatus,
  };
})();

window.__wallapopAPI = WallapopAPI;
