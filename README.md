# Wallapop Tools

**Manage listing actions from your existing Wallapop browser session.**

A Manifest V3 browser extension by [Altitud Studio](https://altitudstudio.ad) for bulk reactivation requests, individual and batch price changes, scheduled actions and CSV export. The extension runs in the browser and calls Wallapop's web API directly, without a project-operated backend or analytics service.

## At a glance

Select listings → adjust prices or request reactivation → review per-item results.

- **For sellers:** batch actions, individual prices, scheduled reactivation and CSV export.
- **Runs locally:** an unpacked Manifest V3 extension, with no project-operated backend or analytics service.
- **Before you use it:** actions modify your real account. Completed writes are not rolled back when another item fails.

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

Percentage adjustments target exactly the selected listing IDs. An empty selection is rejected; it never means all listings. Duplicate IDs are processed once. The separate **reactivate all** action and scheduled reactivation still operate on all loaded listings.

Operations apply requests **one item at a time**. Review the reported success and failure counts: completed writes are not rolled back if a later item fails. Exported CSV data represents the loaded listings; it is not a full account backup. Formula-like text receives a leading tab for spreadsheet inspection; see the [CSV format and compatibility limits](docs/development.md#csv-format).

If authentication expires, browse Wallapop again to capture a fresh token. After reloading the extension or restarting the browser, reconnect the session before relying on scheduled actions.

## Data and permissions

The extension observes authentication headers in your signed-in Wallapop tab and relays the session to its worker for API calls. Credentials use `chrome.storage.session`; preferences, counters and local history use `chrome.storage.local`. There is no project-operated backend or analytics endpoint.

Permissions cover storage, alarms, notifications, request-header rules and the configured Wallapop hosts. Activity and preferences are shared across accounts using the same extension installation. See the [data flow and account-session controls](docs/architecture.md#data-and-permissions) and [privacy disclosure](PRIVACY.md) before connecting a session.

## Architecture

A page interceptor captures the session, a content bridge relays it, and the background worker coordinates API calls, scheduling and popup progress. Loaded inventory and operation locks live in worker memory; they are not a durable queue. See the [architecture and source map](docs/architecture.md#architecture).

## Development

The extension runs directly from source; Node.js is needed only for development. See the [development guide](docs/development.md) for the supported Node versions, unit tests, isolated Chromium checks and reproducible ZIP packaging. The browser checks use synthetic responses; live Wallapop compatibility requires separate verification.

## Operational limits

- The web API and its request formats can change without notice. Successful local tests do not guarantee that a live operation will be accepted.
- Listing discovery stops after at most 50 pages. Pagination limits or endpoint changes can leave the loaded list incomplete.
- Bulk actions space requests with delays; throttling and other provider errors can still occur.
- Multi-item operations have no transaction or durable resume mechanism. Operation locks, progress and cached listings live in worker memory.
- Scheduling depends on browser alarms and a valid session. The extension is not an always-running background service.

## Contributing

Open an [issue](https://github.com/Altitud-Studio-S-L-U/wallapop-tools/issues) to discuss a change, then submit a pull request against `main`. Include the behavior changed, relevant test results and any manual browser verification. Use synthetic fixtures rather than real account tokens or listing data in tests and reports.

For suspected vulnerabilities, follow the [security reporting policy](SECURITY.md) instead of posting sensitive details publicly.

## Disclaimer and license

This project is not affiliated with, associated with, authorized by, or endorsed by Wallapop. All product names, logos, and brands are property of their respective owners.

[MIT](LICENSE), copyright 2026 Altitud Studio SLU.

Built by [Altitud Studio SLU](https://altitudstudio.ad), Andorra. [Website](https://altitudstudio.ad/en/) · [Privacy disclosure](PRIVACY.md) · [Contact](mailto:info@altitudstudio.ad).
