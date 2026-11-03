/**
 * Tests for wallapop-api.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Load the API module
const apiCode = await import('node:fs').then(fs =>
  fs.readFileSync(new URL('../utils/wallapop-api.js', import.meta.url), 'utf-8')
);

// Execute the code to define WallapopAPI
const func = new Function(apiCode + '\nreturn WallapopAPI;');
const WallapopAPI = func();

describe('WallapopAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // generateSignature
  // ============================================================

  describe('generateSignature', () => {
    it('should return a base64 string', async () => {
      const sig = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/users/me',
        'GET',
        '1700000000000'
      );
      expect(typeof sig).toBe('string');
      expect(sig.length).toBeGreaterThan(0);
      // Base64 chars only
      expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should produce different signatures for different methods', async () => {
      const sigGet = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/items/123',
        'GET',
        '1700000000000'
      );
      const sigPut = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/items/123',
        'PUT',
        '1700000000000'
      );
      expect(sigGet).not.toBe(sigPut);
    });

    it('should produce different signatures for different timestamps', async () => {
      const sig1 = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/users/me',
        'GET',
        '1700000000000'
      );
      const sig2 = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/users/me',
        'GET',
        '1700000001000'
      );
      expect(sig1).not.toBe(sig2);
    });

    it('should produce consistent signatures for same inputs', async () => {
      const sig1 = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/users/me',
        'GET',
        '1700000000000'
      );
      const sig2 = await WallapopAPI.generateSignature(
        'https://api.wallapop.com/api/v3/users/me',
        'GET',
        '1700000000000'
      );
      expect(sig1).toBe(sig2);
    });
  });

  // ============================================================
  // getItemTitle
  // ============================================================

  describe('getItemTitle', () => {
    it('should extract title from title.original', () => {
      expect(WallapopAPI.getItemTitle({ title: { original: 'iPhone 15' } })).toBe('iPhone 15');
    });

    it('should extract title from title.translated', () => {
      expect(WallapopAPI.getItemTitle({ title: { translated: 'Translated Title' } })).toBe('Translated Title');
    });

    it('should use title string directly', () => {
      expect(WallapopAPI.getItemTitle({ title: 'Simple Title' })).toBe('Simple Title');
    });

    it('should fallback to name field', () => {
      expect(WallapopAPI.getItemTitle({ name: 'Item Name' })).toBe('Item Name');
    });

    it('should return "Sin titulo" as default', () => {
      expect(WallapopAPI.getItemTitle({})).toBe('Sin titulo');
    });

    it('should prefer original over translated', () => {
      expect(WallapopAPI.getItemTitle({
        title: { original: 'Original', translated: 'Translated' }
      })).toBe('Original');
    });
  });

  // ============================================================
  // getItemPrice
  // ============================================================

  describe('getItemPrice', () => {
    it('should extract price from price.cash.amount', () => {
      expect(WallapopAPI.getItemPrice({ price: { cash: { amount: 25.50 } } })).toBe(25.50);
    });

    it('should extract price from sale_price', () => {
      expect(WallapopAPI.getItemPrice({ sale_price: 19.99 })).toBe(19.99);
    });

    it('should extract price from price.amount', () => {
      expect(WallapopAPI.getItemPrice({ price: { amount: 42 } })).toBe(42);
    });

    it('should extract price when price is a number', () => {
      expect(WallapopAPI.getItemPrice({ price: 15.00 })).toBe(15.00);
    });

    it('should return 0 for missing price', () => {
      expect(WallapopAPI.getItemPrice({})).toBe(0);
    });

    it('should return 0 for non-numeric price', () => {
      expect(WallapopAPI.getItemPrice({ price: { cash: { amount: 'free' } } })).toBe(0);
    });

    it('should parse string amounts', () => {
      expect(WallapopAPI.getItemPrice({ sale_price: '29.99' })).toBe(29.99);
    });
  });

  // ============================================================
  // apiCall
  // ============================================================

  describe('apiCall', () => {
    it('should throw if no token provided', async () => {
      await expect(
        WallapopAPI.apiCall('/api/v3/users/me', null, 'device123')
      ).rejects.toThrow();
    });

    it('should throw TOKEN_EXPIRED on 401', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(
        WallapopAPI.apiCall('/api/v3/users/me', 'valid-token', 'device123')
      ).rejects.toThrow('TOKEN_EXPIRED');
    });

    it('should return parsed JSON on success', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: {
          get: (name) => name === 'content-type' ? 'application/json' : null,
        },
        json: () => Promise.resolve({ id: 'user123' }),
      });

      const result = await WallapopAPI.apiCall('/api/v3/users/me', 'valid-token', 'device123');
      expect(result).toEqual({ id: 'user123' });
    });

    it('should set correct headers', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
      });

      await WallapopAPI.apiCall('/api/v3/users/me', 'my-token', 'my-device');

      const callArgs = globalThis.fetch.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['Authorization']).toBe('Bearer my-token');
      expect(headers['DeviceID']).toBe('my-device');
      expect(headers['DeviceOS']).toBe('0');
      expect(headers['X-DeviceOS']).toBe('0');
      expect(headers['X-Signature']).toBeDefined();
      expect(headers['Timestamp']).toBeDefined();
    });

    it('should throw on non-OK non-401 response', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(
        WallapopAPI.apiCall('/api/v3/users/me', 'valid-token', 'device123')
      ).rejects.toThrow('API error: 500');
    });

    it('should handle hostname option for Origin/Referer', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
      });

      await WallapopAPI.apiCall('/api/v3/users/me', 'token', 'device', { hostname: 'it.wallapop.com' });

      const headers = globalThis.fetch.mock.calls[0][1].headers;
      expect(headers['Origin']).toBe('https://it.wallapop.com');
      expect(headers['Referer']).toBe('https://it.wallapop.com/');
    });

    it('should default hostname to es.wallapop.com', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
      });

      await WallapopAPI.apiCall('/api/v3/users/me', 'token', 'device');

      const headers = globalThis.fetch.mock.calls[0][1].headers;
      expect(headers['Origin']).toBe('https://es.wallapop.com');
    });
  });

  // ============================================================
  // extractItems
  // ============================================================

  describe('extractItems', () => {
    it('should extract from data.section.payload.items', () => {
      const resp = { data: { section: { payload: { items: [{ id: '1' }] } } } };
      expect(WallapopAPI.extractItems(resp)).toEqual([{ id: '1' }]);
    });

    it('should extract from data.items', () => {
      const resp = { data: { items: [{ id: '2' }] } };
      expect(WallapopAPI.extractItems(resp)).toEqual([{ id: '2' }]);
    });

    it('should extract from items', () => {
      const resp = { items: [{ id: '3' }] };
      expect(WallapopAPI.extractItems(resp)).toEqual([{ id: '3' }]);
    });

    it('should extract from data array', () => {
      const resp = { data: [{ id: '4' }] };
      expect(WallapopAPI.extractItems(resp)).toEqual([{ id: '4' }]);
    });

    it('should return empty array for null/undefined', () => {
      expect(WallapopAPI.extractItems(null)).toEqual([]);
      expect(WallapopAPI.extractItems(undefined)).toEqual([]);
      expect(WallapopAPI.extractItems({})).toEqual([]);
    });

    it('should prefer deeper paths over shallower ones', () => {
      const resp = {
        data: { section: { payload: { items: [{ id: 'deep' }] } }, items: [{ id: 'shallow' }] },
        items: [{ id: 'top' }],
      };
      expect(WallapopAPI.extractItems(resp)[0].id).toBe('deep');
    });

    it('should skip empty arrays and try next path', () => {
      const resp = { data: { section: { payload: { items: [] } }, items: [{ id: 'fallback' }] } };
      expect(WallapopAPI.extractItems(resp)[0].id).toBe('fallback');
    });
  });

  // ============================================================
  // mapGetToPutBody
  // ============================================================

  describe('mapGetToPutBody', () => {
    it('should map a typical item correctly', () => {
      const item = {
        title: { original: 'iPhone 15' },
        description: { original: 'Great phone' },
        type_attributes: { condition: { value: 'as_good_as_new' } },
        taxonomy: [{ id: 100 }, { id: 200 }],
        shipping: { user_allows_shipping: true, max_weight_kg: 5, cost_configuration_id: 'abc' },
        location: { latitude: 41.3, longitude: 2.17 },
        images: [{ id: 'img1' }, { id: 'img2' }],
      };
      const body = WallapopAPI.mapGetToPutBody(item, 899);
      expect(body.attributes.title).toBe('iPhone 15');
      expect(body.attributes.description).toBe('Great phone');
      expect(body.attributes.price_amount).toBe(899);
      expect(body.attributes.condition).toBe('as_good_as_new');
      expect(body.category_leaf_id).toBe('200');
      expect(body.delivery.allowed_by_user).toBe(true);
      expect(body.delivery.max_weight_kg).toBe(5);
      expect(body.delivery.cost_configuration_id).toBe('abc');
      expect(body.location.latitude).toBe(41.3);
      expect(body.pictures).toEqual([{ id: 'img1', order: 0 }, { id: 'img2', order: 1 }]);
    });

    it('should set max_weight_kg to null when delivery disabled', () => {
      const item = {
        title: { original: 'Shirt' },
        description: { original: '' },
        shipping: { user_allows_shipping: false },
        images: [],
      };
      const body = WallapopAPI.mapGetToPutBody(item, 10);
      expect(body.delivery.allowed_by_user).toBe(false);
      expect(body.delivery.max_weight_kg).toBe(null);
    });

    it('should force category_leaf_id to string', () => {
      const item = {
        title: 'Test',
        taxonomy: [{ id: 42 }],
        images: [],
      };
      const body = WallapopAPI.mapGetToPutBody(item, 5);
      expect(body.category_leaf_id).toBe('42');
      expect(typeof body.category_leaf_id).toBe('string');
    });

    it('should fallback to category_id when no taxonomy', () => {
      const item = { title: 'Test', category_id: 99, images: [] };
      const body = WallapopAPI.mapGetToPutBody(item, 5);
      expect(body.category_leaf_id).toBe('99');
    });

    it('should handle plain string title and description', () => {
      const item = { title: 'Plain Title', description: 'Plain Desc', images: [] };
      const body = WallapopAPI.mapGetToPutBody(item, 10);
      expect(body.attributes.title).toBe('Plain Title');
      expect(body.attributes.description).toBe('Plain Desc');
    });

    it('should use delivery fallback paths', () => {
      const item = {
        title: 'Test',
        delivery: { allowed_by_user: true, cost_configuration_id: 'xyz' },
        images: [],
      };
      const body = WallapopAPI.mapGetToPutBody(item, 10);
      expect(body.delivery.allowed_by_user).toBe(true);
      expect(body.delivery.cost_configuration_id).toBe('xyz');
    });

    it('should handle empty item with safe defaults', () => {
      const body = WallapopAPI.mapGetToPutBody({}, 1);
      expect(body.attributes.title).toBe('');
      expect(body.attributes.description).toBe('');
      expect(body.attributes.condition).toBe('good');
      expect(body.category_leaf_id).toBe(null);
      expect(body.delivery.allowed_by_user).toBe(false);
      expect(body.delivery.max_weight_kg).toBe(null);
      expect(body.pictures).toEqual([]);
    });

    it('should always include cost_configuration_id', () => {
      const item = { title: 'Test', shipping: { cost_configuration_id: 'always' }, images: [] };
      const body = WallapopAPI.mapGetToPutBody(item, 10);
      expect(body.delivery.cost_configuration_id).toBe('always');
    });

    it('should use pictures as fallback for images', () => {
      const item = { title: 'Test', pictures: [{ id: 'p1' }, { id: 'p2' }] };
      const body = WallapopAPI.mapGetToPutBody(item, 10);
      expect(body.pictures).toEqual([{ id: 'p1', order: 0 }, { id: 'p2', order: 1 }]);
    });
  });

  // ============================================================
  // exportItemsToCSV
  // ============================================================

  describe('exportItemsToCSV', () => {
    it('should generate valid CSV header', () => {
      const csv = WallapopAPI.exportItemsToCSV([]);
      expect(csv).toBe('title,price,category,condition,days_listed,shipping_enabled,url');
    });

    it('should include item data in CSV rows', () => {
      const items = [{
        title: { original: 'Phone' },
        price: { cash: { amount: 100 } },
        taxonomy: [{ name: 'Electronics', id: 1 }],
        type_attributes: { condition: { value: 'good' } },
        creation_date: new Date(Date.now() - 86400000 * 5).toISOString(),
        shipping: { user_allows_shipping: true },
        web_slug: 'phone-123',
      }];
      const csv = WallapopAPI.exportItemsToCSV(items);
      const lines = csv.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('Phone');
      expect(lines[1]).toContain('100');
      expect(lines[1]).toContain('Electronics');
      expect(lines[1]).toContain('true');
    });

    it('should escape commas in title', () => {
      const items = [{ title: 'iPhone 15, 256GB', price: 800, images: [] }];
      const csv = WallapopAPI.exportItemsToCSV(items);
      expect(csv).toContain('"iPhone 15, 256GB"');
    });

    it('quotes CSV separators, quotes and CR/LF in every text column including URLs', () => {
      const csv = WallapopAPI.exportItemsToCSV([{
        id: 'fixture', title: 'first\rsecond', price: 12.5,
        category_name: 'category,one', condition: '"good"\ncondition',
        web_slug: 'slug,"quote"\r\nline', shipping: { user_allows_shipping: true },
      }]);
      expect(csv).toBe('title,price,category,condition,days_listed,shipping_enabled,url\n'
        + '"first\rsecond",12.5,"category,one","""good""\ncondition",,true,'
        + '"https://es.wallapop.com/item/slug,""quote""\r\nline"');
    });

    it.each([
      '=1+1', '+1+1', '-1+1', '@SUM(1)',
      '\tplain text', '\rplain text', '\nplain text', '\u0000plain text',
      ' \t=1+1', '\uFEFF=1+1', '＝1+1', '＋1+1', '－1+1', '＠SUM(1)',
    ])('prefixes formula-like or control-leading text with one quoted tab: %j', (title) => {
      const csv = WallapopAPI.exportItemsToCSV([{ id: 'fixture', title, price: 1 }]);
      expect(csv).toBe('title,price,category,condition,days_listed,shipping_enabled,url\n'
        + `"\t${title}",1,,,,false,https://es.wallapop.com/item/fixture`);
    });

    it('applies spreadsheet text handling to category, condition and non-boolean source data', () => {
      const csv = WallapopAPI.exportItemsToCSV([{
        id: 'fixture', title: 'plain', price: 1, category_name: '+category',
        condition: '@condition', shipping: { user_allows_shipping: '=1+1' },
      }]);
      expect(csv).toBe('title,price,category,condition,days_listed,shipping_enabled,url\n'
        + 'plain,1,"\t+category","\t@condition",,"\t=1+1",https://es.wallapop.com/item/fixture');
    });

    it('preserves numeric and boolean serialization and ordinary or apostrophe-leading text', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const csv = WallapopAPI.exportItemsToCSV([{
          id: 'fixture', title: "'=1+1", sale_price: -12.5, category_name: '0',
          condition: ' good ', creation_date: '2026-01-02T00:00:00Z',
          shipping: { user_allows_shipping: false },
        }]);
        expect(csv).toBe('title,price,category,condition,days_listed,shipping_enabled,url\n'
          + "'=1+1,-12.5,0, good ,-1,false,https://es.wallapop.com/item/fixture");
      } finally {
        vi.useRealTimers();
      }
    });

    it('should handle empty items gracefully', () => {
      const items = [{}];
      const csv = WallapopAPI.exportItemsToCSV(items);
      expect(csv.split('\n').length).toBe(2);
    });
  });

  // ============================================================
  // searchItemsRaw
  // ============================================================

  describe('searchItemsRaw', () => {
    it('should return raw items from search_objects', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          search_objects: [
            { id: '1', title: 'iPhone', price: { cash: { amount: 500 } } },
            { id: '2', title: 'Samsung', price: { cash: { amount: 300 } } },
          ],
        }),
      });

      const items = await WallapopAPI.searchItemsRaw('phone');
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('1');
      expect(items[1].id).toBe('2');
    });

    it('should fallback to items array', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [{ id: '3', title: 'Pixel' }],
        }),
      });

      const items = await WallapopAPI.searchItemsRaw('pixel');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('3');
    });

    it('should return empty array on no results', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const items = await WallapopAPI.searchItemsRaw('nonexistent12345');
      expect(items).toEqual([]);
    });

    it('should throw on API error', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(WallapopAPI.searchItemsRaw('test')).rejects.toThrow('Search API error: 500');
    });

    it('should use public headers without auth', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ search_objects: [] }),
      });

      await WallapopAPI.searchItemsRaw('test');

      const callArgs = globalThis.fetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['Accept']).toBe('application/json');
      expect(headers['X-DeviceOS']).toBe('0');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should include category and location params when provided', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ search_objects: [] }),
      });

      await WallapopAPI.searchItemsRaw('laptop', '15000', 41.3, 2.17);

      const url = globalThis.fetch.mock.calls[0][0];
      expect(url).toContain('category_ids=15000');
      expect(url).toContain('latitude=41.3');
      expect(url).toContain('longitude=2.17');
    });
  });

  // ============================================================
  // fetchPublicItemDetails
  // ============================================================

  describe('fetchPublicItemDetails', () => {
    it('should return item details on success', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'abc123', title: 'PS5', price: { cash: { amount: 400 } } }),
      });

      const item = await WallapopAPI.fetchPublicItemDetails('abc123');
      expect(item).toBeDefined();
      expect(item.id).toBe('abc123');
    });

    it('should return null on 404', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const item = await WallapopAPI.fetchPublicItemDetails('nonexistent');
      expect(item).toBeNull();
    });

    it('should return null on network error', async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error('Network error'));

      const item = await WallapopAPI.fetchPublicItemDetails('abc123');
      expect(item).toBeNull();
    });

    it('should use public headers without auth', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'test' }),
      });

      await WallapopAPI.fetchPublicItemDetails('test123');

      const callArgs = globalThis.fetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['Accept']).toBe('application/json');
      expect(headers['X-DeviceOS']).toBe('0');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should call correct endpoint with item ID', async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'myitem' }),
      });

      await WallapopAPI.fetchPublicItemDetails('myitem');

      const url = globalThis.fetch.mock.calls[0][0];
      expect(url).toContain('/api/v3/items/myitem');
    });
  });
});
