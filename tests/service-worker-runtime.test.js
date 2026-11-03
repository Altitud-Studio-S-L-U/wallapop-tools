import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerHarness, deferred } from './helpers/worker-harness.js';

const TOKEN_A = 'test-account-a-token-0001';
const TOKEN_B = 'test-account-b-token-0002';

function item(id, price = 100) {
  return { id, title: `Listing ${id}`, price: { cash: { amount: price } } };
}

function accountFixture({ itemsA = [item('a-1')], itemsB = [item('b-1', 200)] } = {}) {
  const items = new Map([[TOKEN_A, structuredClone(itemsA)], [TOKEN_B, structuredClone(itemsB)]]);
  const api = {
    getMyProfile: vi.fn(async (token) => ({ id: token === TOKEN_A ? 'user-a' : 'user-b' })),
    getAllMyItems: vi.fn(async (token) => structuredClone(items.get(token))),
    republishItem: vi.fn(async () => ({})),
    updateItemPrice: vi.fn(async (token, _device, id, price) => {
      const listing = items.get(token).find((entry) => String(entry.id) === String(id));
      if (!listing) throw new Error('The provider rejected an item belonging to a different account.');
      listing.price.cash.amount = price;
      return {};
    }),
  };
  const worker = createWorkerHarness({
    session: { token: TOKEN_A, deviceId: 'device-a', userId: 'user-a', hostname: 'es.wallapop.com' },
    api,
  });
  return { worker, api, items };
}

async function adjust(worker, percent = 10) {
  const complete = worker.nextMessage((message) => message.type === 'OPERATION_COMPLETE' && message.operation === 'prices');
  expect(await worker.request({ type: 'ADJUST_PRICES', percent })).toEqual({ started: true });
  await vi.runAllTimersAsync();
  return complete;
}

function captureB(worker) {
  worker.dispatch({ type: 'TOKEN_CAPTURED', token: TOKEN_B, deviceId: 'device-b', hostname: 'es.wallapop.com' });
}

describe('service worker runtime regressions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each([undefined, null, [], 'a-1', { length: 1 }, [null], [{}]].map((itemIds) => ({ itemIds })))('rejects invalid selected-price IDs before starting: $itemIds', async ({ itemIds }) => {
    const { worker, api } = accountFixture();
    const result = await worker.request({ type: 'ADJUST_SELECTED_PRICES', percent: 10, itemIds });
    await vi.runAllTimersAsync();
    expect(result.error).toBeTruthy();
    expect(api.updateItemPrice).not.toHaveBeenCalled();
    expect(worker.messages.some((message) => message.type === 'OPERATION_COMPLETE')).toBe(false);
  });

  it.each([undefined, null, [], 'a-1', { length: 1 }, [null], [{}]].map((itemIds) => ({ itemIds })))('rejects invalid selected-reactivation IDs before starting: $itemIds', async ({ itemIds }) => {
    const { worker, api } = accountFixture();
    const result = await worker.request({ type: 'REPUBLISH_SELECTED', itemIds });
    await vi.runAllTimersAsync();
    expect(result.error).toBeTruthy();
    expect(api.republishItem).not.toHaveBeenCalled();
    expect(worker.messages.some((message) => message.type === 'OPERATION_COMPLETE')).toBe(false);
  });

  it('adjusts only the explicitly selected listing, once, with other inventory loaded', async () => {
    const { worker, api } = accountFixture({ itemsA: [item('a-1'), item('a-2')] });
    const complete = worker.nextMessage((message) => message.type === 'OPERATION_COMPLETE');
    expect(await worker.request({ type: 'ADJUST_SELECTED_PRICES', percent: 10, itemIds: ['a-2', 'a-2'] })).toEqual({ started: true });
    await vi.runAllTimersAsync();
    expect(await complete).toMatchObject({ total: 1, success: 1, failed: 0 });
    expect(api.updateItemPrice.mock.calls.map((call) => [call[2], call[3]])).toEqual([['a-2', 110]]);
  });

  it('reactivates a duplicate selected listing only once', async () => {
    const { worker, api } = accountFixture({ itemsA: [item('a-1'), item('a-2')] });
    const complete = worker.nextMessage((message) => message.type === 'OPERATION_COMPLETE');
    expect(await worker.request({ type: 'REPUBLISH_SELECTED', itemIds: ['a-2', 'a-2'] })).toEqual({ started: true });
    await vi.runAllTimersAsync();
    expect(await complete).toMatchObject({ total: 1, success: 1, failed: 0 });
    expect(api.republishItem.mock.calls.map((call) => call[2])).toEqual(['a-2']);
  });

  it('uses the latest confirmed prices for consecutive percentage adjustments: 100 → 110 → 121', async () => {
    const { worker, api } = accountFixture();
    expect((await worker.request({ type: 'LOAD_ITEMS' })).items[0].price).toBe(100);
    expect((await adjust(worker)).success).toBe(1);
    expect((await adjust(worker)).success).toBe(1);
    expect(api.updateItemPrice.mock.calls.map((call) => call[3])).toEqual([110, 121]);
  });

  it('uses the confirmed exact price for the next percentage adjustment: 200 → 220', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    expect(await worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'a-1', newPrice: 200 })).toMatchObject({ success: true });
    expect((await adjust(worker)).success).toBe(1);
    expect(api.updateItemPrice.mock.calls.map((call) => call[3])).toEqual([200, 220]);
  });

  it('uses only confirmed price changes when a bulk adjustment partially fails', async () => {
    const { worker, api } = accountFixture({ itemsA: [item('a-1'), item('a-2')] });
    const successfulWrite = api.updateItemPrice.getMockImplementation();
    let rejectSecondItem = true;
    api.updateItemPrice.mockImplementation(async (...args) => {
      if (args[2] === 'a-2' && rejectSecondItem) {
        rejectSecondItem = false;
        throw new Error('Provider validation failed.');
      }
      return successfulWrite(...args);
    });
    await worker.request({ type: 'LOAD_ITEMS' });
    expect(await adjust(worker)).toMatchObject({ success: 1, failed: 1 });
    expect(await adjust(worker)).toMatchObject({ success: 2, failed: 0 });
    expect(api.updateItemPrice.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ['a-1', 110], ['a-2', 110], ['a-1', 121], ['a-2', 110],
    ]);
  });

  it('captures a different token and confirms its profile before loading or modifying that account', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    captureB(worker);
    await worker.flush();
    expect(worker.state.session.token).toBe(TOKEN_B);
    expect(worker.state.session.userId).toBe('user-b');
    expect(api.getMyProfile).toHaveBeenCalledWith(TOKEN_B, 'device-b');
    const bLoads = api.getAllMyItems.mock.calls.filter((call) => call[0] === TOKEN_B);
    expect(bLoads.length).toBeGreaterThan(0);
    expect(bLoads.every((call) => call[2] === 'user-b')).toBe(true);
    expect((await adjust(worker)).success).toBe(1);
    expect(api.updateItemPrice.mock.lastCall.slice(0, 4)).toEqual([TOKEN_B, 'device-b', 'b-1', 220]);
  });

  it('does not replace the current profile with a late profile response from the previous token', async () => {
    const { worker, api } = accountFixture();
    delete worker.state.session.userId;
    const oldProfile = deferred();
    api.getMyProfile.mockImplementation((token) => token === TOKEN_A ? oldProfile.promise : Promise.resolve({ id: 'user-b' }));
    const oldLoad = worker.request({ type: 'LOAD_ITEMS' });
    await worker.flush();
    expect(api.getMyProfile).toHaveBeenCalledWith(TOKEN_A, 'device-a');
    captureB(worker);
    await worker.flush();
    oldProfile.resolve({ id: 'user-a' });
    const oldResult = await oldLoad;
    expect(oldResult.error).toBeTruthy();
    expect(worker.state.session.userId).toBe('user-b');
    expect(api.getAllMyItems.mock.calls.some((call) => call[0] === TOKEN_A)).toBe(false);
    const exported = await worker.request({ type: 'EXPORT_CSV' });
    expect(exported.csv).toContain('Listing b-1');
    expect(exported.csv).not.toContain('Listing a-1');
  });

  it('does not replace current items or their count with a late items response from the previous token', async () => {
    const { worker, api } = accountFixture({ itemsB: [item('b-1', 200), item('b-2', 300)] });
    const oldItems = deferred();
    api.getAllMyItems.mockImplementation((token) => token === TOKEN_A ? oldItems.promise : Promise.resolve([item('b-1', 200), item('b-2', 300)]));
    const oldLoad = worker.request({ type: 'LOAD_ITEMS' });
    await worker.flush();
    captureB(worker);
    await worker.flush();
    oldItems.resolve([item('a-1')]);
    expect((await oldLoad).error).toBeTruthy();
    expect(worker.state.local.wallapop_item_count).toBe(2);
    const exported = await worker.request({ type: 'EXPORT_CSV' });
    expect(exported.csv).toContain('Listing b-1');
    expect(exported.csv).not.toContain('Listing a-1');
    expect(Object.keys(worker.state.local.item_tracking).sort()).toEqual(['b-1', 'b-2']);
  });

  it('does not clear a newer token when a pending write receives an old 401', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    const oldWrite = deferred();
    api.updateItemPrice.mockImplementationOnce(() => oldWrite.promise);
    const operation = worker.call('adjustAllPrices', 10);
    operation.catch(() => {});
    await worker.flush();
    expect(api.updateItemPrice).toHaveBeenCalledTimes(1);
    captureB(worker);
    await worker.flush();
    oldWrite.reject(new Error('TOKEN_EXPIRED'));
    await expect(operation).rejects.toThrow();
    expect(worker.state.session.token).toBe(TOKEN_B);
    expect(worker.state.session.userId).toBe('user-b');
    expect((await worker.request({ type: 'GET_STATUS' })).authenticated).toBe(true);
  });

  it('stops new bulk writes after token changes and keeps the operation lock until the pending write settles', async () => {
    const { worker, api } = accountFixture({ itemsA: [item('a-1'), item('a-2')] });
    await worker.request({ type: 'LOAD_ITEMS' });
    const oldWrite = deferred();
    api.updateItemPrice.mockImplementationOnce(() => oldWrite.promise);
    const operation = worker.call('adjustAllPrices', 10);
    operation.catch(() => {});
    await worker.flush();
    captureB(worker);
    await worker.flush();
    expect((await worker.request({ type: 'GET_STATUS' })).operationInProgress).toBe(true);
    await expect(worker.call('adjustAllPrices', 10)).rejects.toThrow('errorOperationInProgress');
    expect(await worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'b-1', newPrice: 250 })).toEqual({ error: 'errorOperationInProgress' });
    oldWrite.resolve({});
    await vi.runAllTimersAsync();
    await expect(operation).rejects.toThrow();
    expect(api.updateItemPrice.mock.calls.map((call) => [call[0], call[2]])).toEqual([[TOKEN_A, 'a-1']]);
    expect((await worker.request({ type: 'GET_STATUS' })).operationInProgress).toBe(false);
    const exported = await worker.request({ type: 'EXPORT_CSV' });
    expect(exported.csv).toContain('Listing b-1,200');
    expect(exported.csv).not.toContain('Listing a-1');
  });

  it('does not discard the confirmed profile or prices when the identical token is captured again', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    await adjust(worker);
    const profileCalls = api.getMyProfile.mock.calls.length;
    const itemCalls = api.getAllMyItems.mock.calls.length;
    worker.dispatch({ type: 'TOKEN_CAPTURED', token: TOKEN_A, deviceId: 'device-a', hostname: 'es.wallapop.com' });
    await worker.flush();
    expect(api.getMyProfile).toHaveBeenCalledTimes(profileCalls);
    expect(api.getAllMyItems).toHaveBeenCalledTimes(itemCalls);
    await adjust(worker);
    expect(api.updateItemPrice.mock.calls.map((call) => call[3])).toEqual([110, 121]);
  });

  it('ignores token captures from an untrusted origin or another extension', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    for (const sender of [
      { id: 'test-extension-id', url: 'https://example.invalid/' },
      { id: 'test-extension-id', url: 'https://es.wallapop.com.attacker.invalid/' },
      { id: 'test-extension-id', url: 'http://es.wallapop.com/' },
      { id: 'another-extension', url: 'https://es.wallapop.com/' },
    ]) {
      worker.dispatch({ type: 'TOKEN_CAPTURED', token: TOKEN_B, deviceId: 'device-b', hostname: 'es.wallapop.com' }, undefined, sender);
    }
    await worker.flush();
    expect(worker.state.session.token).toBe(TOKEN_A);
    expect(worker.state.session.userId).toBe('user-a');
    expect(api.getMyProfile.mock.calls.some((call) => call[0] === TOKEN_B)).toBe(false);
  });

  it('derives the API hostname from a trusted sender and does not inherit another account device', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    worker.dispatch({ type: 'TOKEN_CAPTURED', token: TOKEN_B, hostname: 'attacker.invalid' }, undefined, { id: 'test-extension-id', url: 'https://fr.wallapop.com/app/catalog/published' });
    await worker.flush();
    expect(worker.state.session.token).toBe(TOKEN_B);
    expect(worker.state.session.hostname).toBe('fr.wallapop.com');
    expect(worker.state.session.deviceId).not.toBe('device-a');
    const profileCall = api.getMyProfile.mock.calls.find((call) => call[0] === TOKEN_B);
    expect(profileCall).toBeTruthy();
    expect(profileCall[1]).toBeNull();
    expect(worker.state.session.userId).toBe('user-b');
  });

  it('rejects item selections from the previous account before sending any write request', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    captureB(worker);
    await worker.flush();
    expect(await worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'a-1', newPrice: 250 })).toEqual({ error: 'errorInvalidItemId' });
    await expect(worker.call('republishSelected', ['a-1'])).rejects.toThrow('errorInvalidItemId');
    await expect(worker.call('adjustAllPrices', 10, undefined, ['a-1'])).rejects.toThrow('errorInvalidItemId');
    expect(api.updateItemPrice).not.toHaveBeenCalled();
    expect(api.republishItem).not.toHaveBeenCalled();
  });

  it.each(['before', 'during'])('does not repopulate the cache from a read started %s a price write', async (timing) => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    const staleRead = deferred();
    api.getAllMyItems.mockImplementationOnce(() => staleRead.promise);
    let reading;
    let writing;
    if (timing === 'before') {
      reading = worker.request({ type: 'LOAD_ITEMS' });
      await worker.flush();
      writing = worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'a-1', newPrice: 200 });
    } else {
      const started = deferred();
      const finish = deferred();
      const providerWrite = api.updateItemPrice.getMockImplementation();
      api.updateItemPrice.mockImplementationOnce(async (...args) => {
        started.resolve();
        await finish.promise;
        return providerWrite(...args);
      });
      writing = worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'a-1', newPrice: 200 });
      await started.promise;
      reading = worker.request({ type: 'LOAD_ITEMS' });
      await worker.flush();
      finish.resolve();
    }
    expect(await writing).toMatchObject({ success: true });
    staleRead.resolve([item('a-1', 100)]);
    expect((await reading).error).toBeTruthy();
    expect((await worker.request({ type: 'EXPORT_CSV' })).csv).toContain('Listing a-1,200');
    expect((await adjust(worker)).success).toBe(1);
    expect(api.updateItemPrice.mock.calls.map((call) => call[3])).toEqual([200, 220]);
  });

  it('reverifies a replacement token even when it belongs to the same user', async () => {
    const { worker, api } = accountFixture();
    api.getMyProfile.mockImplementation(async () => ({ id: 'user-a' }));
    await worker.request({ type: 'LOAD_ITEMS' });
    captureB(worker);
    await worker.flush();
    expect(api.getMyProfile).toHaveBeenCalledWith(TOKEN_B, 'device-b');
    expect(worker.state.session.userId).toBe('user-a');
    expect(api.getAllMyItems.mock.calls.filter((call) => call[0] === TOKEN_B).every((call) => call[2] === 'user-a')).toBe(true);
  });

  it('preserves the republish cooldown when the same user receives a replacement token', async () => {
    const { worker, api } = accountFixture();
    api.getMyProfile.mockImplementation(async () => ({ id: 'user-a' }));
    await worker.request({ type: 'LOAD_ITEMS' });
    expect((await worker.call('republishAll')).success).toBe(1);
    captureB(worker);
    await worker.flush();
    expect(worker.state.session.userId).toBe('user-a');
    expect((await worker.request({ type: 'GET_STATUS' })).cooldownRemaining).toBeGreaterThan(0);
    await expect(worker.call('republishAll')).rejects.toThrow('errorCooldown');
    expect(api.republishItem).toHaveBeenCalledTimes(1);
  });

  it('fails closed after token storage fails and permits recovery through a successful capture', async () => {
    const { worker, api } = accountFixture();
    await worker.request({ type: 'LOAD_ITEMS' });
    worker.chrome.storage.session.set.mockRejectedValueOnce(new Error('Session storage unavailable.'));
    expect((await worker.request({ type: 'TOKEN_CAPTURED', token: TOKEN_B, deviceId: 'device-b' })).error).toBeTruthy();
    expect((await worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'a-1', newPrice: 200 })).error).toBeTruthy();
    expect((await worker.request({ type: 'EXPORT_CSV' })).error).toBeTruthy();
    expect((await worker.request({ type: 'GET_STATUS' })).authenticated).toBe(false);
    expect(api.updateItemPrice).not.toHaveBeenCalled();
    expect(await worker.request({ type: 'TOKEN_CAPTURED', token: TOKEN_B, deviceId: 'device-b' })).toEqual({ success: true });
    expect(worker.state.session.userId).toBe('user-b');
    expect((await worker.request({ type: 'UPDATE_ITEM_PRICE', itemId: 'b-1', newPrice: 250 })).success).toBe(true);
  });
});
