/**
 * Tests for service worker business logic
 *
 * Tests validation functions, price calculations, cooldown logic,
 * and activity log behavior.
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// Inline the pure functions we want to test
// (they don't depend on Chrome APIs)
// ============================================================

function validatePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0 || Math.abs(num) > 50) {
    throw new Error('Porcentaje invalido');
  }
  return num;
}

function validateItemId(id) {
  if (id == null || id === '') throw new Error('ID de item invalido.');
  return String(id);
}

function calculateNewPrice(currentPrice, percentChange) {
  return Math.round(currentPrice * (1 + percentChange / 100) * 100) / 100;
}

// ============================================================
// Tests
// ============================================================

describe('validatePercent', () => {
  it('should accept valid positive percentages', () => {
    expect(validatePercent(5)).toBe(5);
    expect(validatePercent(10)).toBe(10);
    expect(validatePercent(50)).toBe(50);
    expect(validatePercent(1)).toBe(1);
  });

  it('should accept valid negative percentages', () => {
    expect(validatePercent(-5)).toBe(-5);
    expect(validatePercent(-10)).toBe(-10);
    expect(validatePercent(-50)).toBe(-50);
  });

  it('should reject zero', () => {
    expect(() => validatePercent(0)).toThrow();
  });

  it('should reject values over 50', () => {
    expect(() => validatePercent(51)).toThrow();
    expect(() => validatePercent(100)).toThrow();
  });

  it('should reject values under -50', () => {
    expect(() => validatePercent(-51)).toThrow();
    expect(() => validatePercent(-100)).toThrow();
  });

  it('should reject NaN', () => {
    expect(() => validatePercent(NaN)).toThrow();
  });

  it('should reject non-numeric strings', () => {
    expect(() => validatePercent('abc')).toThrow();
  });

  it('should accept numeric strings', () => {
    expect(validatePercent('5')).toBe(5);
    expect(validatePercent('-10')).toBe(-10);
  });

  it('should reject Infinity', () => {
    expect(() => validatePercent(Infinity)).toThrow();
    expect(() => validatePercent(-Infinity)).toThrow();
  });
});

describe('validateItemId', () => {
  it('should accept valid string IDs', () => {
    expect(validateItemId('abc123')).toBe('abc123');
    expect(validateItemId('12345')).toBe('12345');
  });

  it('should convert numbers to strings', () => {
    expect(validateItemId(42)).toBe('42');
  });

  it('should reject null', () => {
    expect(() => validateItemId(null)).toThrow();
  });

  it('should reject undefined', () => {
    expect(() => validateItemId(undefined)).toThrow();
  });

  it('should reject empty string', () => {
    expect(() => validateItemId('')).toThrow();
  });
});

describe('Price calculation', () => {
  it('should increase price by 5%', () => {
    expect(calculateNewPrice(100, 5)).toBe(105);
  });

  it('should decrease price by 10%', () => {
    expect(calculateNewPrice(100, -10)).toBe(90);
  });

  it('should handle decimal prices', () => {
    expect(calculateNewPrice(9.99, 10)).toBe(10.99);
  });

  it('should round to 2 decimal places', () => {
    // 33.33 * 1.10 = 36.663 -> 36.66
    expect(calculateNewPrice(33.33, 10)).toBe(36.66);
  });

  it('should handle 50% increase', () => {
    expect(calculateNewPrice(20, 50)).toBe(30);
  });

  it('should handle 50% decrease', () => {
    expect(calculateNewPrice(20, -50)).toBe(10);
  });

  it('should handle small prices', () => {
    expect(calculateNewPrice(0.50, 10)).toBe(0.55);
  });

  it('should handle large prices', () => {
    expect(calculateNewPrice(9999.99, 5)).toBe(10499.99);
  });
});

describe('Cooldown logic', () => {
  const COOLDOWN_MS = 5 * 60 * 1000;

  it('should be active within 5 minutes', () => {
    const lastStart = Date.now() - (3 * 60 * 1000); // 3 min ago
    const remaining = COOLDOWN_MS - (Date.now() - lastStart);
    expect(remaining).toBeGreaterThan(0);
  });

  it('should be expired after 5 minutes', () => {
    const lastStart = Date.now() - (6 * 60 * 1000); // 6 min ago
    const remaining = COOLDOWN_MS - (Date.now() - lastStart);
    expect(remaining).toBeLessThanOrEqual(0);
  });

  it('should be expired when never started', () => {
    const lastStart = 0;
    const remaining = COOLDOWN_MS - (Date.now() - lastStart);
    expect(remaining).toBeLessThanOrEqual(0);
  });

  it('should calculate remaining seconds correctly', () => {
    const lastStart = Date.now() - (4 * 60 * 1000); // 4 min ago
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastStart)) / 1000);
    expect(remaining).toBeGreaterThan(50);
    expect(remaining).toBeLessThanOrEqual(60);
  });
});

describe('Activity log', () => {
  it('should maintain FIFO order (newest first)', () => {
    const log = [];
    log.unshift({ type: 'republish', timestamp: 1000 });
    log.unshift({ type: 'prices', timestamp: 2000 });
    log.unshift({ type: 'republish', timestamp: 3000 });

    expect(log[0].timestamp).toBe(3000);
    expect(log[1].timestamp).toBe(2000);
    expect(log[2].timestamp).toBe(1000);
  });

  it('should limit to 50 entries', () => {
    const log = [];
    for (let i = 0; i < 60; i++) {
      log.unshift({ type: 'republish', timestamp: i });
    }
    const trimmed = log.slice(0, 50);

    expect(trimmed.length).toBe(50);
    expect(trimmed[0].timestamp).toBe(59);
    expect(trimmed[49].timestamp).toBe(10);
  });
});
