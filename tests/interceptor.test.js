import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../content/interceptor.js', import.meta.url), 'utf8');
const apiUrl = 'https://api.wallapop.com/api/v3/users/me';

function createPage() {
  const fetchResult = Promise.resolve({ ok: true });
  const originalFetch = vi.fn(function () { return fetchResult; });
  const originalOpen = vi.fn(function () { return 'opened'; });
  const originalSetHeader = vi.fn(function () { return 'header-set'; });
  const postMessage = vi.fn();

  class XMLHttpRequest {
    open() { return originalOpen.apply(this, arguments); }
    setRequestHeader() { return originalSetHeader.apply(this, arguments); }
  }

  const location = { href: 'https://es.wallapop.com/catalog' };
  const window = { fetch: originalFetch, postMessage, location };
  runInNewContext(source, { window, location, XMLHttpRequest, Headers, Request, URL });

  return { window, XMLHttpRequest, postMessage, originalFetch, originalOpen, originalSetHeader, fetchResult };
}

function captured(page) {
  return page.postMessage.mock.calls.map(([message]) => ({ ...message }));
}

describe('page token interceptor', () => {
  it('captures a different fetch token without requiring DeviceID', () => {
    const page = createPage();
    page.window.fetch(apiUrl, { headers: { Authorization: 'Bearer synthetic-token-a' } });
    page.window.fetch(apiUrl, { headers: { Authorization: 'Bearer synthetic-token-b' } });

    expect(captured(page)).toEqual([
      { type: 'WT_TOKEN', token: 'synthetic-token-a', deviceId: null },
      { type: 'WT_TOKEN', token: 'synthetic-token-b', deviceId: null },
    ]);
  });

  it('deduplicates a token and device, forwards device changes, and clears the device for a new token', () => {
    const page = createPage();
    const send = (token, deviceId) => page.window.fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}`, ...(deviceId ? { DeviceID: deviceId } : {}) },
    });

    send('synthetic-token-a');
    send('synthetic-token-a');
    send('synthetic-token-a', 'synthetic-device-1');
    send('synthetic-token-a', 'synthetic-device-1');
    send('synthetic-token-a');
    send('synthetic-token-a', 'synthetic-device-2');
    send('synthetic-token-b');

    expect(captured(page)).toEqual([
      { type: 'WT_TOKEN', token: 'synthetic-token-a', deviceId: null },
      { type: 'WT_TOKEN', token: 'synthetic-token-a', deviceId: 'synthetic-device-1' },
      { type: 'WT_TOKEN', token: 'synthetic-token-a', deviceId: 'synthetic-device-2' },
      { type: 'WT_TOKEN', token: 'synthetic-token-b', deviceId: null },
    ]);
  });

  it('captures the effective Request authorization when init.headers replaces it', () => {
    const page = createPage();
    const request = new Request(apiUrl, { headers: { Authorization: 'Bearer synthetic-old-token' } });
    const init = { headers: new Headers({ Authorization: 'Bearer synthetic-new-token' }) };

    page.window.fetch(request, init);

    expect(captured(page)).toEqual([
      { type: 'WT_TOKEN', token: 'synthetic-new-token', deviceId: null },
    ]);
    expect(page.originalFetch).toHaveBeenCalledWith(request, init);
  });

  it('does not capture Request authorization removed by an empty init.headers override', () => {
    const page = createPage();
    const request = new Request(apiUrl, { headers: { Authorization: 'Bearer synthetic-old-token' } });

    page.window.fetch(request, { headers: {} });

    expect(page.postMessage).not.toHaveBeenCalled();
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('accepts tuple-array HeadersInit and URL objects', () => {
    const page = createPage();
    page.window.fetch(new URL(apiUrl), {
      headers: [['authorization', 'Bearer synthetic-tuple-token'], ['DeviceID', 'synthetic-device']],
    });

    expect(captured(page)).toEqual([
      { type: 'WT_TOKEN', token: 'synthetic-tuple-token', deviceId: 'synthetic-device' },
    ]);
  });

  it.each([
    'https://api.wallapop.com.attacker.invalid/items',
    'https://attacker.invalid/api.wallapop.com/items',
    'https://attacker.invalid/?target=api.wallapop.com',
    'http://api.wallapop.com/items',
    'https://api.wallapop.com:444/items',
    'https://api.wallapop.com@attacker.invalid/items',
  ])('does not capture credentials from a different fetch origin: %s', url => {
    const page = createPage();
    page.window.fetch(url, { headers: { Authorization: 'Bearer synthetic-unrelated-token' } });

    expect(page.postMessage).not.toHaveBeenCalled();
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('preserves the original fetch receiver, arguments, and promise when observation fails', () => {
    const page = createPage();
    const receiver = {};
    const init = { headers: { Authorization: 'Bearer synthetic-token' } };
    page.postMessage.mockImplementation(() => { throw new Error('Synthetic observer failure'); });

    const returned = page.window.fetch.call(receiver, apiUrl, init);

    expect(returned).toBe(page.fetchResult);
    expect(page.originalFetch).toHaveBeenCalledExactlyOnceWith(apiUrl, init);
    expect(page.originalFetch.mock.contexts[0]).toBe(receiver);
  });

  it('preserves synchronous original fetch errors', () => {
    const page = createPage();
    const error = new Error('Synthetic native fetch failure');
    page.originalFetch.mockImplementation(() => { throw error; });

    expect(() => page.window.fetch(apiUrl)).toThrow(error);
  });

  it('preserves rejected fetch promises without replacing the error', async () => {
    const page = createPage();
    const error = new Error('Synthetic fetch rejection');
    const rejection = Promise.reject(error);
    page.originalFetch.mockReturnValue(rejection);

    const returned = page.window.fetch(apiUrl);

    expect(returned).toBe(rejection);
    await expect(returned).rejects.toBe(error);
  });

  it('captures changed XHR tokens and DeviceID supplied after Authorization', () => {
    const page = createPage();
    const first = new page.XMLHttpRequest();
    first.open('GET', apiUrl);
    first.setRequestHeader('Authorization', 'Bearer synthetic-token-a');
    first.setRequestHeader('DeviceID', 'synthetic-device');
    first.setRequestHeader('DeviceID', 'synthetic-device');

    const second = new page.XMLHttpRequest();
    second.open('GET', apiUrl);
    second.setRequestHeader('Authorization', 'Bearer synthetic-token-b');

    expect(captured(page)).toEqual([
      { type: 'WT_TOKEN', token: 'synthetic-token-a', deviceId: null },
      { type: 'WT_TOKEN', token: 'synthetic-token-a', deviceId: 'synthetic-device' },
      { type: 'WT_TOKEN', token: 'synthetic-token-b', deviceId: null },
    ]);
  });

  it.each([
    'https://api.wallapop.com.attacker.invalid/items',
    'https://attacker.invalid/?target=api.wallapop.com',
    'http://api.wallapop.com/items',
    'https://api.wallapop.com:444/items',
  ])('does not capture credentials from a different XHR origin: %s', url => {
    const page = createPage();
    const request = new page.XMLHttpRequest();
    request.open('GET', url);
    request.setRequestHeader('Authorization', 'Bearer synthetic-unrelated-token');

    expect(page.postMessage).not.toHaveBeenCalled();
    expect(page.originalOpen).toHaveBeenCalledOnce();
    expect(page.originalSetHeader).toHaveBeenCalledOnce();
  });

  it('preserves original XHR arguments, receivers, and return values when observation fails', () => {
    const page = createPage();
    const request = new page.XMLHttpRequest();
    page.postMessage.mockImplementation(() => { throw new Error('Synthetic observer failure'); });

    expect(request.open('GET', apiUrl, true, 'synthetic-user', 'synthetic-password')).toBe('opened');
    expect(request.setRequestHeader('Authorization', 'Bearer synthetic-token')).toBe('header-set');
    expect(page.originalOpen).toHaveBeenCalledExactlyOnceWith('GET', apiUrl, true, 'synthetic-user', 'synthetic-password');
    expect(page.originalOpen.mock.contexts[0]).toBe(request);
    expect(page.originalSetHeader).toHaveBeenCalledExactlyOnceWith('Authorization', 'Bearer synthetic-token');
    expect(page.originalSetHeader.mock.contexts[0]).toBe(request);
  });

  it('preserves original XHR open errors', () => {
    const page = createPage();
    const error = new Error('Synthetic native open failure');
    page.originalOpen.mockImplementation(() => { throw error; });

    expect(() => new page.XMLHttpRequest().open('GET', apiUrl)).toThrow(error);
  });

  it('does not publish credentials when the original XHR header operation throws', () => {
    const page = createPage();
    const request = new page.XMLHttpRequest();
    const error = new Error('Synthetic native header failure');
    request.open('GET', apiUrl);
    page.originalSetHeader.mockImplementation(() => { throw error; });

    expect(() => request.setRequestHeader('Authorization', 'Bearer synthetic-token')).toThrow(error);
    expect(page.postMessage).not.toHaveBeenCalled();
  });
});
