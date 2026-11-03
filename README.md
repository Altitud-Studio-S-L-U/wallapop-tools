# Wallapop Tools

**Manage listing actions from your existing Wallapop browser session.**

A Manifest V3 browser extension by [Altitud Studio](https://altitudstudio.ad) for bulk reactivation requests, individual and batch price changes, scheduled actions and CSV export. The extension runs in the browser and calls Wallapop's web API directly, without a project-operated backend or analytics service.

```text
  Signed-in Wallapop tab
           |
  fetch / XHR token capture
           |
       content bridge
           |
  +-----------------------------+
  | Background service worker   |
  | API calls, alarms, progress |
  | session and local storage   |
  +-----------------------------+
           |              ^
           v              |
    api.wallapop.com    Extension popup
```

This project is independent of Wallapop. It uses endpoints used by the web application, rather than a supported public integration API. Listing changes affect your real account and depend on Wallapop accepting each request.

## Features

| Feature | Behavior |
| --- | --- |
| Bulk or selected reactivation | Send reactivation requests for loaded listings or a selection. Feed placement and eligibility remain controlled by Wallapop. |
| Batch price adjustment | Raise or lower prices for all loaded listings or selected items by 1-50%. |
| Individual prices | Apply a new price to one listing from the popup. |
| Scheduled reactivation | Configure browser alarms for 6, 12, 24 or 48 hours. A valid captured session is required when an action runs. |
| CSV export | Download loaded listing data: title, price, category, condition, days listed, shipping status and URL. |
| Local activity | View operation history, counts and listing-age indicators. The activity log retains up to 50 entries. |
| Languages | Spanish, English, French, Italian and Portuguese. |

## Install

### From a release

1. Download the extension ZIP from the [latest release](https://github.com/Altitud-Studio-S-L-U/wallapop-tools/releases/latest).
2. Extract it to a permanent folder on your computer.
3. Open `chrome://extensions/` in Chrome and enable **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. Open a configured Wallapop host, sign in, and browse a page that makes an authenticated API request.
6. Open the extension popup. The status indicates whether it has captured a session.

The source can also be loaded directly from a checkout. There is no extension build step, and Node.js is not required to run the unpacked extension.

### Configured hosts

The manifest injects content scripts on:

- `https://es.wallapop.com/*`
- `https://it.wallapop.com/*`
- `https://fr.wallapop.com/*`
- `https://pt.wallapop.com/*`

API requests target `https://api.wallapop.com/*`. These are configured permissions, rather than a guarantee of current service availability or endpoint compatibility in every market.

## Use

Open the popup after connecting a session, review the loaded listings, and choose the items to operate on. Use the percentage controls for batch adjustments or the inline field for a single price. Scheduled reactivation is enabled separately with its interval selector.

Operations apply requests **one item at a time**. Review the reported success and failure counts: completed writes are not rolled back if a later item fails. Exported CSV data represents the loaded listings; it is not a full account backup.

If authentication expires, browse Wallapop again to capture a fresh token. After reloading the extension or restarting the browser, reconnect the session before relying on scheduled actions.

## Data and permissions

The interceptor observes authentication headers in requests made by the signed-in Wallapop page. A content bridge relays the token to the extension's service worker, which uses it for API calls. The API client constructs HMAC-SHA256 signatures for authenticated requests.

| Data | Storage and use |
| --- | --- |
| Authentication token, device ID, user ID and host | `chrome.storage.session`; used to make requests under the captured account session. |
| Language, scheduling preferences, counters and activity | `chrome.storage.local`; retained between browser sessions. |
| Listing-age and last-price tracking | `chrome.storage.local`; used for local listing indicators. |
| Loaded listing cache and operation state | Service-worker memory; not a durable work queue. |
| CSV export | A file downloaded by the user. |

Authenticated requests send the token and relevant listing data to Wallapop. The source includes no analytics or project-operated collection endpoint. Chrome clears session storage when the extension is reloaded, updated or disabled, and when the browser restarts; see the [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas).

The manifest requests:

- `storage` for session and local state;
- `alarms` for scheduled reactivation;
- `notifications` for scheduled-operation results;
- `declarativeNetRequest` to set Origin and Referer headers on API requests;
- access to the API and country hosts listed above.

Read the [privacy policy](https://altitudstudio.ad/en/wallapop-tools/privacy) for the project's published policy.

## Architecture

```text
  wallapop-tools/
  |-- manifest.json                 Manifest V3 permissions and entry points
  |-- background/service-worker.js  Operations, scheduling and local history
  |-- content/interceptor.js        Page-context fetch/XHR interception
  |-- content/bridge.js             Page-to-extension token relay
  |-- popup/                       Popup interface and interaction logic
  |-- utils/wallapop-api.js          HTTP client, signing and CSV conversion
  |-- utils/i18n-runtime.js          Translation loading and application
  |-- _locales/                     Five translation catalogs
  |-- tests/                        Vitest tests and browser/network mocks
  `-- scripts/                      Icon-generation utilities
```

The popup sends operation messages to the worker. The worker coordinates API calls and reports progress. Token state is separate from persistent settings and history; API helpers receive authentication parameters from the worker.

## Development

Use **Node.js 22.12.0 or newer** for the checked-in development dependency tree, and a Chrome installation with the required Manifest V3 APIs. The lockfile's Vite version requires `^20.19.0 || >=22.12.0`; Node.js 18 does not satisfy that dependency.

```sh
git clone https://github.com/Altitud-Studio-S-L-U/wallapop-tools.git
cd wallapop-tools
npm ci
npm test
```

For watch mode:

```sh
npm run test:watch
```

After modifying source, reload the extension in `chrome://extensions/` and refresh the Wallapop tab. `npm run generate-icons` regenerates the checked-in icons using the development-only `canvas` dependency.

The Vitest suite uses mocked browser and network APIs. It does not establish end-to-end behavior across Chrome's service-worker lifecycle or current live Wallapop endpoints. Verify those integration paths separately before relying on real listing operations.

## Operational limits

- The web API and its request formats can change without notice. Successful local tests do not guarantee that a live operation will be accepted.
- Listing discovery stops after at most 50 pages. Pagination limits or endpoint changes can leave the loaded list incomplete.
- Bulk actions space requests with delays; throttling and other provider errors can still occur.
- Multi-item operations have no transaction or durable resume mechanism. Operation locks, progress and cached listings live in worker memory.
- Scheduling depends on browser alarms and a valid session. The extension is not an always-running background service.

## Contributing

Open an [issue](https://github.com/Altitud-Studio-S-L-U/wallapop-tools/issues) to discuss a change, then submit a pull request against `main`. Include the behavior changed, relevant test results and any manual browser verification. Use synthetic fixtures rather than real account tokens or listing data in tests and reports.

## Disclaimer and license

This project is not affiliated with, associated with, authorized by, or endorsed by Wallapop. All product names, logos, and brands are property of their respective owners.

[MIT](LICENSE), copyright 2026 Altitud Studio SLU.

Built by [Altitud Studio SLU](https://altitudstudio.ad), Andorra. [Website](https://altitudstudio.ad/en/wallapop-tools) · [Privacy policy](https://altitudstudio.ad/en/wallapop-tools/privacy) · [Contact](mailto:info@altitudstudio.ad).
