# 🔍 Codex Chrome Extension — Reverse Engineering

> **OpenAI Codex / ChatGPT Browser Agent** — полный реверс-инжиниринг Chrome-расширения для управления браузером через AI. Анализ двух версий: **Codex v1.1.5** (popup-based) и **ChatGPT v1.2.27203.26575** (side panel + Playwright-based).

**📖 [English version](README.en.md)**

## Что это

Chrome-расширение от OpenAI, позволяющее AI-агенту (Codex / ChatGPT) управлять вашим браузером: кликать, печатать, скроллить, переходить по ссылкам, делать скриншоты и выполнять JavaScript. Расширение недоступно в Europe, но его можно установить вручную.

## ⚡ Что нового в ChatGPT v1.2.27203.26575 (vs Codex v1.1.5)

Расширение пережило **мажорный рефакторинг** — из компактного popup-инструмента (~552 KB) превратилось в полноценный **браузерный агент-фреймворк** (~93 MB). Архитектура сменилась полностью: всё, что раньше было в `background.js`, теперь разнесено между `background.js` (тонкий диспетчер) и `codex-sidepanel/` (тяжёлый React-интерфейс).

### Новые capabilities (top-level API)

| Capability | Что делает |
|---|---|
| **`cdp`** | Прямой Chrome DevTools Protocol — extension пробрасывает сырые CDP-команды (`Target.sendMessage`, `DOM.getDocument` и т.д.) к любой вкладке с возможностью подписки на debugger events. |
| **`playwright` (locator API)** | Полноценный Playwright-совместимый locator API: `locator.click()`, `dblclick()`, `selectOption()`, `fill()`, `type()`, `press()`, `setChecked()`, `waitFor()`, `textContent()`, `innerText()`, `getAttribute()`, `isVisible()`, `isEnabled()`, `count()`, `all()`, `downloadMedia()`, `first()`, `last()`, `nth()`, `and()`, `or()`, `filter()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()`. Это серьёзный скачок — был простой клик по координатам, стал селекторный API. |
| **`webmcp`** | Инвокация page-defined tools через `navigator.modelContext` — расширение умеет вызывать MCP-тулы, зарегистрированные на странице. Это для интеграции с AI-агентами, которые публикуют свои tools прямо в браузере. |
| **`botDetection`** | Репортинг бот-детекции: extension может сообщить нативному хосту, что на странице CAPTCHA / access denied / challenge loop. Нативный хост может среагировать (например, попросить пользователя помочь). |
| **`browserAuth`** | Secure auth handoff — extension передаёт нативному хосту запрос на ввод credentials (origin, reason, expires_at ≤ 5 min, fields, submit action), хост рендерит UI и вводит данные безопасно. Команда `tab_browser_auth_handoff` с structured `fields` массивом. |
| **`pageAssets`** | Сбор ассетов страницы (fonts/images/stylesheets/videos) в локальный артефакт. Сначала `tab_page_assets_list` (получить инвентарь), затем `tab_page_assets_bundle` (скачать выбранные в локальный manifest с `directoryPath`, `manifestPath`, `summary`). |
| **`visibility`** | Управление видимостью headless-браузера: `browser_visibility_get` / `browser_visibility_set` (true/false). Позволяет агенту работать в фоне, не мешая пользователю. |
| **`viewport`** | Управление размером viewport: `browser_viewport_set` (width, height) / `browser_viewport_reset`. Для responsive-тестирования и эмуляции device size. |

### Архитектурные изменения

| | Codex v1.1.5 | ChatGPT v1.2.27203.26575 |
|---|---|---|
| **Размер** | 552 KB | 93 MB |
| **`background.js`** | 229 KB, всё в одном файле | 180 KB, тонкий диспетчер |
| **UI** | Popup (popup.html, React 19, ~1 файл) | Полноценный **side panel** (`codex-sidepanel/index.html`), 1583 чанка |
| **Permissions** | 11 | +`sidePanel`, +`webNavigation`; −`readingList`, −`downloads.ui` |
| **Минимальный Chrome** | не указан | 116 |
| **`side_panel` API** | нет | `default_path: "codex-sidepanel/index.html"` |
| **Commands** | нет | `Cmd+Shift+Period` / `Ctrl+Shift+Period` → open side panel |
| **Optional permissions** | нет | `downloads.open` |
| **Connect-src CSP** | localhost only | +`https://ab.chatgpt.com`, +`https://chatgpt.com` |
| **Локализация** | en only | 118 locale-файлов (ru-RU, en-GB, te-IN, my-MM и т.д.) |
| **Code highlighting** | нет | shiki с 24+ языками (ada, abap, angular, apl, asciidoc, asm, astro...) и 194 темами |
| **PDF render** | нет | `pdf.worker.min.mjs` (1 MB) |
| **IDE/terminal icons** | нет | 27 шт. в `codex-sidepanel/apps/` (vscode, cursor, zed, warp, iterm2, intellij и т.д.) |
| **Сторонние системы** | popup + native host | popup → side panel + native host + **JSON-RPC 2.0 protocol** + **WXT storage framework** + Zod schema validation |

### Storage / infrastructure

В новой версии используется:
- **JSON-RPC 2.0** для нативного хоста (раньше — кастомный протокол)
- **WXT storage framework** (`@wxt-dev/storage`) — миграции версий, метаданные, watch
- **Zod** для валидации всех message schemas
- **Playwright-style locator API** в client side
- **appgen** — генератор приложений (видны в чанках: `appgen-access`, `appgen-settings-dialog`, `appgen-share-dialog`)

### Команды (новый transport)

В новой версии все capability-команды идут через единый dispatcher с типизацией. Старая версия использовала `case` в switch — простая логика, ~70 команд. Новая — JSON-RPC с `commandType: () => "..."` и schema validation, **7 top-level capabilities с подкомандами**:
- `tab_cdp_call`, `tab_cdp_events`
- `tab_browser_auth_handoff`
- `tab_bot_detection_report`
- `tab_page_assets_list`, `tab_page_assets_bundle`
- `browser_visibility_get`, `browser_visibility_set`
- `browser_viewport_set`, `browser_viewport_reset`
- `tab_webmcp_invoke_tool`, `tab_webmcp_list_tools`

### Manifest: прямое сравнение

```diff
{
  "name": "Codex" → "ChatGPT"
  "description": "Control Chrome with Codex." → "Control Chrome with ChatGPT."
  "version": "1.1.5" → "1.2.27203.26575"
  
  "action": {
    "default_popup": "popup.html",     // ← удалён
    "default_icon": ...,                
    "default_title": "Codex" → "ChatGPT"
  },
  
+ "minimum_chrome_version": "116",
+ "commands": { "open-codex-side-panel": { "suggested_key": "Cmd+Shift+Period" } },
+ "optional_permissions": ["downloads.open"],
+ "side_panel": { "default_path": "codex-sidepanel/index.html" },
  
  "permissions": [
-   "downloads.ui",
-   "readingList",
+   "sidePanel",
+   "webNavigation",
    ...
  ],
  
  "content_security_policy": {
    "extension_pages": "...; connect-src ... https://ab.chatgpt.com https://chatgpt.com; ..."
  }
}
```

### Файловая структура

**Codex v1.1.5 (552 KB):**
```
extension/
├── background.js (229 KB)
├── popup.html
├── chunks/popup-CTe__03-.js
├── content-scripts/codex.js
├── assets/popup-DzS88qVA.css
├── _metadata/verified_contents.json
├── images/{icon16,32,48,128}.png, cursor-chat.png
└── manifest.json
```

**ChatGPT v1.2.27203.26575 (93 MB):**
```
extension/
├── background.js (180 KB)               # тонкий диспетчер
├── microphone-permission.html           # новый — для диктовки
├── chunks/microphone-permission-Cdowufbn.js
├── codex-sidepanel/                     # новый — полный UI
│   ├── index.html
│   ├── apps/ (27 IDE/terminal иконок)
│   └── assets/ (1583 чанка: shiki, темы, локали, React-роуты...)
├── images/{icon16,32,128}.png, cursor-chat.png
└── manifest.json
```

### Что это значит для пользователя

- **Расширение из popup'a превратилось в fullscreen side panel** — больше места, больше контролов, thread-based chat с вкладками (видны `thread-page`, `app-shell-tab-controller`, `thread-context`).
- **Появилась поддержка микрофона** для голосовой диктовки (`microphone-permission.html` + `downloads.open`).
- **Multi-tab agent control** — capability `cdp` и `tab_*` префиксы означают, что агент может управлять несколькими вкладками и переключаться между ними.
- **WebMCP** — расширение нативно работает с MCP-тулами, зарегистрированными на странице (`navigator.modelContext`). Это будущее для AI-агентов в браузере.
- **Локализация** — теперь не только en, 118 locale-файлов.

## Архитектура

```
┌─────────────────────────┐
│  OpenAI API             │ ← LLM, скриншоты, принятие решений
│  (Codex / ChatGPT)      │
└───────────┬─────────────┘
            │ JSON-RPC 2.0
            ▼
┌─────────────────────────┐
│  Native Host App        │ ← com.openai.codexextension
│  (десктоп-приложение)   │   chrome.runtime.connectNative()
│                         │
│  Основной "мозг":       │    — Обрабатывает 70+ команд
│  — Навигация            │    — Делает скриншоты
│  — DOM-анализ           │    — Управляет viewport
│  — Клик/ввод/скролл     │    — Выполняет CDP-команды
└───────────┬─────────────┘
            │ Native Messaging
            ▼
┌───────────────────────────────────────────────────┐
│  Chrome Extension — Background Service Worker     │
│  (background.js, ~229 KB минифицировано)           │
│                                                    │
│  Роли:                                             │
│  — Управление сессиями и вкладками                 │
│  — Подключение chrome.debugger (CDP 1.3)           │
│  — Трансляция CDP-событий в native host            │
│  — Синхронизация курсора → content script          │
│  — Favicon badge manager (active/deliverable/etc)  │
│  — Heartbeat (каждые 30с, emergency shutdown)      │
│  — Отложенные обновления расширения                │
│  — Tab lease система (active/handoff/deliverable)   │
│  — Weighted Semaphore (приоритетная очередь задач)  │
└───────────┬───────────────────────────────────────┘
            │ chrome.tabs.sendMessage
            ▼
┌───────────────────────────────────────────────────┐
│  Content Script (codex.js, ~25 KB минифицировано)  │
│                                                    │
│  Роли:                                             │
│  — Анимированный курсор агента (Spring Physics)     │
│  — Favicon badge (SVG overlay на фавиконку)         │
│  — Shadow DOM (closed, z-index: 2147483646)        │
│  — MutationObserver (защита от удаления оверлея)     │
│  — WXT Content Script Lifecycle Manager             │
└───────────────────────────────────────────────────┘
```

## 📂 Структура репозитория

```
Codex-Chrome-Extension/
├── extension/                          # Оригинальные файлы расширения (как есть)
│   ├── manifest.json                   # Manifest V3
│   ├── background.js                   # Service Worker (~229 KB, минифицирован)
│   ├── popup.html                      # Popup страница
│   ├── content-scripts/
│   │   └── codex.js                    # Content Script (~25 KB, минифицирован)
│   ├── chunks/
│   │   └── popup-CTe__03-.js          # Popup JS (React 19 + Tailwind 4)
│   ├── assets/
│   │   └── popup-DzS88qVA.css         # Popup CSS
│   ├── images/
│   │   ├── icon16/32/48/128.png        # Иконки расширения
│   │   └── cursor-chat.png            # Курсор агента
│   └── _metadata/
│       └── verified_contents.json      # SHA-256 treehash подписи
│
└── deobfuscated/
    └── codex-readable.js              # Content Script (~850 строк, полностью читаемый)
```

## 🧠 70+ команд управления браузером

Через Zod-схемы в background.js восстановлен полный набор команд. Большинство обрабатываются в native host, не в расширении.

### Навигация и вкладки
| Команда | Описание |
|---------|----------|
| `tab_navigate` | Переход по URL (`wait_until: load\|networkidle\|commit`) |
| `tab_wait_for_load` | Ожидание загрузки страницы |
| `tab_wait` | Ожидание N миллисекунд |
| `tab_close` | Закрытие вкладки |
| `tab_get_info` | URL, заголовок, ID вкладки |
| `tab_set_title` | Установка заголовка |

### Ввод
| Команда | Описание |
|---------|----------|
| `tab_click` | Клик по координатам (x, y, button, modifiers) |
| `tab_drag` | Перетаскивание по пути из точек `[{x,y}]` |
| `tab_hover` | Наведение курсора |
| `tab_press_key` | Нажатие клавиши (массив keys, modifiers) |
| `tab_type` | Ввод текста |

### DOM-операции (Playwright-style)
| Команда | Описание |
|---------|----------|
| `tab_wait_for_selector` | Ожидание элемента (attached/visible/hidden) |
| `tab_get_element_count` | Количество элементов по селектору |
| `tab_select_option` | Выбор опции в `<select>` |
| `tab_set_checked` | Установка checkbox |
| `tab_get_value` / `tab_set_value` | Значение input |
| `tab_get_attribute` / `tab_set_attribute` | Атрибуты элемента |
| `tab_get_text_content` / `tab_set_text_content` | Текст элемента |
| `tab_focus` / `tab_blur` | Фокус/разфокус |
| `tab_dismiss` | Закрыть диалог (alert/confirm/prompt) |

### Скриншоты и экспорт
| Команда | Описание |
|---------|----------|
| `tab_screenshot` | Скриншот (fullPage, crop) |
| `tab_print_to_pdf` | Экспорт в **PDF, MD, XLSX, CSV, DOCX, PPTX** (!) |
| `tab_save_as` | Сохранение страницы |

### Выполнение кода
| Команда | Описание |
|---------|----------|
| `tab_evaluate` | Выполнение JavaScript в контексте вкладки |
| `tab_get_console_logs` | Логи консоли (фильтр по уровням) |

### Clipboard
| Команда | Описание |
|---------|----------|
| `tab_read_clipboard` | Чтение буфера обмена |
| `tab_write_clipboard` | Запись в буфер обмена |

### Browser-level
| Команда | Описание |
|---------|----------|
| `browser_visibility_get/set` | Показать/скрыть браузер |
| `browser_viewport_set/reset` | Управление viewport (по умолчанию 1280×720) |

### Файлы и загрузки
| Команда | Описание |
|---------|----------|
| `tab_wait_for_download` | Ожидание загрузки |
| `tab_get_download_path` | Путь к загруженному файлу |
| `tab_wait_for_file_chooser` | Ожидание диалога выбора файла |
| `tab_set_files` | Установка файлов в file chooser |

### И ещё
- `tab_scroll` — скролл к координатам
- `tab_search` / `tab_get_search_results` — поиск по странице
- `tab_page_assets_list` / `tab_page_assets_bundle` — ресурсы страницы
- `tab_get_interactive_element` — элемент по координатам

---

## ⚡ Самое интересное под капотом

### 1. Spring Physics Engine — собственный физический движок

Курсор агента анимируется через **полностью кастомный spring-движок** на 60Hz. Semi-implicit Euler интегратор с фиксированным шагом. Никаких библиотек.

**7 типов spring'ов** одновременно:
- `positionX/Y` — позиция курсора
- `rotation` — угол поворота
- `stretch` — squash-and-stretch при движении
- `scootAxis` — ось вращения для коротких перемещений
- `scootRotation` — wiggle-эффект
- `scootStretch` — squash при scoot
- `visibility` — появление/исчезание с blur-эффектом

**Каждый spring** настраивается через `response` (жёсткость) и `dampingFraction` (демпфирование). Это те же параметры, что в Framer Motion, но реализация с нуля.

### 2. Bézier Motion Paths — генератор кривых движения

Для каждого перемещения курсора генерируется **до 80+ кандидатов** пути:

1. Вычисляются start/end контрольные точки (зажимаются в bounds viewport'а)
2. Создаётся «прямой» кандидат (без арки)
3. Перебираются комбинации: 3 дистанции арки × 3 размера хэндла × 2 стороны = **18 арочных кандидатов**
4. Каждый кандидат оцифровывается по **6 метрикам**: длина, angular energy, max angle change, total turn, bounds compliance, alignment с дефолтным углом клика (-44°)
5. Лучший кандидат побеждает

**Для длинных перемещений** (>196px) — используется Bézier path.
**Для коротких** — "scoot" анимация (squash-and-stretch wiggle).
**Для "мышления"** — idle wobble (sin-волна с envelope, запускается через 2.5с ожидания).

### 3. Heartbeat System — защита от зомби

Каждые **30 секунд** расширение пингует native host с таймаутом 3с. Если пинг не прошёл:

> **EMERGENCY SHUTDOWN**: остановка всех сессий → принудительное отключение debugger ото всех вкладок.

Это защита от ситуации, когда native host крашнулся, а расширение продолжает держать debugger подключенным (что блокирует вкладки).

### 4. Weighted Semaphore — приоритетная очередь

Класс `Nr` — **взвешенный семафор** с приоритетами. Каждая задача имеет `weight` (занимаемая «масса») и `priority` (приоритет). Задачи с более высоким приоритетом вставляются ближе к началу очереди. Это гарантирует, что критические операции (например, heartbeat) не блокируются долгими задачами.

### 5. Tab Lease System — «аренда» вкладок

Вкладки не просто «принадлежат» сессии — они **арендуются** с состояниями:
- **`active`** — агент контролирует вкладку
- **`handoff`** — вкладка передана пользователю для проверки
- **`deliverable`** — результат готов, ждёт просмотра

При финализации: `active` → закрыта, `handoff` → сохранена, `deliverable` → бейдж + освобождена.

### 6. Отложенные обновления

Если расширение обновляется, пока агент активен — обновление **откладывается** до завершения работы. В storage сохраняется pending version, и при первой возможности расширение перезагружается.

### 7. Shadow DOM + MutationObserver

Content script создаёт overlay в **closed Shadow DOM** (`z-index: 2147483646`, `pointer-events: none`). Стили полностью изолированы от страницы. Если сайт удалит оверлей — **MutationObserver мгновенно пересоздаёт его**.

### 8. 🤫 WebMCP — скрытая фича (dev/internal only)

Экспериментальный протокол, позволяющий LLM вызывать MCP-инструменты, зарегистрированные **самой веб-страницей** через `navigator.modelContext`. В production отключено.

### 9. 🛡 Антибот? Нет!

**Самый интересный вывод: никаких анти-бот механизмов нет.**

- Никакой подмены User-Agent
- Никакого сброса `navigator.webdriver`
- Никаких stealth-плагинов
- Никакого обхода CAPTCHA
- Никаких манипуляций с Canvas/WebGL/AudioContext fingerprint

Расширение работает **легально от имени пользователя**. Оно не скрывает своё присутствие — наоборот, показывает его (анимированный курсор, бейджи на вкладках, группы вкладок «Codex»). При подключении debugger даже ставит `navigator.webdriver = true` — и не маскирует это.

---

## 📡 Протокол коммуникации

### Background ↔ Content Script

| Тип сообщения | Направление | Описание |
|---------------|-------------|----------|
| `CONTENT_PING` | BG→CS→BG | Проверка живости (таймаут 1с) |
| `AGENT_CURSOR_STATE` | BG→CS | Состояние курсора `{cursor, isVisible, sessionId, turnId}` |
| `TAB_FAVICON_BADGE` | BG→CS | Бейдж фавиконки `{badge, faviconDataUrl}` |
| `GET_AGENT_CURSOR_STATE` | CS→BG | Запрос текущего состояния курсора |
| `AGENT_CURSOR_ARRIVED` | CS→BG | Курсор прибыл (анимация завершена) |

### Background ↔ Native Host (JSON-RPC 2.0)

Ключевые методы:
- `ping` → `pong` (health check)
- `moveMouse` — движение курсора с анимацией
- `executeCdp` — прямая CDP-команда в вкладку
- `attach` / `detach` — подключение/отключение debugger
- `createTab` / `claimUserTab` / `finalizeTabs` — управление вкладками
- `getInfo` → `{name: "Chrome", capabilities: [...], metadata: {...}}`

### Content Security Policy

```
script-src 'self'
connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*
font-src 'self' https://cdn.openai.com
```

Только localhost. Никаких сторонних подключений.

---

## 🔧 Технологии

- **Manifest V3** — современный стандарт Chrome Extensions
- **WXT** — фреймворк для разработки (wxt-dev)
- **React 19** + **Tailwind CSS 4** — popup UI
- **Chrome DevTools Protocol 1.3** — управление вкладками
- **Native Messaging** — связь с десктоп-приложением
- **Zod** — валидация схем сообщений
- **Spring Physics** — кастомный движок (без библиотек)
- **Shadow DOM (closed)** — изоляция overlay'я

---

## ⚠️ Как установить (Europe)

1. Скачайте **ZIP-архив** из [Releases](https://github.com/megamen32/Codex-Chrome-Extension/releases)
2. Распакуйте архив в любую папку
3. Откройте `chrome://extensions/`
4. Включите **Developer mode** (в правом верхнем углу)
5. Нажмите **Load unpacked**
6. Выберите распакованную папку `extension`
7. Скачайте и установите **Codex Desktop App** от OpenAI
8. В Codex: **Settings → Computer use → Any App** — включить
9. В Codex: **Settings → Computer use → Google Chrome** — включить

## Лицензия

Файлы принадлежат OpenAI. Репозиторий создан исключительно для исследовательских целей (reverse engineering).
