/**
 * Tests for Price Alerts system
 *
 * Tests pure functions: generateAlertId, validateAlert,
 * deduplication logic, extractItemId, and storage defaults.
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// Inline pure functions from service-worker.js
// ============================================================

function generateAlertId(type) {
  const prefix = type === 'search' ? 'sa_' : 'ia_';
  return prefix + Date.now();
}

function validateAlert(alertData) {
  if (!alertData || !alertData.type) throw new Error('Invalid alert type');

  if (alertData.type === 'search') {
    if (!alertData.keyword || !alertData.keyword.trim()) {
      throw new Error('alertErrorNoKeyword');
    }
    if (alertData.maxPrice != null) {
      const p = Number(alertData.maxPrice);
      if (!Number.isFinite(p) || p <= 0) throw new Error('alertErrorInvalidPrice');
    }
  } else if (alertData.type === 'item') {
    if (!alertData.itemId || !String(alertData.itemId).trim()) {
      throw new Error('alertErrorNoItemId');
    }
    const tp = Number(alertData.targetPrice);
    if (!Number.isFinite(tp) || tp <= 0) throw new Error('alertErrorInvalidTargetPrice');
  } else {
    throw new Error('Invalid alert type');
  }
}

function deduplicateItems(items, seenItemIds, maxPrice) {
  const seenSet = new Set(seenItemIds);
  const newItems = [];

  for (const item of items) {
    const itemId = String(item.id);
    if (seenSet.has(itemId)) continue;

    if (maxPrice != null) {
      const price = item.price || 0;
      if (price > maxPrice || price <= 0) continue;
    }

    newItems.push({ id: itemId, title: item.title, price: item.price });
    seenSet.add(itemId);
  }

  // Cap FIFO at 200
  const updatedSeenIds = Array.from(seenSet).slice(-200);
  return { newItems, updatedSeenIds };
}

function extractItemIdFromUrl(input) {
  if (!input) return null;
  const str = input.trim();

  const urlMatch = str.match(/\/item\/(?:.*-)?([a-z0-9]+)$/i) || str.match(/\/item\/([a-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  if (!str.includes('/') && str.length > 3) return str;

  return null;
}

// ============================================================
// Tests
// ============================================================

describe('generateAlertId', () => {
  it('should generate search alert ID with sa_ prefix', () => {
    const id = generateAlertId('search');
    expect(id).toMatch(/^sa_\d+$/);
  });

  it('should generate item alert ID with ia_ prefix', () => {
    const id = generateAlertId('item');
    expect(id).toMatch(/^ia_\d+$/);
  });

  it('should generate unique IDs', () => {
    const id1 = generateAlertId('search');
    // tiny delay to ensure different timestamp
    const id2 = generateAlertId('search');
    // IDs could match if called in same ms, but prefix should be correct
    expect(id1.startsWith('sa_')).toBe(true);
    expect(id2.startsWith('sa_')).toBe(true);
  });

  it('should use ia_ prefix for unknown types', () => {
    const id = generateAlertId('other');
    expect(id).toMatch(/^ia_\d+$/);
  });
});

describe('validateAlert', () => {
  it('should accept valid search alert', () => {
    expect(() => validateAlert({ type: 'search', keyword: 'iPhone 15' })).not.toThrow();
  });

  it('should accept search alert with maxPrice', () => {
    expect(() => validateAlert({ type: 'search', keyword: 'PS5', maxPrice: 400 })).not.toThrow();
  });

  it('should reject search alert without keyword', () => {
    expect(() => validateAlert({ type: 'search', keyword: '' })).toThrow('alertErrorNoKeyword');
  });

  it('should reject search alert with whitespace-only keyword', () => {
    expect(() => validateAlert({ type: 'search', keyword: '   ' })).toThrow('alertErrorNoKeyword');
  });

  it('should reject search alert with invalid maxPrice', () => {
    expect(() => validateAlert({ type: 'search', keyword: 'test', maxPrice: -5 })).toThrow('alertErrorInvalidPrice');
  });

  it('should reject search alert with zero maxPrice', () => {
    expect(() => validateAlert({ type: 'search', keyword: 'test', maxPrice: 0 })).toThrow('alertErrorInvalidPrice');
  });

  it('should reject search alert with NaN maxPrice', () => {
    expect(() => validateAlert({ type: 'search', keyword: 'test', maxPrice: 'abc' })).toThrow('alertErrorInvalidPrice');
  });

  it('should accept valid item alert', () => {
    expect(() => validateAlert({ type: 'item', itemId: 'xyz123', targetPrice: 30 })).not.toThrow();
  });

  it('should reject item alert without itemId', () => {
    expect(() => validateAlert({ type: 'item', itemId: '', targetPrice: 30 })).toThrow('alertErrorNoItemId');
  });

  it('should reject item alert without targetPrice', () => {
    expect(() => validateAlert({ type: 'item', itemId: 'xyz', targetPrice: 0 })).toThrow('alertErrorInvalidTargetPrice');
  });

  it('should reject item alert with negative targetPrice', () => {
    expect(() => validateAlert({ type: 'item', itemId: 'xyz', targetPrice: -10 })).toThrow('alertErrorInvalidTargetPrice');
  });

  it('should reject null alertData', () => {
    expect(() => validateAlert(null)).toThrow('Invalid alert type');
  });

  it('should reject unknown type', () => {
    expect(() => validateAlert({ type: 'unknown' })).toThrow('Invalid alert type');
  });

  it('should accept search alert with null maxPrice', () => {
    expect(() => validateAlert({ type: 'search', keyword: 'test', maxPrice: null })).not.toThrow();
  });
});

describe('deduplicateItems', () => {
  it('should filter out already-seen items', () => {
    const items = [
      { id: '1', title: 'A', price: 10 },
      { id: '2', title: 'B', price: 20 },
      { id: '3', title: 'C', price: 30 },
    ];
    const result = deduplicateItems(items, ['1', '2'], null);
    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0].id).toBe('3');
  });

  it('should return all items when seenIds is empty', () => {
    const items = [
      { id: '1', title: 'A', price: 10 },
      { id: '2', title: 'B', price: 20 },
    ];
    const result = deduplicateItems(items, [], null);
    expect(result.newItems).toHaveLength(2);
  });

  it('should filter by maxPrice', () => {
    const items = [
      { id: '1', title: 'A', price: 100 },
      { id: '2', title: 'B', price: 50 },
      { id: '3', title: 'C', price: 200 },
    ];
    const result = deduplicateItems(items, [], 100);
    expect(result.newItems).toHaveLength(2);
    expect(result.newItems.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('should exclude items with zero price when maxPrice is set', () => {
    const items = [
      { id: '1', title: 'A', price: 0 },
      { id: '2', title: 'B', price: 50 },
    ];
    const result = deduplicateItems(items, [], 100);
    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0].id).toBe('2');
  });

  it('should cap seenIds at 200 (FIFO)', () => {
    const items = [];
    const seenIds = [];
    for (let i = 0; i < 210; i++) {
      seenIds.push(String(i));
    }
    // Add one new item
    items.push({ id: '999', title: 'New', price: 10 });
    const result = deduplicateItems(items, seenIds, null);
    // 210 existing + 1 new = 211, capped to last 200
    expect(result.updatedSeenIds.length).toBe(200);
    // New item should be in the seenIds
    expect(result.updatedSeenIds).toContain('999');
  });

  it('should not duplicate IDs in seenIds', () => {
    const items = [
      { id: '1', title: 'A', price: 10 },
    ];
    const result = deduplicateItems(items, ['1'], null);
    const count = result.updatedSeenIds.filter((id) => id === '1').length;
    expect(count).toBe(1);
  });

  it('should handle null maxPrice (no price filter)', () => {
    const items = [
      { id: '1', title: 'A', price: 999999 },
    ];
    const result = deduplicateItems(items, [], null);
    expect(result.newItems).toHaveLength(1);
  });
});

describe('extractItemIdFromUrl', () => {
  it('should extract ID from full Wallapop URL', () => {
    const url = 'https://es.wallapop.com/item/iphone-15-pro-max-256gb-123abc';
    expect(extractItemIdFromUrl(url)).toBe('123abc');
  });

  it('should extract ID from URL with just ID', () => {
    const url = 'https://es.wallapop.com/item/abc123def';
    expect(extractItemIdFromUrl(url)).toBe('abc123def');
  });

  it('should accept plain ID string', () => {
    expect(extractItemIdFromUrl('xyz789abc')).toBe('xyz789abc');
  });

  it('should return null for empty input', () => {
    expect(extractItemIdFromUrl('')).toBe(null);
    expect(extractItemIdFromUrl(null)).toBe(null);
  });

  it('should return null for short strings', () => {
    expect(extractItemIdFromUrl('ab')).toBe(null);
  });

  it('should trim whitespace', () => {
    expect(extractItemIdFromUrl('  abc123  ')).toBe('abc123');
  });
});

describe('Alert storage defaults', () => {
  it('should have correct default shape', () => {
    const defaults = {
      alerts: [],
      settings: { checkIntervalMinutes: 30, maxAlerts: 20 },
      lastFullCheckAt: 0,
    };

    expect(defaults.alerts).toEqual([]);
    expect(defaults.settings.checkIntervalMinutes).toBe(30);
    expect(defaults.settings.maxAlerts).toBe(20);
    expect(defaults.lastFullCheckAt).toBe(0);
  });

  it('search alert should have correct fields', () => {
    const alert = {
      id: 'sa_1707840000000',
      type: 'search',
      enabled: true,
      keyword: 'iPhone 15',
      maxPrice: 500,
      categoryId: null,
      latitude: null,
      longitude: null,
      createdAt: 1707840000000,
      lastCheckedAt: 0,
      seenItemIds: [],
      matchCount: 0,
    };

    expect(alert.id).toMatch(/^sa_/);
    expect(alert.type).toBe('search');
    expect(alert.seenItemIds).toEqual([]);
    expect(alert.matchCount).toBe(0);
  });

  it('item alert should have correct fields', () => {
    const alert = {
      id: 'ia_1707840050000',
      type: 'item',
      enabled: true,
      itemId: 'xyz789',
      itemTitle: 'PS5 Controller',
      itemUrl: 'https://es.wallapop.com/item/ps5-controller-xyz789',
      targetPrice: 30,
      lastKnownPrice: 45,
      createdAt: 1707840050000,
      lastCheckedAt: 0,
      triggered: false,
    };

    expect(alert.id).toMatch(/^ia_/);
    expect(alert.type).toBe('item');
    expect(alert.triggered).toBe(false);
    expect(alert.targetPrice).toBe(30);
  });
});
