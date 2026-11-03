import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from './helpers/worker-harness.js';

const source = readFileSync(new URL('../utils/wallapop-api.js', import.meta.url), 'utf8');
const TOKEN = 'synthetic-guard-token';

function response() {
  return new Response(JSON.stringify({ id: 'a-1', title: 'Synthetic listing', description: '', price: { amount: 100 } }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

function createApi({ fetch, sign } = {}) {
  const sandbox = {
    TextEncoder,
    atob,
    btoa,
    setTimeout,
    console: { error: vi.fn() },
    fetch: fetch || vi.fn(async () => response()),
    crypto: {
      subtle: {
        importKey: (...args) => webcrypto.subtle.importKey(...args),
        sign: sign || ((...args) => webcrypto.subtle.sign(...args)),
      },
    },
  };
  const api = runInNewContext(`${source}\nWallapopAPI;`, sandbox, { filename: 'utils/wallapop-api.js' });
  return { api, fetch: sandbox.fetch };
}

describe('API session guards before outgoing mutations', () => {
  it('does not send a PUT if the session changes while GET item details is pending', async () => {
    const details = deferred();
    const requested = deferred();
    const fetch = vi.fn(async (_url, options) => {
      expect(options.method).toBe('GET');
      requested.resolve();
      return details.promise;
    });
    const { api } = createApi({ fetch });
    let valid = true;
    const guard = vi.fn(() => { if (!valid) throw new Error('Session changed.'); });
    const writing = api.updateItemPrice(TOKEN, 'device', 'a-1', 120, 'es.wallapop.com', guard);
    writing.catch(() => {});
    await requested.promise;
    valid = false;
    details.resolve(response());
    await expect(writing).rejects.toThrow('Session changed.');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledOnce();
  });

  it.each(['price', 'republish'])('checks the session after a pending %s write signature and before fetch', async (operation) => {
    const signing = deferred();
    const permitSignature = deferred();
    const sign = vi.fn(async (...args) => {
      const message = new TextDecoder().decode(args[2]);
      if (message.startsWith('PUT|')) {
        signing.resolve();
        await permitSignature.promise;
      }
      return webcrypto.subtle.sign(...args);
    });
    const { api, fetch } = createApi({ sign });
    let valid = true;
    const guard = vi.fn(() => { if (!valid) throw new Error('Session changed.'); });
    const writing = operation === 'price'
      ? api.updateItemPrice(TOKEN, 'device', 'a-1', 120, 'es.wallapop.com', guard)
      : api.republishItem(TOKEN, 'device', 'a-1', 'es.wallapop.com', guard);
    writing.catch(() => {});
    await signing.promise;
    valid = false;
    permitSignature.resolve();
    await expect(writing).rejects.toThrow('Session changed.');
    expect(fetch.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(operation === 'price' ? 1 : 0);
    expect(guard).toHaveBeenCalledOnce();
  });
});
