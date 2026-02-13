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
});
