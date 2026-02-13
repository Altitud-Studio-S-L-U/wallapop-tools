# Wallapop Tools

> Free browser extension for Wallapop sellers — bulk republish, batch pricing, auto-scheduling and CSV export.

**Zero backend. Zero tracking. Everything runs locally in your browser.**

<p align="center">
  <img src="icons/icon128.png" alt="Wallapop Tools" width="128" />
</p>

## Features

| Feature | Description |
|---|---|
| **One-click republish** | Bump all your listings to the top of the feed instantly |
| **Batch price adjustment** | Raise or lower prices across all products by a percentage |
| **Selective actions** | Pick specific items to republish or reprice |
| **Auto-republish** | Schedule automatic republishing every 6, 12, 24 or 48 hours |
| **CSV export** | Download your full product list for analysis or backup |
| **Activity log** | Local history of every action performed |
| **Multilingual** | Spanish, English, French, Italian and Portuguese |

## Privacy

This extension takes privacy seriously:

- **No servers** — communicates exclusively with Wallapop's official API (`api.wallapop.com`)
- **No analytics** — zero telemetry, crash reporting or tracking of any kind
- **No data sharing** — your data never leaves your browser
- **Session-only tokens** — authentication tokens are cleared when you close the browser
- **Open source** — audit the code yourself

Full privacy policy: [altitudstudio.ad/en/wallapop-tools/privacy](https://altitudstudio.ad/en/wallapop-tools/privacy)

## Installation

### 1. Download

Download the [latest release](https://github.com/Altitud-Studio-S-L-U/wallapop-tools/releases/latest) (ZIP file).

### 2. Extract

Unzip the file into a folder on your computer.

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the extracted folder

### 4. Connect

1. Navigate to [wallapop.com](https://es.wallapop.com)
2. Browse the site while signed in — the extension captures your session token automatically
3. Click the extension icon to open the popup and manage your listings

## How It Works

```
wallapop.com (your active session)
       │
       ▼
┌─────────────────────────────────────────────┐
│  Content Scripts                            │
│  interceptor.js → captures auth token       │
│  bridge.js → relays token to background     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Service Worker (background)                │
│  Orchestrates all operations, scheduling,   │
│  badge updates and alarm management         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  wallapop-api.js                            │
│  HMAC-SHA256 signed API calls               │
│  GET items, PUT reactivate, PUT price, etc. │
└──────────────────┬──────────────────────────┘
                   │  Bearer token (your session)
                   ▼
            api.wallapop.com
```

The extension intercepts the same authentication headers that the Wallapop web app uses, then replicates the exact same API calls. No credentials are stored beyond the browser session.

## Project Structure

```
wallapop-tools/
├── manifest.json              # Extension config (Manifest V3)
├── background/
│   └── service-worker.js      # Scheduling, alarms, message handling
├── content/
│   ├── interceptor.js         # Token capture (runs in MAIN world)
│   └── bridge.js              # Relays tokens to service worker
├── popup/
│   ├── popup.html             # Extension popup interface
│   ├── popup.css              # Popup styles (light/dark mode)
│   └── popup.js               # UI logic, i18n, user interactions
├── utils/
│   ├── wallapop-api.js        # API client with HMAC-SHA256 signing
│   └── i18n-runtime.js        # Lightweight i18n for content scripts
├── _locales/
│   ├── es/messages.json       # Spanish (default)
│   ├── en/messages.json       # English
│   ├── fr/messages.json       # French
│   ├── it/messages.json       # Italian
│   └── pt_PT/messages.json    # Portuguese
├── icons/                     # Extension icons (16, 48, 128)
├── tests/                     # Vitest test suite
└── scripts/
    └── generate-icons.js      # Icon generation utility
```

## Development

### Prerequisites

- Node.js 18+ (only needed for tests and icon generation)
- Chrome or any Chromium-based browser

### Setup

```bash
git clone https://github.com/Altitud-Studio-S-L-U/wallapop-tools.git
cd wallapop-tools
npm install
```

### Run tests

```bash
npm test
```

### Modify and reload

1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the reload icon on the extension card
4. Refresh the Wallapop tab

### Technical notes

- **Rate limiting**: Bulk operations include random delays (2–5 s) between requests to avoid throttling
- **Token expiry**: If the token expires, the extension prompts you to browse Wallapop to capture a fresh one
- **API stability**: Wallapop does not provide a public API — endpoints may change without notice

## Supported Markets

The extension works with all Wallapop country domains:

- `es.wallapop.com` (Spain)
- `it.wallapop.com` (Italy)
- `fr.wallapop.com` (France)
- `pt.wallapop.com` (Portugal)

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## Disclaimer

This project is not affiliated with, associated with, authorized by, or endorsed by Wallapop. All product names, logos, and brands are property of their respective owners.

## License

MIT

---

Built by [Altitud Studio SLU](https://altitudstudio.ad) — Andorra

[Website](https://altitudstudio.ad/en/wallapop-tools) · [Privacy Policy](https://altitudstudio.ad/en/wallapop-tools/privacy) · [Contact](mailto:info@altitudstudio.ad)
