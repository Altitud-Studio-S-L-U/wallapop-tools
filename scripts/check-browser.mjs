import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional integration check: Playwright and Chromium are supplied externally.
// Every HTTP request is fulfilled or blocked; no real Wallapop account is used.
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'));
} catch (error) {
  throw new Error('Provide an external Playwright installation through PLAYWRIGHT_MODULE_PATH; see README.', { cause: error });
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.indexOf('--extension');
const extensionPath = argument === -1 ? root : resolve(process.argv[argument + 1] || '');
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
const scratchRoot = join(root, '.tmp');
await mkdir(scratchRoot, { recursive: true });
const profile = await mkdtemp(join(scratchRoot, 'browser-check-'));
const tokenA = 'fixture-account-a-token-not-a-real-credential';
const tokenB = 'fixture-account-b-token-not-a-real-credential';
const accounts = new Map([
  [tokenA, { id: 'fixture-user-a', item: listing('fixture-item-a', 'Fixture listing A', 100) }],
  [tokenB, { id: 'fixture-user-b', item: listing('fixture-item-b', 'Fixture listing B', 200) }],
]);
const requests = [];
const unexpectedRequests = [];
const checks = [];
const browserErrors = [];
let uncertainNextWrite = false;
let pendingWrite;
let context;

function listing(id, title, price) {
  return { id, title, description: 'Synthetic browser-test data.', price: { cash: { amount: price } }, images: [], taxonomy: [{ id: 1, name: 'Fixture category' }] };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function withinDeadline(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 15_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function message(page, payload) {
  return page.evaluate((input) => chrome.runtime.sendMessage(input), payload);
}

async function armMessages(page) {
  await page.evaluate(() => {
    globalThis.fixturePriceResults = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'OPERATION_COMPLETE' && message.operation === 'prices') {
        globalThis.fixturePriceResults.push(message);
      }
    });
  });
}

async function bulk(page, percent, viaUi = false) {
  const before = await page.evaluate(() => globalThis.fixturePriceResults.length);
  if (viaUi) {
    await page.locator('#price-percent').fill(String(percent));
    await page.locator('#btn-raise').click();
  } else {
    assert.deepEqual(await message(page, { type: 'ADJUST_PRICES', percent }), { started: true });
  }
  await page.waitForFunction((count) => globalThis.fixturePriceResults.length > count, before);
  return page.evaluate((index) => globalThis.fixturePriceResults[index], before);
}

try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--disable-background-networking',
      '--disable-sync',
    ],
  });
  context.setDefaultTimeout(15_000);
  context.on('page', (page) => page.on('pageerror', (error) => browserErrors.push(error.message)));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.origin === 'https://es.wallapop.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Offline account fixture</title></head><body>All account data in this page is synthetic.</body></html>' });
    }
    if (url.origin !== 'https://api.wallapop.com') {
      unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT, OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const account = accounts.get(request.headers().authorization?.replace(/^Bearer /u, ''));
    if (!account) {
      unexpectedRequests.push(`${request.method()} ${url.pathname}: missing fixture account`);
      return route.fulfill({ status: 401, headers: cors, body: 'Synthetic account required.' });
    }
    requests.push({ method: request.method(), path: url.pathname, account: account.id });
    const respond = (body) => route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (url.pathname === '/capture-fixture') return respond({ captured: true });
    if (url.pathname === '/api/v3/users/me') return respond({ id: account.id });
    if (url.pathname === `/api/v3/users/${account.id}/items`) return respond({ items: [account.item] });
    if (url.pathname === `/api/v3/items/${account.item.id}`) {
      if (request.method() === 'GET') return respond(account.item);
      if (request.method() === 'PUT') {
        if (pendingWrite) {
          const gate = pendingWrite;
          pendingWrite = undefined;
          gate.entered.resolve();
          await gate.released.promise;
        }
        const body = request.postDataJSON();
        assert.ok(Number.isFinite(body.attributes.price_amount) && body.attributes.price_amount > 0);
        account.item.price.cash.amount = body.attributes.price_amount;
        if (uncertainNextWrite) {
          uncertainNextWrite = false;
          return route.abort('failed');
        }
        return respond({ id: account.item.id });
      }
    }
    unexpectedRequests.push(`${request.method()} ${url.pathname}: unsupported fixture request`);
    return route.abort('blockedbyclient');
  });

  let worker = context.serviceWorkers().find((entry) => entry.url().endsWith('/background/service-worker.js'));
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const site = await context.newPage();
  await site.goto('https://es.wallapop.com/fixture');
  const capture = async (token, deviceId) => {
    await site.evaluate(async ({ token, deviceId }) => {
      const request = new Request('https://api.wallapop.com/capture-fixture', {
        headers: new Headers({ Authorization: `Bearer ${token}`, DeviceID: deviceId }),
      });
      await fetch(request);
    }, { token, deviceId });
  };

  await capture(tokenA, 'fixture-device-a');
  const popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.waitForFunction(() => document.querySelector('.product-title')?.textContent === 'Fixture listing A');
  await armMessages(popup);
  assert.equal((await popup.evaluate(() => chrome.runtime.getManifest())).version, manifest.version);
  const sessionA = await popup.evaluate(() => chrome.storage.session.get(['token', 'deviceId', 'userId']));
  assert.deepEqual(sessionA, { token: tokenA, deviceId: 'fixture-device-a', userId: 'fixture-user-a' });
  assert.ok(requests.some((request) => request.path === '/api/v3/users/me' && request.account === 'fixture-user-a'));
  checks.push('unpacked release loads its real worker, popup, MAIN interceptor and isolated content bridge');

  assert.equal((await bulk(popup, 10, true)).success, 1);
  assert.equal(accounts.get(tokenA).item.price.cash.amount, 110);
  assert.equal((await bulk(popup, 10, true)).success, 1);
  assert.equal(accounts.get(tokenA).item.price.cash.amount, 121);
  checks.push('real popup percentage actions use refreshed prices: 100 -> 110 -> 121');

  await popup.locator('.product-price-input').fill('200');
  await popup.locator('.product-price-btn').click();
  await popup.waitForFunction(() => !document.querySelector('.product-price-btn').disabled);
  assert.equal(accounts.get(tokenA).item.price.cash.amount, 200);
  assert.equal((await bulk(popup, 10)).success, 1);
  assert.equal(accounts.get(tokenA).item.price.cash.amount, 220);
  checks.push('individual price writes feed the next percentage operation: 200 -> 220');

  uncertainNextWrite = true;
  const uncertain = await message(popup, { type: 'UPDATE_ITEM_PRICE', itemId: 'fixture-item-a', newPrice: 250 });
  assert.ok(uncertain.error);
  assert.equal(accounts.get(tokenA).item.price.cash.amount, 250);
  assert.equal((await bulk(popup, 10)).success, 1);
  assert.equal(accounts.get(tokenA).item.price.cash.amount, 275);
  checks.push('a lost price-write response invalidates cached prices before the next operation');

  await capture(tokenB, 'fixture-device-b');
  await popup.waitForFunction(async () => (await chrome.storage.session.get('userId')).userId === 'fixture-user-b');
  const putsBeforeForeignId = requests.filter((request) => request.method === 'PUT').length;
  const foreign = await message(popup, { type: 'UPDATE_ITEM_PRICE', itemId: 'fixture-item-a', newPrice: 999 });
  assert.ok(foreign.error);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, putsBeforeForeignId);
  const currentItems = await message(popup, { type: 'LOAD_ITEMS' });
  assert.deepEqual(currentItems.items.map((item) => item.id), ['fixture-item-b']);
  assert.ok(requests.some((request) => request.path === '/api/v3/users/me' && request.account === 'fixture-user-b'));
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector('.product-title')?.textContent === 'Fixture listing B');
  await armMessages(popup);
  checks.push('capturing account B replaces account A and rejects A listing IDs before a write');

  const gate = { entered: deferred(), released: deferred() };
  pendingWrite = gate;
  const ongoingBulk = bulk(popup, 10);
  await withinDeadline(gate.entered.promise, 'the fixture to receive the pending write');
  const overlapping = await message(popup, { type: 'UPDATE_ITEM_PRICE', itemId: 'fixture-item-b', newPrice: 999 });
  assert.ok(overlapping.error);
  gate.released.resolve();
  assert.equal((await ongoingBulk).success, 1);
  assert.equal(accounts.get(tokenB).item.price.cash.amount, 220);
  checks.push('a pending bulk write holds the shared lock against an individual write');

  const profileCallsBefore = requests.filter((request) => request.path === '/api/v3/users/me' && request.account === 'fixture-user-b').length;
  await worker.evaluate(() => { globalThis.fixtureRestartSentinel = 'execution-context-before-stop'; });
  await popup.evaluate(() => chrome.storage.session.set({ userId: 'fixture-untrusted-saved-user-id' }));
  const cdp = await context.browser().newBrowserCDPSession();
  const targets = await cdp.send('Target.getTargets');
  const workerTarget = targets.targetInfos.find((target) => target.type === 'service_worker' && target.url === worker.url());
  assert.ok(workerTarget, 'The extension worker must have a real CDP target.');
  assert.equal((await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId })).success, true);
  const awakenedItems = await message(popup, { type: 'LOAD_ITEMS' });
  assert.deepEqual(awakenedItems.items.map((item) => item.id), ['fixture-item-b']);
  assert.ok(requests.filter((request) => request.path === '/api/v3/users/me' && request.account === 'fixture-user-b').length > profileCallsBefore);
  assert.equal((await popup.evaluate(() => chrome.storage.session.get('userId'))).userId, 'fixture-user-b');
  const awakenedTargets = await cdp.send('Target.getTargets');
  const awakenedWorker = awakenedTargets.targetInfos.find((target) => target.type === 'service_worker' && target.url === worker.url());
  assert.ok(awakenedWorker, 'The extension worker must be running again after its wake-up message.');
  // Chromium can retain a target ID across a worker restart. Execution-context
  // state and a fresh /me request establish the lifecycle behavior instead.
  assert.equal(await worker.evaluate(() => globalThis.fixtureRestartSentinel), undefined);
  await cdp.detach();
  checks.push('a stopped MV3 worker wakes and re-verifies /me rather than trusting its saved user ID');

  assert.deepEqual(unexpectedRequests, []);
  console.log(JSON.stringify({
    browser: context.browser().version(),
    manifestVersion: manifest.version,
    extensionPath,
    isolation: 'disposable persistent profile; all HTTP fulfilled or blocked; DNS resolution disabled',
    liveWallapopRequests: 0,
    checks,
    fixtureApiRequests: requests.length,
    scope: 'Synthetic API integration in real Chromium; no claim about live Wallapop endpoint compatibility.',
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedChecks: checks, fixtureRequests: requests, blockedRequests: unexpectedRequests, browserErrors }, null, 2));
  throw error;
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
