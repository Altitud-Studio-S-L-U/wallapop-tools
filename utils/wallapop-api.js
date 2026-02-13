/**
 * Wallapop API Interceptor & Client
 *
 * Wallapop's web app makes calls to api.wallapop.com.
 * We intercept those calls to extract the auth token,
 * then reuse it to make our own API calls.
 *
 * This runs as a content script on es.wallapop.com
 */

const WallapopAPI = (() => {
  const BASE_URL = 'https://api.wallapop.com';
  let _accessToken = null;
  let _userId = null;

  // ============================================================
  // TOKEN INTERCEPTION
  // Monkey-patch fetch to capture Wallapop's auth token
  // ============================================================
  const _originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    // Capture auth headers from Wallapop's own API calls
    if (url && url.includes('api.wallapop.com')) {
      const headers = args[1]?.headers;
      if (headers) {
        const authHeader =
          headers['Authorization'] ||
          headers['authorization'] ||
          (headers instanceof Headers ? headers.get('Authorization') : null);

        if (authHeader && authHeader.startsWith('Bearer ')) {
          _accessToken = authHeader.replace('Bearer ', '');
          chrome.storage.local.set({ wallapop_token: _accessToken });
        }
      }
    }

    return response;
  };

  // Also intercept XMLHttpRequest as fallback
  const _originalXHROpen = XMLHttpRequest.prototype.open;
  const _originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
      _accessToken = value.replace('Bearer ', '');
      chrome.storage.local.set({ wallapop_token: _accessToken });
    }
    return _originalXHRSetHeader.apply(this, arguments);
  };

  // ============================================================
  // RESTORE TOKEN FROM STORAGE ON LOAD
  // ============================================================
  chrome.storage.local.get(['wallapop_token', 'wallapop_user_id'], (data) => {
    if (data.wallapop_token) _accessToken = data.wallapop_token;
    if (data.wallapop_user_id) _userId = data.wallapop_user_id;
  });

  // ============================================================
  // API METHODS
  // ============================================================

  async function _apiCall(endpoint, options = {}) {
    if (!_accessToken) {
      throw new Error('No auth token available. Navigate around Wallapop to capture it.');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const response = await _originalFetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      _accessToken = null;
      chrome.storage.local.remove('wallapop_token');
      throw new Error('Token expired. Navigate Wallapop to get a new one.');
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

  /**
   * Get the current user's profile/info
   */
  async function getMyProfile() {
    const data = await _apiCall('/api/v3/users/me');
    if (data?.id) {
      _userId = data.id;
      chrome.storage.local.set({ wallapop_user_id: _userId });
    }
    return data;
  }

  /**
   * Get all items listed by the current user
   * Returns array of items with id, title, price, status, images, etc.
   */
  async function getMyItems(offset = 0) {
    if (!_userId) {
      await getMyProfile();
    }
    return _apiCall(`/api/v3/users/${_userId}/items?offset=${offset}&limit=40`);
  }

  /**
   * Get ALL items (handles pagination)
   */
  async function getAllMyItems() {
    const allItems = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await getMyItems(offset);
      const items = response?.data || response?.items || [];
      allItems.push(...items);

      if (items.length < 40) {
        hasMore = false;
      } else {
        offset += 40;
        // Be nice to the API - wait a bit between requests
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return allItems;
  }

  /**
   * Republish/bump an item (makes it appear as newly listed)
   * This is the most valuable feature for sellers.
   */
  async function republishItem(itemId) {
    return _apiCall(`/api/v3/items/${itemId}/reserve`, {
      method: 'PUT',
      body: JSON.stringify({ reserved: true }),
    }).then(() =>
      // Unreserve immediately to "refresh" the listing
      _apiCall(`/api/v3/items/${itemId}/reserve`, {
        method: 'PUT',
        body: JSON.stringify({ reserved: false }),
      })
    );
  }

  /**
   * Update an item's price
   */
  async function updateItemPrice(itemId, newPrice) {
    return _apiCall(`/api/v3/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ sale_price: newPrice }),
    });
  }

  /**
   * Mark item as reserved
   */
  async function reserveItem(itemId, reserved = true) {
    return _apiCall(`/api/v3/items/${itemId}/reserve`, {
      method: 'PUT',
      body: JSON.stringify({ reserved }),
    });
  }

  /**
   * Delete an item
   */
  async function deleteItem(itemId) {
    return _apiCall(`/api/v3/items/${itemId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get item details
   */
  async function getItemDetails(itemId) {
    return _apiCall(`/api/v3/items/${itemId}`);
  }

  /**
   * Check if we have a valid token
   */
  function isAuthenticated() {
    return !!_accessToken;
  }

  /**
   * Get current token status
   */
  function getStatus() {
    return {
      authenticated: !!_accessToken,
      userId: _userId,
      tokenPreview: _accessToken ? `${_accessToken.substring(0, 10)}...` : null,
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

// Make it available globally and to the extension messaging system
window.__wallapopAPI = WallapopAPI;
