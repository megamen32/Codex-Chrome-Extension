# 🔍 Codex Chrome Extension — Reverse Engineering

> **OpenAI Codex Browser Agent v1.1.5** — Complete reverse engineering of the Chrome extension that allows AI agents to control your browser.

**📖 [Русская версия](README.md)** | **📦 [Download ZIP from Releases](https://github.com/megamen32/Codex-Chrome-Extension/releases)**

## What Is This

A Chrome extension by OpenAI that enables AI agents (Codex / ChatGPT with Computer Use) to control your browser: click, type, scroll, navigate, take screenshots, and execute JavaScript. The extension is **not available in Europe**, but can be installed manually by loading it as an unpacked extension.

## Architecture

```
┌─────────────────────────┐
│  OpenAI API             │ ← LLM, screenshots, decision-making
│  (Codex / ChatGPT)      │
└───────────┬─────────────┘
            │ JSON-RPC 2.0
            ▼
┌─────────────────────────┐
│  Native Host App        │ ← com.openai.codexextension
│  (Desktop application)  │   chrome.runtime.connectNative()
│                         │
│  The "brain":           │
│  — Navigation           │    — Processes 70+ commands
│  — DOM analysis          │    — Takes screenshots
│  — Click / type / scroll│    — Manages viewport
│  — CDP command execution │    — Sends CDP commands
└───────────┬─────────────┘
            │ Native Messaging
            ▼
┌───────────────────────────────────────────────────┐
│  Chrome Extension — Background Service Worker      │
│  (background.js, ~229 KB minified)                 │
│                                                    │
│  Responsibilities:                                 │
│  — Session & tab lifecycle management               │
│  — Chrome Debugger API (CDP 1.3) attach/detach      │
│  — CDP event forwarding to native host             │
│  — Cursor state sync → content script              │
│  — Favicon badge manager (active/deliverable/etc)  │
│  — Heartbeat (every 30s, emergency shutdown)        │
│  — Deferred extension updates                      │
│  — Tab lease system (active/handoff/deliverable)    │
│  — Weighted semaphore (priority task queue)         │
└───────────┬───────────────────────────────────────┘
            │ chrome.tabs.sendMessage
            ▼
┌───────────────────────────────────────────────────┐
│  Content Script (codex.js, ~25 KB minified)       │
│                                                    │
│  Responsibilities:                                 │
│  — Animated agent cursor (Spring Physics Engine)    │
│  — Favicon badge (SVG overlay on tab icon)         │
│  — Shadow DOM (closed, z-index: 2147483646)          │
│  — MutationObserver (anti-removal protection)        │
│  — WXT Content Script Lifecycle Manager               │
└───────────────────────────────────────────────────┘
```

## 📂 Repository Structure

```
Codex-Chrome-Extension/
├── extension/                          # Original extension files (as-is)
│   ├── manifest.json                   # Manifest V3
│   ├── background.js                   # Service Worker (~229 KB, minified)
│   ├── popup.html                      # Popup page
│   ├── content-scripts/
│   │   └── codex.js                    # Content Script (~25 KB, minified)
│   ├── chunks/
│   │   └── popup-CTe__03-.js          # Popup JS (React 19 + Tailwind 4)
│   ├── assets/
│   │   └── popup-DzS88qVA.css         # Popup CSS
│   ├── images/
│   │   ├── icon16/32/48/128.png        # Extension icons
│   │   └── cursor-chat.png            # Agent cursor image
│   └── _metadata/
│       └── verified_contents.json      # SHA-256 treehash signature
│
└── deobfuscated/
    └── codex-readable.js              # Content Script (~850 lines, fully readable)
```

## 🧠 70+ Browser Control Commands

Recovered from Zod schemas in background.js. Most are handled by the native host, not the extension itself.

### Navigation & Tabs
| Command | Description |
|---------|-------------|
| `tab_navigate` | Navigate to URL (`wait_until: load\|networkidle\|commit`) |
| `tab_wait_for_load` | Wait for page load |
| `tab_wait` | Wait N milliseconds |
| `tab_close` | Close tab |
| `tab_get_info` | Tab URL, title, ID |
| `tab_set_title` | Set tab title |

### Input
| Command | Description |
|---------|-------------|
| `tab_click` | Click at coordinates (x, y, button, modifiers) |
| `tab_drag` | Drag along a path of `[{x,y}]` points |
| `tab_hover` | Hover cursor |
| `tab_press_key` | Press key(s) (array of keys, modifiers) |
| `tab_type` | Type text |

### DOM Operations (Playwright-style Selectors)
| Command | Description |
|---------|-------------|
| `tab_wait_for_selector` | Wait for element (attached/visible/hidden) |
| `tab_get_element_count` | Element count by selector |
| `tab_select_option` | Select option in `<select>` |
| `tab_set_checked` | Set checkbox state |
| `tab_get_value` / `tab_set_value` | Input value |
| `tab_get_attribute` / `tab_set_attribute` | Element attributes |
| `tab_get_text_content` / `tab_set_text_content` | Element text |
| `tab_focus` / `tab_blur` | Focus / blur element |
| `tab_dismiss` | Dismiss dialog (alert/confirm/prompt) |

### Screenshots & Export
| Command | Description |
|---------|-------------|
| `tab_screenshot` | Screenshot (fullPage, crop) |
| `tab_print_to_pdf` | Export to **PDF, MD, XLSX, CSV, DOCX, PPTX** (!) |
| `tab_save_as` | Save page |

### Code Execution
| Command | Description |
|---------|-------------|
| `tab_evaluate` | Execute JavaScript in tab context |
| `tab_get_console_logs` | Console logs (filter by level) |

### Clipboard
| Command | Description |
|---------|-------------|
| `tab_read_clipboard` | Read clipboard |
| `tab_write_clipboard` | Write to clipboard |

### Browser-level
| Command | Description |
|---------|-------------|
| `browser_visibility_get/set` | Show/hide browser window |
| `browser_viewport_set/reset` | Manage viewport (default 1280×720) |

### Files & Downloads
| Command | Description |
|---------|-------------|
| `tab_wait_for_download` | Wait for download completion |
| `tab_get_download_path` | Downloaded file path |
| `tab_wait_for_file_chooser` | Wait for file chooser dialog |
| `tab_set_files` | Set files in file chooser |

### And More
- `tab_scroll` — scroll to coordinates
- `tab_search` / `tab_get_search_results` — in-page search
- `tab_page_assets_list` / `tab_page_assets_bundle` — page resources
- `tab_get_interactive_element` — element at coordinates
- `tab_resolve_selector` / `tab_resolve_selector_values` — selector resolution
- `tab_wait_for_element_value` — wait for input value
- `tab_get_checked` / `tab_get_selected_option` / `tab_get_select_options` — form state
- `tab_read_clipboard` / `tab_write_clipboard` — clipboard with presentation style

---

## ⚡ Under the Hood — The Interesting Parts

### 1. Custom Spring Physics Engine

The agent cursor is animated via a **fully custom spring physics engine** running at 60Hz. Semi-implicit Euler integrator with fixed timestep. No libraries.

**7 spring types running simultaneously:**
- `positionX/Y` — cursor position
- `rotation` — rotation angle
- `stretch` — squash-and-stretch during movement
- `scootAxis` — rotation axis for short moves
- `scootRotation` — wiggle effect
- `scootStretch` — squash during scoot animation
- `visibility` — appear/disappear with blur effect

Each spring is configured with `response` (stiffness) and `dampingFraction` (damping). Same concept as Framer Motion, but built from scratch.

### 2. Bézier Motion Path Generator

For every cursor move, **up to 80+ candidate paths** are generated:

1. Start/end control points are computed (clamped to viewport bounds)
2. A "direct" candidate is created (no arc)
3. Combinations are iterated: 3 arc distances × 3 handle sizes × 2 sides = **18 arc candidates**
4. Each candidate is scored on **6 metrics**: length, angular energy, max angle change, total turn, bounds compliance, alignment with default click angle (-44°)
5. The best candidate wins

- **Long moves** (>196px) → Bézier curve path
- **Short moves** → "scoot" animation (squash-and-stretch wiggle)
- **Idle/thinking** → wobble animation (sin wave with envelope, starts after 2.5s)

### 3. Heartbeat System — Zombie Protection

Every **30 seconds**, the extension pings the native host with a 3s timeout. If the ping fails:

> **EMERGENCY SHUTDOWN**: stop all sessions → force-detach debugger from all tabs.

This prevents the scenario where the native host crashes but the extension keeps debugger attached (which locks up tabs).

### 4. Weighted Semaphore — Priority Task Queue

Class `Nr` — a **weighted semaphore with priorities**. Each task has a `weight` (resource consumption) and `priority` (queue position). Higher-priority tasks are inserted closer to the front. This ensures critical operations (like heartbeat) never get blocked by long-running tasks.

### 5. Tab Lease System

Tabs aren't just "owned" by a session — they're **leased** with states:
- **`active`** — agent is controlling the tab
- **`handoff`** — tab handed to user for review
- **`deliverable`** — result is ready, awaiting user inspection

On finalization: `active` → closed, `handoff` → preserved, `deliverable` → badge + released.

### 6. Deferred Extension Updates

If the extension updates while the agent is active — the update is **deferred** until the agent finishes. A pending version is saved to storage, and the extension reloads at the first opportunity.

### 7. Shadow DOM + MutationObserver

The content script creates its overlay in **closed Shadow DOM** (`z-index: 2147483646`, `pointer-events: none`). Styles are completely isolated from the page. If a website removes the overlay — **MutationObserver instantly recreates it**.

### 8. 🤫 WebMCP — Hidden Feature (dev/internal only)

An experimental protocol that lets the LLM invoke MCP tools registered by **the web page itself** via `navigator.modelContext`. Disabled in production.

### 9. 🛡 Anti-Bot? Nope!

**The most interesting finding: there are zero anti-bot mechanisms.**

- No User-Agent spoofing
- No `navigator.webdriver` reset
- No stealth plugins
- No CAPTCHA bypass
- No Canvas/WebGL/AudioContext fingerprint manipulation

The extension operates **legitimately on behalf of the user**. It doesn't hide its presence — it **advertises** it (animated cursor, favicon badges, "Codex" tab groups). When debugger is attached, it even sets `navigator.webdriver = true` and doesn't mask it.

---

## 📡 Communication Protocol

### Background ↔ Content Script

| Message Type | Direction | Description |
|-------------|-----------|-------------|
| `CONTENT_PING` | BG→CS→BG | Liveness check (1s timeout) |
| `AGENT_CURSOR_STATE` | BG→CS | Cursor state `{cursor, isVisible, sessionId, turnId}` |
| `TAB_FAVICON_BADGE` | BG→CS | Favicon badge `{badge, faviconDataUrl}` |
| `GET_AGENT_CURSOR_STATE` | CS→BG | Request current cursor state |
| `AGENT_CURSOR_ARRIVED` | CS→BG | Cursor arrived (animation complete) |

Cursor animation flow:
1. Native host sends `moveMouse` → background stores coordinates
2. Background sends `AGENT_CURSOR_STATE` to content script
3. Content script runs **physics-based cursor animation** (Bézier curves, springs)
4. When animation completes → content script sends `AGENT_CURSOR_ARRIVED` back
5. Background resolves the arrival waiter → unblocks the next agent step
6. **Animation timeout: 1500ms** (falls back to snap)

### Background ↔ Native Host (JSON-RPC 2.0)

Key methods handled locally in background.js:
- `ping` → `pong` (health check)
- `moveMouse` — cursor movement with animation
- `executeCdp` — direct CDP command to tab
- `attach` / `detach` — debugger connect/disconnect
- `attachTarget` / `detachTarget` — iframe target support
- `createTab` / `claimUserTab` / `finalizeTabs` — tab management
- `getTabs` / `getUserTabs` / `getUserHistory` — tab info queries
- `nameSession` — custom session name (tab group title)
- `turnEnded` — agent turn completion
- `getInfo` → `{name: "Chrome", type: "extension", capabilities: [...], metadata: {...}}`

### Content Security Policy

```
script-src 'self'
connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*
font-src 'self' https://cdn.openai.com
```

Only localhost connections. No third-party endpoints.

---

## 🔧 Tech Stack

| Technology | Purpose |
|-----------|---------|
| **Manifest V3** | Modern Chrome Extension standard |
| **WXT** | Extension development framework |
| **React 19** | Popup UI |
| **Tailwind CSS 4** | Popup styling |
| **Chrome DevTools Protocol 1.3** | Tab control via `chrome.debugger` |
| **Native Messaging** | Communication with desktop app |
| **Zod** | Message schema validation |
| **Custom Spring Physics** | Cursor animation engine (no libraries) |
| **Shadow DOM (closed)** | Overlay isolation from page content |

---

## ⚠️ How to Install (Europe / Restricted Regions)

1. Download the **ZIP archive** from the [latest release](https://github.com/megamen32/Codex-Chrome-Extension/releases)
2. Extract the ZIP to a folder on your computer
3. Open `chrome://extensions/` in Chrome
4. Enable **Developer mode** (toggle in top-right corner)
5. Click **Load unpacked**
6. Select the extracted `extension` folder
7. Download and install the **Codex Desktop App** from OpenAI
8. In Codex app: **Settings → Computer use → Any App** — enable
9. In Codex app: **Settings → Computer use → Google Chrome** — enable

## ⚠️ Disclaimer

Extension files are property of OpenAI. This repository was created **for research and educational purposes only** (reverse engineering analysis). Not affiliated with or endorsed by OpenAI.

## License

Original extension files © OpenAI. Analysis and documentation © 2025. Research use only.
