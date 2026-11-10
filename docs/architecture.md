# Data flow and architecture

[Back to the project overview](../README.md).

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

Capturing new credentials clears the previous user ID and listing cache, together with the displayed listing count and last-reactivation result. Before using a newly captured session for account operations, the worker verifies the current account through the `/me` profile request. It also re-verifies after waking instead of trusting a saved user ID. Responses from an earlier session are checked before they can update the current session's state.

Individual and bulk writes share an operation lock, and selected listing IDs are checked against the current account's loaded inventory. Every price-write attempt invalidates the listing cache, including failures with an uncertain server outcome; subsequent operations reload server data before using it. Session changes are checked before further requests, but requests already sent can still complete and are not cancelled or rolled back.

Activity history, statistics, language and scheduling preferences remain shared across the extension installation. They are not isolated into separate per-account profiles.

The manifest requests:

- `storage` for session and local state;
- `alarms` for scheduled reactivation;
- `notifications` for scheduled-operation results;
- `declarativeNetRequest` to set Origin and Referer headers on API requests;
- access to the API and country hosts listed in the [installation instructions](../README.md#configured-hosts).

Read the [privacy disclosure](../PRIVACY.md) for the extension's data handling and removal controls.


## Architecture

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
