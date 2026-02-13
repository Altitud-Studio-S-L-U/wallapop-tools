/**
 * Test Setup - Mocks for Chrome Extension APIs
 */

import { vi } from 'vitest';

globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    lastError: null,
    onInstalled: { addListener: vi.fn() },
  },
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: vi.fn() },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
  i18n: {
    getMessage: vi.fn((key, substitutions) => {
      // Return key as message for testing
      if (substitutions && Array.isArray(substitutions)) {
        let msg = key;
        substitutions.forEach((sub, i) => {
          msg += `_${sub}`;
        });
        return msg;
      }
      return key;
    }),
    getUILanguage: vi.fn(() => 'es'),
  },
};

// Mock crypto.subtle for HMAC signature tests
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

// Mock fetch
globalThis.fetch = vi.fn();

// Mock atob/btoa
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary');
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
