# Privacy and data handling

This disclosure describes Wallapop Tools 5.0.1, an independent browser extension by Altitud Studio SLU. It is not affiliated with or endorsed by Wallapop. It describes the extension's implementation, not Wallapop's or the browser vendor's data practices.

## Data used by the extension

| Data | Location and purpose |
| --- | --- |
| Captured authentication token, device ID, user ID and country host | `chrome.storage.session`; used to identify the current account and make authenticated API requests. |
| Language and scheduling preferences, operation counts, results and activity history | `chrome.storage.local`; used for settings and local activity displays. The activity history retains up to 50 entries and can include listing IDs and price changes. |
| Listing IDs, first-seen or listing timestamps and last observed prices | `chrome.storage.local`; used for listing-age and price indicators. |
| Loaded listing responses, cached listings and operation progress | Service-worker memory; used while loading and operating on listings. Responses can include titles, descriptions, prices, categories, delivery and location fields, and image identifiers or URLs. |
| CSV exports | Files downloaded when the user chooses export; the user controls those files after download. |

History, statistics, language and scheduling preferences are shared across the extension installation, rather than isolated per account. New credentials clear the previous account ID, loaded listings, displayed listing count and last-reactivation result; they do not clear the shared history or preferences.

## Network requests

The content scripts observe authentication headers on requests to `api.wallapop.com` and pass the captured credentials to the extension's worker. The worker sends authenticated requests directly to Wallapop. Price updates send listing fields, including price, title, description, condition, category, delivery, location and image identifiers. Listing responses may contain image URLs.

The current extension source includes no analytics integration or project-operated data-collection backend. This does not mean that data stays on the device: Wallapop receives the API requests and their contents. See the [service worker](background/service-worker.js) and [API client](utils/wallapop-api.js) for the implementation.

## Controls and removal

- Turn scheduled actions off in the popup when you no longer want them to run.
- Disable or remove the extension through `chrome://extensions/`; see [Chrome's extension-management instructions](https://support.google.com/chrome_webstore/answer/2664769).
- To inspect or clear stored extension data without uninstalling, use Chrome DevTools' **Application > Storage > Extension Storage** panel and select the relevant storage area. See [Chrome's storage tools](https://developer.chrome.com/docs/devtools/storage/extensionstorage).

Chrome clears session storage when the extension is disabled, reloaded or updated, and when the browser restarts. Local extension storage persists across browser sessions and is cleared when the extension is removed; clearing browsing history alone does not clear it. These are [Chrome storage behaviors](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas).

Removing storage or the extension does not delete CSV files already downloaded or undo requests already sent to Wallapop. A request in flight may still complete.

## Contact

Altitud Studio SLU, Andorra — [info@altitudstudio.ad](mailto:info@altitudstudio.ad). Do not send authentication tokens or private listing data in a public issue.
