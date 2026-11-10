# Development and release packaging

[Back to the project overview](../README.md). Commands run from the repository root unless stated otherwise.

## Development

Use **Node.js 22.12+ on the 22.x line, or Node.js 24+**, for development, and a Chrome installation with the required Manifest V3 APIs. The lockfile currently resolves Vite `8.3.5`, which requires `^20.19.0 || >=22.12.0`; Node.js 18 does not satisfy that dependency.

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

The Vitest suite includes tests that execute the real service-worker source in a Node VM with stubbed Chrome and network APIs, plus tests of the API client's session guards and the existing unit tests. These check session changes, stale responses, price-cache invalidation, operation coordination and selected-operation validation. Some older unit tests reproduce helper logic inline; those are examples of expected calculations, not evidence that the production implementation behaves identically. The suite does not establish complete coverage or compatibility with current live Wallapop endpoints. The separate Chromium check below exercises browser integration against fixtures; real-account behavior still requires manual verification.

### Isolated Chromium integration check

`scripts/check-browser.mjs` loads the actual extension in a disposable Chromium profile. It exercises the popup, empty-selection protection, visible operation errors, installed version, token interceptor and content bridge, account changes, price updates, shared operation lock, service-worker stop/wake, and downloaded CSV bytes. All HTTP requests are fulfilled with synthetic fixtures or blocked; DNS resolution is disabled. This checks real browser integration against controlled API responses, not compatibility with live Wallapop endpoints or spreadsheet applications.

Supply Playwright from a separate tooling installation through `PLAYWRIGHT_MODULE_PATH`. Install its supported Chromium browser there; `CHROMIUM_EXECUTABLE` can select an existing Chromium executable. [Playwright's extension documentation](https://playwright.dev/docs/chrome-extensions) explains why its Chromium distribution is required instead of branded Chrome or Edge. Extract the release ZIP to a temporary directory, then run:

```sh
PLAYWRIGHT_MODULE_PATH=/path/to/browser-tools/node_modules/playwright \
  node scripts/check-browser.mjs --extension /path/to/extracted-release
```

In PowerShell, set `$env:PLAYWRIGHT_MODULE_PATH` before running `node`. Playwright is optional external tooling, not a dependency of the extension or the default unit-test command. The profile is created under `.tmp` and removed when the check finishes.

### Manual release packaging

Use Python 3.11 or newer; the packaging script needs only the standard library:

```sh
python -m unittest discover -s tests -p test_release_package.py
python scripts/package-release.py
python scripts/package-release.py --verify dist/wallapop-tools-v5.0.3.zip
```

The output defaults to `dist/wallapop-tools-v<manifest-version>.zip`; use `--output /path/to/release.zip` to choose another location. The script includes only its explicit list of runtime files and the license. It excludes development dependencies, tests, Git, logs and environment files, fixes ZIP timestamps and permissions, and sorts entries. Repeated builds from the same file bytes and Python/zlib toolchain produce identical archives. Verification checks the exact file list, CRCs, manifest and byte-for-byte agreement with the checkout, then prints the archive SHA-256. Packaging does not publish a GitHub release.

### CSV format

The export is intended for spreadsheet inspection. Every column escapes commas, double quotes and CR/LF; embedded double quotes are doubled. Numeric prices and day counts, and boolean shipping values, keep their existing serialization.

Formula-like text beginning with `=`, `+`, `-` or `@` (including full-width forms and preceding whitespace/control characters), and text starting with a control character, receive exactly one leading tab inside a quoted CSV field. This follows [OWASP's Excel-oriented mitigation](https://community.owasp.org/attacks/CSV_Injection). The original text follows that tab unchanged. The tab is part of the exported data, so programmatic consumers must account for it; this CSV is not an exact text backup. Other spreadsheet programs, import settings and save/reopen workflows can interpret values differently. No universal formula-safety guarantee is implied.
