/**
 * Wallapop API Client - Pure Module (v4.0)
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
  const MAX_PAGES = 50; // 1000 items ceiling — prevents infinite loops

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
    const isWrite = method === 'PUT' || method === 'POST' || method === 'DELETE';
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': isWrite ? 'application/vnd.upload-v2+json' : 'application/json, text/plain, */*',
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

    const { beforeRequest, ...requestOptions } = options;
    if (beforeRequest) await beforeRequest();
    const response = await fetch(url, {
      ...requestOptions,
      method,
      headers: { ...headers, ...options.headers },
    });

    if (response.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.text();
        detail = body ? ` — ${body.slice(0, 200)}` : '';
      } catch (_) {}
      throw new Error(`API error: ${response.status} ${response.statusText}${detail}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    return response;
  }

  // --- Item Extraction Helper (testable) ---

  function extractItems(response) {
    for (const candidate of [
      response?.data?.section?.payload?.items,
      response?.data?.items,
      response?.items,
    ]) {
      if (Array.isArray(candidate) && candidate.length > 0) return candidate;
    }
    if (Array.isArray(response?.data)) return response.data;
    return [];
  }

  // --- GET→PUT Body Mapper (testable) ---

  function mapGetToPutBody(item, newPrice) {
    const title = item.title?.original
      || (typeof item.title === 'string' ? item.title : '');
    const description = item.description?.original
      || (typeof item.description === 'string' ? item.description : '');
    const condition = item.type_attributes?.condition?.value
      || item.condition || 'good';

    const lastTax = Array.isArray(item.taxonomy) ? item.taxonomy[item.taxonomy.length - 1] : null;
    const categoryLeafId = lastTax?.id != null ? String(lastTax.id)
      : (item.category_id != null ? String(item.category_id) : null);

    const allowedByUser = item.shipping?.user_allows_shipping
      ?? item.delivery?.allowed_by_user ?? false;

    const rawPictures = item.images || item.pictures || [];

    const safePrice = Math.round(parseFloat(newPrice) * 100) / 100;

    return {
      attributes: { title, description, price_amount: safePrice, condition },
      category_leaf_id: categoryLeafId,
      apply_discount: false,
      delivery: {
        allowed_by_user: allowedByUser,
        max_weight_kg: allowedByUser
          ? (item.shipping?.max_weight_kg ?? null) : null,
        cost_configuration_id: item.shipping?.cost_configuration_id
          ?? item.delivery?.cost_configuration_id ?? null,
      },
      location: {
        latitude: item.location?.latitude ?? null,
        longitude: item.location?.longitude ?? null,
        approximated: false,
      },
      pictures: rawPictures.map((img, i) => ({ id: img.id, order: i })),
    };
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
    const seenIds = new Set();
    let start = 0;
    let pageCount = 0;

    while (pageCount < MAX_PAGES) {
      let response;
      let retries = 2;

      // Retry per page with backoff
      while (true) {
        try {
          response = await getMyItems(token, deviceId, userId, start);
          break;
        } catch (err) {
          if (err.message === 'TOKEN_EXPIRED' || retries <= 0) throw err;
          retries--;
          await new Promise((r) => setTimeout(r, 1000 * (3 - retries)));
        }
      }

      const items = extractItems(response);

      if (!Array.isArray(items) || items.length === 0) {
        break;
      }

      // Deduplicate
      for (const item of items) {
        if (item.id && !seenIds.has(String(item.id))) {
          seenIds.add(String(item.id));
          allItems.push(item);
        }
      }

      // Determine next cursor
      let nextStart;
      if (response?.meta?.next) {
        nextStart = response.meta.next;
      } else if (items.length >= 20) {
        nextStart = start + 20;
      } else {
        break; // last page
      }

      // Detect stuck API (cursor didn't advance)
      if (nextStart === start) {
        break;
      }

      start = nextStart;
      pageCount++;

      // Rate limit: 1s between pagination requests
      await new Promise((r) => setTimeout(r, 1000));
    }

    return allItems;
  }

  async function republishItem(token, deviceId, itemId, hostname, beforeRequest) {
    return apiCall(`/api/v3/items/${itemId}/reactivate`, token, deviceId, {
      method: 'PUT',
      ...(hostname ? { hostname } : {}),
      ...(beforeRequest ? { beforeRequest } : {}),
    });
  }

  async function getItemDetails(token, deviceId, itemId, hostname) {
    const opts = hostname ? { hostname } : {};
    return apiCall(`/api/v3/items/${itemId}`, token, deviceId, opts);
  }

  async function updateItemPrice(token, deviceId, itemId, newPrice, hostname, beforeRequest) {
    const opts = hostname ? { hostname } : {};
    const item = await getItemDetails(token, deviceId, itemId, hostname);
    const body = mapGetToPutBody(item, newPrice);

    try {
      return await apiCall(`/api/v3/items/${itemId}`, token, deviceId, {
        method: 'PUT',
        body: JSON.stringify(body),
        ...opts,
        ...(beforeRequest ? { beforeRequest } : {}),
      });
    } catch (err) {
      console.error('[WallapopAPI] PUT failed:', err.message);
      throw err;
    }
  }

  // --- CSV Export ---

  function exportItemsToCSV(items) {
    const header = 'title,price,category,condition,days_listed,shipping_enabled,url';
    const rows = items.map((item) => {
      const title = csvEscape(getItemTitle(item));
      const price = getItemPrice(item);

      const lastTax = Array.isArray(item.taxonomy) ? item.taxonomy[item.taxonomy.length - 1] : null;
      const category = csvEscape(lastTax?.name || item.category_name || '');

      const condition = csvEscape(
        item.type_attributes?.condition?.value || item.condition || ''
      );

      const creationDate = item.creation_date || item.modified_date || item.publish_date;
      const daysListed = creationDate
        ? Math.floor((Date.now() - new Date(creationDate).getTime()) / 86400000)
        : '';

      const shippingEnabled = item.shipping?.user_allows_shipping
        ?? item.delivery?.allowed_by_user ?? false;

      const url = item.web_slug
        ? `https://es.wallapop.com/item/${item.web_slug}`
        : (item.id ? `https://es.wallapop.com/item/${item.id}` : '');

      return `${title},${price},${category},${condition},${daysListed},${shippingEnabled},${url}`;
    });

    return rows.length > 0 ? header + '\n' + rows.join('\n') : header;
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // --- Competition Search (public API) ---

  async function searchItems(query, categoryId, lat, lng) {
    let endpoint = `/api/v3/general/search?keywords=${encodeURIComponent(query)}`;
    if (categoryId) endpoint += `&category_ids=${categoryId}`;
    if (lat != null && lng != null) {
      endpoint += `&latitude=${lat}&longitude=${lng}`;
    }
    endpoint += '&order_by=newest&items_count=40';

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'X-DeviceOS': '0',
        'DeviceOS': '0',
      },
    });

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.search_objects || data?.items || [];

    const prices = items
      .map((i) => {
        const p = i.price?.cash?.amount ?? i.sale_price ?? i.price?.amount
          ?? (typeof i.price === 'number' ? i.price : null);
        return p != null ? parseFloat(p) : null;
      })
      .filter((p) => p != null && p > 0)
      .sort((a, b) => a - b);

    return {
      count: prices.length,
      prices,
      min: prices[0] || 0,
      max: prices[prices.length - 1] || 0,
      median: prices.length > 0
        ? prices[Math.floor(prices.length / 2)]
        : 0,
      avg: prices.length > 0
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100
        : 0,
    };
  }

  // --- Public Search (raw results) ---

  async function searchItemsRaw(query, categoryId, lat, lng) {
    let endpoint = `/api/v3/general/search?keywords=${encodeURIComponent(query)}`;
    if (categoryId) endpoint += `&category_ids=${categoryId}`;
    if (lat != null && lng != null) {
      endpoint += `&latitude=${lat}&longitude=${lng}`;
    }
    endpoint += '&order_by=newest&items_count=40';

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'X-DeviceOS': '0',
        'DeviceOS': '0',
      },
    });

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status}`);
    }

    const data = await response.json();
    return data?.search_objects || data?.items || [];
  }

  // --- Public Item Details ---

  async function fetchPublicItemDetails(itemId) {
    try {
      const response = await fetch(`${BASE_URL}/api/v3/items/${itemId}`, {
        headers: {
          'Accept': 'application/json',
          'X-DeviceOS': '0',
          'DeviceOS': '0',
        },
      });

      if (!response.ok) return null;

      return await response.json();
    } catch {
      return null;
    }
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
    // New exports
    extractItems,
    mapGetToPutBody,
    exportItemsToCSV,
    searchItems,
    searchItemsRaw,
    fetchPublicItemDetails,
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WallapopAPI;
}
