# Quick install — Codex Chrome Extension v2.1.1.1 (patched)

This release includes two patches over the upstream v1.1.5 source in this repo:

1. **`key` field in `manifest.json`** — extension registers as the canonical ID `hehggadaopoacecdllhhajmbjkdcmajg`. This is what the `com.openai.codexextension` native host (bundled with the ChatGPT desktop app) trusts. Without this, Chrome gives the unpacked extension a path-derived ID like `edlflcfhnonnngjgcmblgeehjdiimimf` and the host refuses the connection.
2. **CSP `font-src` now allows `data:` URIs** — fixes the "Loading the font … violates the following Content Security Policy directive" error in the side panel (it tries to load an inline base64 woff2).

---

## Which artifact should I download?

| Artifact | When to use it | ID you'll get |
|---|---|---|
| `codex-chrome-extension-2.1.1.1.zip` | **Recommended.** Load unpacked via `chrome://extensions`. | `hehggadaopoacecdllhhajmbjkdcmajg` (canonical — native host accepts out of the box) |
| `codex-chrome-extension-2.1.1.1.crx` | Drag-and-drop install. | Random ID per build (e.g. `afbfhjhlemoflmkkjmhobocmopjkioid`). You'll need to add this ID to the native host's `allowed_origins` (see below). |

**Why the difference?** A CRX's ID is derived from the **private key used to sign it**. The public key (in the manifest's `key` field) is for unpacked installs. We have the public key, not the developer's private key — so the CRX we build has a random ID, but the ZIP preserves the canonical ID via the manifest.

**If you need a CRX with the official ID**, you'll need the developer's private key (we don't have it; OpenAI does). Alternatively, the build script and the `key` field in the manifest make it trivial to sign your own CRX with a different key + update native host config.

---

## Install flow A — ZIP (recommended, official ID, no extra config)

1. Download `codex-chrome-extension-2.1.1.1.zip` from the [release page](https://github.com/megamen32/Codex-Chrome-Extension/releases/tag/v2.1.1.1).
2. Extract the ZIP to a folder you'll keep around (e.g. `~/Codex-extension/extension`).
3. Open `chrome://extensions/` in Chrome.
4. Toggle **Developer mode** on (top-right corner).
5. Click **Load unpacked** → select the extracted `extension/` folder.
6. On the new extension card, confirm the ID is `hehggadaopoacecdllhhajmbjkdcmajg`. (If it's a long random string, the `key` field didn't survive extraction — re-download.)
7. Install / launch the **ChatGPT desktop app** (`/Applications/ChatGPT.app` on macOS).
8. Open the side panel: `Cmd+Shift+Period` on macOS, or the toolbar icon. Native transport should connect.

**Native host config is already correct** because the extension's ID is in the default `allowed_origins` of `com.openai.codexextension`. No edits needed.

---

## Install flow B — CRX (drag-and-drop, requires native host edit)

1. Download `codex-chrome-extension-2.1.1.1.crx` from the release.
2. Open `chrome://extensions/` → toggle Developer mode on.
3. **Drag the .crx file onto the page** (or rename to `.zip` and use "Load unpacked" — same result).
4. Chrome will install it with a new random ID. **Copy the ID** shown on the card (it'll look like `afbfhjhlemoflmkkjmhobocmopjkioid`).
5. Edit the native host manifest to add the new ID to `allowed_origins`:

   **macOS:** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json`
   **Linux:** `~/.config/google-chrome/NativeMessagingHosts/com.openai.codexextension.json`
   **Windows:** `%APPDATA%\Google\Chrome\User Data\Default\NativeMessagingHosts\com.openai.codexextension.json` (or `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.openai.codexextension` registry key — file-based is easier)

   The file looks like this:
   ```json
   {
     "allowed_origins": [
       "chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/"
     ],
     "description": "ChatGPT Chrome native messaging host",
     "name": "com.openai.codexextension",
     "path": "/Users/user/.codex/plugins/cache/openai-bundled/chrome/latest/extension-host/macos/arm64/ChatGPT for Chrome",
     "type": "stdio"
   }
   ```

   Add your CRX's ID as a new entry, e.g.:
   ```json
   "allowed_origins": [
     "chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/",
     "chrome-extension://afbfhjhlemoflmkkjmhobocmopjkioid/"
   ]
   ```

   **CLI shortcut (macOS):**
   ```bash
   NEW_ID="afbfhjhlemoflmkkjmhobocmopjkioid"  # from chrome://extensions
   F="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json"
   python3 -c "
   import json
   p = '$F'
   d = json.load(open(p))
   origin = 'chrome-extension://$NEW_ID/'
   if origin not in d['allowed_origins']:
       d['allowed_origins'].append(origin)
       with open(p,'w') as f:
           json.dump(d, f, indent=2)
       print(f'Added {origin}')
   else:
       print(f'{origin} already present')
   "
   ```
6. **Quit and reopen the ChatGPT desktop app** (it caches the native host config at startup).
7. Open the side panel.

---

## Uninstall old copies first

If you already have the Codex/ChatGPT extension loaded unpacked from any of these locations:
- `~/Downloads/hehggadaopoacecdllhhajmbjkdcmajg/`
- `~/Downloads/hehggadaopoacecdllhhajmbjkdcmajg (1)/`
- `~/Downloads/hehggadaopoacecdllhhajmbjkdcmajg (2)/`
- `~/Documents/chrome-plugins/codexnew/`

**Remove them from `chrome://extensions` first**. Chrome refuses to load two extensions with the same ID, and the new ZIP will also register as `hehggadaopoacecdllhhajmbjkdcmajg` (via the manifest's `key` field).

---

## Troubleshooting

### "Native transport disconnected"
The native host rejected the connection. Either:
- Your extension ID is not in `allowed_origins` of `com.openai.codexextension.json`
- The desktop app isn't running (open ChatGPT.app)
- The desktop app is running an old version (restart it to re-read the manifest)

### "Loading the font … violates CSP"
You installed the upstream v1.1.5 build, not v2.1.1.1. Re-download from the release.

### "Manifest file is missing or unreadable"
You pointed Chrome at the ZIP file instead of the extracted `extension/` folder. Unzip first.

### Extension ID is a long random string, not `hehggadaopoacecdllhhajmbjkdcmajg`
- For ZIP install: `key` field didn't survive extraction. Re-download.
- For CRX install: this is expected — the CRX has a random ID. See flow B step 5.

### Where is `com.openai.codexextension.json`?
The native host manifest is installed by the ChatGPT desktop app at first launch. If it's missing, run ChatGPT.app once to create it. The path depends on your OS:
- **macOS:** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json`
- **Linux:** `~/.config/google-chrome/NativeMessagingHosts/com.openai.codexextension.json`
- **Windows:** registry-based; see Chromium docs on native messaging

### Multiple extension IDs in `allowed_origins`?
That's fine. The host accepts any extension whose ID is in the list. You can leave both `hehgg…` and the CRX's random ID there.

---

## Why the patches exist

`com.openai.codexextension` (the native host bundled with ChatGPT.app) only talks to extensions whose ID is in its `allowed_origins`. By default that's just `hehggadaopoacecdllhhajmbjkdcmajg` (the official Codex extension on the Chrome Web Store). When you load the unpacked extension WITHOUT a `key` field, Chrome derives an ID from the absolute path of the folder, which is something like `edlflcfhnonnngjgcmblgeehjdiimimf` — and the host refuses the connection with "Native transport disconnected."

Setting `"key"` in `manifest.json` tells Chrome "use THIS public key to derive the ID instead" — which produces the canonical `hehgg…` ID. The patch is one line, but it's the difference between "extension works" and "extension loads but does nothing."

The CSP `font-src` patch is a separate issue: the side panel uses an inline base64 woff2 font that the default `font-src 'self' https://cdn.openai.com` policy blocks. Adding `data:` whitelists it.

See [README.en.md](README.en.md) for the full architecture / protocol details.
