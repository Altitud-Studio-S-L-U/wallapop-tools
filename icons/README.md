# Wallapop Tools Icons

## Current State

The `icon16.png`, `icon48.png`, and `icon128.png` files in this directory are **1x1 placeholder PNGs**. They allow the extension to load without errors but will appear as a tiny green dot.

## Generating the Real Icons

To generate proper icons with the "WT" logo on a green rounded rectangle:

1. Open `../scripts/generate-icons.html` in any modern browser.
2. Click **Download All Icons** (or download them individually).
3. Move the downloaded `icon16.png`, `icon48.png`, and `icon128.png` into this `icons/` directory, replacing the placeholders.
4. Reload the extension at `chrome://extensions`.

## Design

- Background: Rounded rectangle, color `#13b987` (Wallapop green)
- Text: "WT" in bold white
- Sizes: 16x16, 48x48, 128x128
