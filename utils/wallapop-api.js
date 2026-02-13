/**
 * Wallapop API Client - Pure Module (v2.0)
 *
 * Imported by the service worker via importScripts().
 * All functions are pure — they receive token/deviceId as parameters.
 * No monkey-patching, no chrome.storage access, no window globals.
 *
 * Signature key is from Wallapop's public React bundle:
 * Base64 decode = "Now that you've found this, are you ready to join us? jobs@wallapop.com"
 */

const WallapopAPI = (() => {
  'use strict';

  const BASE_URL = 'https://api.wallapop.com';

  // Public key from Wallapop's bundled JS — not a secret
  const SIGNATURE_KEY =
    'Tm93IHRoYXQgeW91J3ZlIGZvdW5kIHRoaXMsIGFyZSB5b3UgcmVhZHkgdG8gam9pbiB1cz8gam9ic0B3YWxsYXBvcC5jb20=';

  // --- Signature Generation ---

  async function generateSignature(url, method, timestamp) {
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

  // --- API Call Helper ---

  async function apiCall(endpoint, token, deviceId, options = {}) {
    if (!token) {
      throw new Error('No hay token de autenticacion. Navega por Wallapop para capturarlo.');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const timestamp = String(Date.now());
    const signature = await generateSignature(url, method, timestamp);

    const hostname = options.hostname || 'es.wallapop.com';
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Signature': signature,
      'Timestamp': timestamp,
      'X-DeviceOS': '0',
      'DeviceOS': '0',
      'Origin': `https://${hostname}`,
      'Referer': `https://${hostname}/`,
    };

    if (deviceId) {
      headers['DeviceID'] = deviceId;
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers: { ...headers, ...options.headers },
    });

    if (response.status === 401) {
      throw new Error('TOKEN_EXPIRED');
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

  // --- Endpoints ---

  async function getMyProfile(token, deviceId) {
    try {
      return await apiCall('/api/v3/users/me', token, deviceId);
    } catch (err) {
      throw err;
    }
  }

  async function getMyItems(token, deviceId, userId, start = 0) {
    return apiCall(`/api/v3/users/${userId}/items?start=${start}`, token, deviceId);
  }

  async function getAllMyItems(token, deviceId, userId) {
    const allItems = [];
    let start = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await getMyItems(token, deviceId, userId, start);

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

      if (response?.meta?.next) {
        start = response.meta.next;
      } else if (items.length >= 20) {
        start += 20;
      } else {
        hasMore = false;
      }

      // Rate limit: 1s between pagination requests
      await new Promise((r) => setTimeout(r, 1000));
    }

    return allItems;
  }

  async function republishItem(token, deviceId, itemId) {
    return apiCall(`/api/v3/items/${itemId}/reactivate`, token, deviceId, {
      method: 'PUT',
    });
  }

  async function getItemDetails(token, deviceId, itemId) {
    return apiCall(`/api/v3/items/${itemId}`, token, deviceId);
  }

  async function updateItemPrice(token, deviceId, itemId, newPrice) {
    const item = await getItemDetails(token, deviceId, itemId);

    const body = {
      attributes: {
        title: item.title?.original || item.title,
        description: item.description?.original || item.description,
        price_amount: newPrice,
        condition: item.type_attributes?.condition?.value || 'good',
      },
      category_leaf_id: item.taxonomy?.[item.taxonomy.length - 1]?.id || null,
      apply_discount: false,
      delivery: {
        allowed_by_user: item.shipping?.user_allows_shipping || false,
        max_weight_kg: 10,
        ...(item.shipping?.cost_configuration_id
          ? { cost_configuration_id: item.shipping.cost_configuration_id }
          : {}),
      },
      location: {
        latitude: item.location?.latitude,
        longitude: item.location?.longitude,
        approximated: false,
      },
      pictures: (item.images || []).map((img, i) => ({
        id: img.id,
        order: i,
      })),
    };

    return apiCall(`/api/v3/items/${itemId}`, token, deviceId, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // --- Helpers ---

  function getItemTitle(item) {
    return item.title?.original || item.title?.translated || item.title || item.name || 'Sin titulo';
  }

  function getItemPrice(item) {
    const raw = item.price?.cash?.amount
      ?? item.sale_price
      ?? item.price?.amount
      ?? (typeof item.price === 'number' ? item.price : 0);
    return parseFloat(raw) || 0;
  }

  return {
    generateSignature,
    apiCall,
    getMyProfile,
    getMyItems,
    getAllMyItems,
    republishItem,
    getItemDetails,
    updateItemPrice,
    getItemTitle,
    getItemPrice,
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WallapopAPI;
}
