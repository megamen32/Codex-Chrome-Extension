# Quick install — Codex Chrome Extension v1.1.6 (patched)

This release includes two patches over the upstream v1.1.5:
1. `extension.key` field — extension registers as the canonical ID `hehggadaopoacecdllhhajmbjkdcmajg` so the `com.openai.codexextension` native host (bundled with the ChatGPT desktop app) accepts the connection.
2. CSP `font-src` now allows `data:` URIs — fixes the "Loading the font … violates the following Content Security Policy directive" error in the side panel.

## Install (recommended — official ID)

1. Download **`codex-chrome-extension-1.1.6.zip`** from the [latest release](https://github.com/megamen32/Codex-Chrome-Extension/releases/tag/v1.1.6).
2. Extract the ZIP.
3. Open `chrome://extensions/` → toggle **Developer mode** on (top-right).
4. Click **Load unpacked** → select the extracted `extension/` folder.
5. Confirm the new card shows the ID `hehggadaopoacecdllhhajmbjkdcmajg`. (If it shows a different ID, the `key` field is missing — re-download the ZIP.)
6. Install / launch the **ChatGPT desktop app** (`/Applications/ChatGPT.app`).
7. Open the side panel (Cmd+Shift+Period on macOS, or the toolbar icon). Native transport should connect.

## Install (alternative — .crx)

1. Download **`codex-chrome-extension-1.1.6.crx`** from the release.
2. Open `chrome://extensions/` → drag the .crx into the page, or use "Load unpacked" trick after renaming to .zip.
3. The CRX was signed with a generated key, so it will install with a **different ID** (e.g. `gjionjhdoaijbgogpogbcamgbjngadmb`).
4. Add that ID to the native host allowed list:
   ```bash
   $EDITOR "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json"
   ```
   In `allowed_origins`, add:
   ```json
   "chrome-extension://gjionjhdoaijbgogpogbcamgbjngadmb/"
   ```
5. Restart the ChatGPT desktop app.

## Uninstall the old sideloaded copy

If you already have an unpacked Codex/ChatGPT extension from the unpacked `hehggadaopoacecdllhhajmbjkdcmajg (2)/` folder (or its siblings), **remove it from `chrome://extensions` first** — Chrome will refuse to load two extensions with the same ID.

## Troubleshooting

- **"Native transport disconnected"** — native host rejected the connection. Either your extension ID is not in `allowed_origins`, or the desktop app isn't running. Re-open the desktop app; if that doesn't help, check `allowed_origins` includes your exact ID (the one shown on `chrome://extensions`).
- **"Loading the font … violates CSP"** — you installed the v1.1.5 build, not v1.1.6. Re-download the v1.1.6 release.
- **"Manifest file is missing or unreadable"** — you pointed Chrome at the ZIP file instead of the extracted `extension/` folder. Unzip first.
- **Extension ID is a long random string, not `hehgg…`** — `key` field didn't survive extraction. Re-download; or open `extension/manifest.json` and verify a `"key":"MIIBIjAN…"` line is present near the top.

## Why the patches exist

`com.openai.codexextension` (the native host installed by the ChatGPT desktop app) only talks to the extension with ID `hehggadaopoacecdllhhajmbjkdcmajg`. When you load the unpacked extension, Chrome normally derives a path-based ID that doesn't match — so the host refuses the connection. Setting `key` in `manifest.json` makes Chrome assign the canonical ID. See [README.en.md](README.en.md) for the full architecture.
