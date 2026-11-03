import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { vi } from 'vitest';

const workerSource = readFileSync(new URL('../../background/service-worker.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../utils/wallapop-api.js', import.meta.url), 'utf8');

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function createWorkerHarness({ session = {}, local = {}, api = {} } = {}) {
  const state = { session: structuredClone(session), local: structuredClone(local) };
  const listeners = { messages: [], installed: [], alarms: [], storage: [] };
  const messages = [];
  const waiters = [];

  const storageArea = (name) => ({
    get: vi.fn(async (keys) => {
      const values = state[name];
      if (keys == null) return structuredClone(values);
      if (typeof keys === 'string') keys = [keys];
      const result = {};
      if (Array.isArray(keys)) {
        for (const key of keys) if (Object.hasOwn(values, key)) result[key] = values[key];
      } else {
        for (const [key, fallback] of Object.entries(keys)) result[key] = Object.hasOwn(values, key) ? values[key] : fallback;
      }
      return structuredClone(result);
    }),
    set: vi.fn(async (fields) => {
      const changes = {};
      for (const [key, value] of Object.entries(fields)) {
        changes[key] = { oldValue: state[name][key], newValue: structuredClone(value) };
        state[name][key] = structuredClone(value);
      }
      for (const listener of listeners.storage) listener(structuredClone(changes), name);
    }),
    remove: vi.fn(async (keys) => {
      const changes = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (Object.hasOwn(state[name], key)) {
          changes[key] = { oldValue: state[name][key] };
          delete state[name][key];
        }
      }
      for (const listener of listeners.storage) listener(structuredClone(changes), name);
    }),
  });

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      onMessage: { addListener: (listener) => listeners.messages.push(listener) },
      onInstalled: { addListener: (listener) => listeners.installed.push(listener) },
      sendMessage: vi.fn(async (message) => {
        const snapshot = structuredClone(message);
        messages.push(snapshot);
        for (let index = waiters.length - 1; index >= 0; index--) {
          if (waiters[index].predicate(snapshot)) waiters.splice(index, 1)[0].resolve(snapshot);
        }
      }),
    },
    storage: {
      session: storageArea('session'),
      local: storageArea('local'),
      onChanged: { addListener: (listener) => listeners.storage.push(listener) },
    },
    alarms: {
      create: vi.fn(), clear: vi.fn(async () => true),
      onAlarm: { addListener: (listener) => listeners.alarms.push(listener) },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    declarativeNetRequest: { updateDynamicRules: vi.fn(async () => {}) },
    notifications: { create: vi.fn() },
    i18n: { getMessage: vi.fn((key) => key) },
  };

  const context = createContext({
    chrome,
    console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    Date,
    Math,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    crypto: globalThis.crypto,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    fetch: vi.fn(async () => { throw new Error('Network access is disabled in the service worker harness.'); }),
    __apiOverrides: api,
    importScripts: (path) => {
      if (path !== '../utils/wallapop-api.js') throw new Error(`Unexpected importScripts path: ${path}`);
      runInContext(apiSource, context, { filename: 'utils/wallapop-api.js' });
      runInContext('Object.assign(WallapopAPI, __apiOverrides)', context);
    },
  });
  runInContext(workerSource, context, { filename: 'background/service-worker.js' });

  function dispatch(message, respond = () => {}, sender = { id: 'test-extension-id', url: 'https://es.wallapop.com/app/catalog/published' }) {
    for (const listener of listeners.messages) listener(structuredClone(message), structuredClone(sender), respond);
  }

  return {
    state,
    chrome,
    messages,
    dispatch,
    request: (message) => new Promise((resolve) => dispatch(message, resolve)),
    nextMessage: (predicate) => new Promise((resolve) => waiters.push({ predicate, resolve })),
    call: (name, ...args) => {
      if (typeof context[name] !== 'function') throw new Error(`No worker function named ${name}`);
      return context[name](...args);
    },
    flush: () => vi.advanceTimersByTimeAsync(0),
  };
}
