# 🔍 Codex Chrome Extension — Reverse Engineering

> **OpenAI Codex Browser Agent v1.1.5** — полный реверс-инжиниринг Chrome-расширения для управления браузером через AI.

## Что это

Chrome-расширение от OpenAI, позволяющее AI-агенту (Codex / ChatGPT) управлять вашим браузером: кликать, печатать, скроллить, переходить по ссылкам, делать скриншоты и выполнять JavaScript. Расширение недоступно в Europe, но его можно установить вручную.

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

1. Скачайте файлы из папки `extension/`
2. Откройте `chrome://extensions/`
3. Включите **Developer mode** (в правом верхнем углу)
4. Нажмите **Load unpacked**
5. Выберите папку `extension/`
6. Скачайте и установите **Codex Desktop App** от OpenAI
7. В Codex: **Settings → Computer use → Google Chrome → включить**

## Лицензия

Файлы принадлежат OpenAI. Репозиторий создан исключительно для исследовательских целей (reverse engineering).
