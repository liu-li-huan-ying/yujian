# YuJian Markdown Editor (玉笺)

> A cross-platform, what-you-see-is-what-you-get desktop Markdown editor with a one-click source-mode toggle.
> Built for **technical writing** by default: code highlighting, Mermaid diagrams, math, tables, and multi-format export.

[![Electron](https://img.shields.io/badge/Electron-44-47848f?logo=electron\&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3.5-42b883?logo=vue.js\&logoColor=white)](https://vuejs.org/)
[![Milkdown](https://img.shields.io/badge/Milkdown-Crepe%207.22-ff69b4)](https://milkdown.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#installers)
[![Docs](https://img.shields.io/badge/Docs-%E4%B8%AD%E6%96%87%E7%89%88-blue)](./README.md)

> 🇨🇳 **中文文档**: [README.md](./README.md) ｜ 📐 Material & skin design report: [docs/preview/style-report-v1.html](./docs/preview/style-report-v1.html)

**YuJian** (玉笺, literally "a letter on jade") is a local-first Markdown writing tool: a folder *is* your vault, documents are plain `.md` files, and your data is always readable, Git-friendly, and portable. The editing core is built on [Milkdown Crepe](https://milkdown.dev/); Markdown is a first-class citizen, and an unedited document is written back byte-for-byte.

Visually, YuJian speaks the language of **jade** — a jade-textured framework, glassy floating layers, and a clean solid-color content surface — and ships with five traditional Chinese kiln-inspired skins (Celadon / Sky / Moon / Dai / Amber) plus dark / light / system modes.

![YuJian UI illustration](./docs/assets/yujian-overview.svg)

***

## ✨ Features

### Editing experience

* **Dual-mode editing** — WYSIWYG by default, one-click to source mode (`Ctrl + /`); both modes share the same Markdown text with no content loss on switch.
* **Markdown round-trip fidelity** — an unedited document is saved verbatim, so formatters never pollute your Git diff.
* **Technical-writing suite** — syntax highlighting (`@codemirror/language-data`, all languages), **adaptive code-block height** (compact for short snippets, `70vh` cap for long, with its own jade scrollbar), Mermaid diagrams, KaTeX math, tables, task lists.
* **Unified jade content theme** — every native element in the editor (code panels, tables, blockquotes, inline code, rules, list markers, task checkboxes, images, floating menus) uses jade design tokens and reacts live to the five skins and light/dark mode.
* **Unified glass material (all overlays)** — title-bar dropdowns, context menus, help / preferences / appearance panels, and *every* in-editor Crepe overlay (slash menu, selection bubble, link preview / editor, block "+" menu) **share one glass recipe**, switching with light/dark (dark = ink-jade translucency, light = mutton-fat-jade translucency). Zero inconsistency app-wide.
* **Long-token table wrapping** — tables use `table-layout: fixed`; unbreakable bold/emphasized tokens now wrap inside the cell instead of overflowing or overlapping neighbors.
* **Consistent left-rail block handles** — add/drag handles now anchor to the **block's own left edge** (Notion-style; indented blocks shift right, never flip to the right side) and sit in a fixed gutter 12px left, redone as a jade-glass pill that never covers text.
* **Polished empty states** — centered icon badge + hint when no vault/doc is open.
* **Document outline** — right panel extracts headings live; click to jump; current section auto-highlights on scroll (100ms throttle).
* **Customizable panels** — sidebar and outline toggle independently (title-bar icons or `Ctrl+\` / `Ctrl+Shift+\`); state persisted; auto-collapse on narrow windows.
* **Jade scrollbars** — thin, rounded, translucent scrollbars everywhere, following skin & mode.
* **Reading progress bar** — the editor's native scrollbar is hidden; a right-side jade progress bar (celadon gradient + soft glow, round thumb on hover/drag, click-to-jump) indicates position.

### CJK typography

* **Automatic ¼ em Han–Latin / Han–digit spacing** — a ¼ em visual gap is inserted between Han characters and Latin letters or digits (the engine-level behaviour recommended by W3C *Requirements for Chinese Text Layout* §3.2.2), but not next to full-width punctuation; disabled inside code blocks, kept for inline code. **The source file is never modified.**
* **Non-italic CJK emphasis · punctuation squeezing · line-break rules** — emphasis uses the accent colour instead of the much-disliked Chinese italics; consecutive full-width punctuation tightens and line-start/end punctuation stays tidy; CJK paragraph spacing is 4px larger to offset the density of full-width punctuation.
* **Pure render-layer implementation** — delegated to the layout engine via standard CSS (`text-autospace` / `text-spacing-trim`): zero performance cost, no export pollution; each option is toggleable in Preferences, all on by default.
* **Double-click selects a word** — double-clicking Chinese text selects at **word boundaries** (it used to grab a whole run of Han characters including punctuation), so double-clicking 开源 selects exactly 开源; Latin letters and digits keep the editor's original selection logic.

### Large-document performance

* **No lag on 100k-character documents** — very long documents switch on chunked rendering automatically: only blocks near the viewport are painted, off-screen content is rendered on demand by the browser, so scrolling and typing stay smooth.
* **Editor capabilities intact** — this uses a native browser capability rather than removing content from the DOM, so selection, IME, find, export and wikilinks all keep working; **the source file is never modified**.
* **Adaptive and non-intrusive** — active only for very long documents, so ordinary notes are unaffected; scroll feel and the reading-progress bar stay stable without jumping.

### Title bar & help

* **Icon toolbar (redesigned)** — three semantic groups: File / Vault (new · switch vault · open) ｜ View / Layout (WYSIWYG⇄source segmented · sidebar · outline) ｜ Share / Tools (export ⌄ · appearance · more ⌄ · help ?). Low-frequency actions live in dropdowns. Window controls are self-drawn on Windows only; macOS yields to native traffic lights.
* **Customizable shortcuts (settings panel)** — press `F1` or the command palette's "Shortcuts" to open a dedicated settings panel: every command is listed with its current key-cap on the right; click a cap to capture the next key combo (`Esc` cancels, `Delete`/`Backspace` unbinds). A clash with another command can be stolen in one click; clashes with reserved system keys (`Ctrl+N/T/W`, print, `F5/F11/F12`, dev tools…) or editor keys (`Ctrl+C/V/Z/B/I`…) are blocked so basic operations stay intact. Default bindings live in exactly one place (the `keys` field of the command registry in `commands.ts`); the command-palette caps and the runtime dispatch both read from it, so the two can never drift; only overrides are stored and `''` means an explicit unbind, so defaults follow upgrades.
* **Help panel (Guide + About)** — the title-bar "?" opens a glass panel with **Guide** and **About** tabs: the Guide is a 10-step illustrated quick start; the About page shows the version and a short intro. **The keybinding list has moved to the Shortcuts settings panel above** (a hand-written list would go stale the moment bindings become customizable, so it was removed to keep a single source of truth).
* **Command palette (unified entry)** — `Ctrl/Cmd+Shift+P` opens the command palette, `Ctrl/Cmd+K` quick-opens a note: almost any action is a keystroke away (open vault, toggle outline / graph, enter focus, export, switch skin, open the shortcuts settings…) — the fastest entry now that panels have multiplied; the activity bar triggers it too.

### Personal knowledge management (PKM) · new in v2.0.0

* **Command palette** — see "Title bar & help · Command palette" above; `Ctrl/Cmd+Shift+P` runs any command, `Ctrl/Cmd+K` jumps to any note — the unified entry now that panels have multiplied.
* **Bidirectional links `[[wikilink]]`** — write `[[note name]]` in Markdown to link; it's a real editor node, insertable from the hover toolbar or the title-bar "More". The right-side **Backlinks** panel lists every note pointing here; click to jump back to the source.
* **Tags `#tag`** — inline `#tag` marks plus dual-track frontmatter collection; the left **Tags** panel aggregates all tags across the vault for one-click filtering.
* **Content map (MOC)** — mark notes with a frontmatter `moc` field to group them into a map; the left **Content Map** panel presents them by group for a quick thematic overview.
* **Relation graph** — click the 7th activity-bar button for a full-screen Canvas graph: notes are nodes, links are edges, with pan / zoom / drag, local-subgraph focus, and degree-based truncation; an accessible list view is provided (`prefers-reduced-motion` converges straight to the final layout).
* **Rename / move auto-rewrites `[[refs]]`** — renaming or moving a document (whole folders included) updates every `[[link]]` pointing to it, migrating history and attachments together — zero manual link repair.

### Vault

* **Folder = vault** — open any folder as the workspace; the left tree browses all `.md` inside.
* **Auto-save + crash recovery** — edit state persisted to `userData/session.json`; last vault/doc restored on restart.
* **External change sync** — a single chokidar watcher reflects edits/deletes from other programs in real time.
* **Switch working folder** — the title-bar folder icon switches to another directory **without restarting**; current doc auto-saved first.
* **Full-text search** — unified vault index layer (vaultIndex.ts); click a result to jump to the hit line (auto-switches to source for precise jumps).

### Version snapshots & writing aids

* **Version snapshots** — `.yujian-history/` in the vault (separate from the `.mdeditor/` cache, suggested to your `.gitignore`); the title-bar "history" icon opens a glass panel where you can manually save a snapshot with a **note** (e.g. "before publish"); the list shows time + note + char delta, and selecting one renders a **line-level diff** (`diff@7`, add / remove / context) — rollback loads the snapshot into the editor and marks it dirty, **without overwriting the original on disk** (Markdown round-trip fidelity).
* **Writing stats** — the status bar shows "hanzi · words · reading minutes"; click it for a glass popover with hanzi / words / chars (with/without spaces) / reading time breakdown + current **selection stats** + an SVG progress ring for your **writing goal** (persisted with the session).
* **Focus mode** — the title-bar "moon" icon enters a merged typewriter + zen experience: the current line is vertically centered (upper 1/3, smooth scroll, paused on blur) while the active block is **highlighted** and the rest **dimmed** (non-destructive ProseMirror decoration, never touches the document); state restores with the session.

### Images & image host

* **Paste to disk** — pasted images land in a sibling `.assets` folder with relative paths; local is the single source of truth.
* **Image host publish** — SM.MS and custom (PicGo-compatible) hosts; keys encrypted in the main process via `safeStorage`, never sent to the renderer. Batch-replace local images with remote URLs for publishing (e.g., WeChat).

### Export

* **Export HTML** — takes the ProseMirror DOM directly (WYSIWYG delivery), inlining rendered math and Mermaid.
* **Export PDF** — via `webContents.printToPDF`, matching the in-editor look.

### Appearance & personalization

* **Five skins** (traditional Chinese kiln palette) — Celadon (default), Sky, Moon, Dai, Amber, each with dark / light.
* **Three modes** — dark / light / follow system (`prefers-color-scheme`).
* **Material system** — jade framework, glass overlays (`backdrop-filter`), solid content surface for contrast & export fidelity.
* **Persistence** — skin/mode saved to `localStorage`; switching skin does **not** rebuild the editor instance.

### Preferences

* **Startup behavior** — restore last session (default) or always start fresh; persisted in `session.json`.

### Internationalization

* **Chinese / English** — one-click switch in the status bar; Crepe menu labels rebuild with the language (Vue `:key` remount), UI text updates reactively.

***

## 🎨 Design philosophy · three material layers

Jade is not about being green — it is about being **warm and lustrous**: light scatters inside, color is uneven, edges glow, and there is a cloudy interior. YuJian splits the UI into three layers, each with one material:

![YuJian UI illustration](./docs/assets/yujian-material.svg)

1. **Framework layer (title bar / sidebar / outline / status bar) = jade, statically pre-rendered.** Gradient + fine noise (`feTurbulence`, opacity .045) rendered once — **zero runtime cost** — mimicking jade's scattered translucency; the brand core.
2. **Floating layer (all menus / command palette / dialogs) = glass.** Real-time `backdrop-filter: blur(28px) saturate(160~180%)` only on small overlays — glass only makes sense when there is something behind it to blur, and only then is the cost worth it.
3. **Content layer (editor) = solid color, never textured.** Three reasons: reading fatigue, contrast risk below WCAG AA, and **breaking the "take the DOM directly" WYSIWYG export consistency**.

> "Jade" over pure glass because window-level material is inconsistent across platforms (macOS `vibrancy`, Win11 `mica` can show the desktop; Win10 and below fall back to solid) — jade still holds up when degraded.

***

## 🎨 Five skins · traditional Chinese kiln palette

The appearance panel shows real jade-material thumbnails; the selection ring uses an outer stroke so it never covers the material. Each skin has **dark / light** plus "follow system". Switching skin **does not rebuild the editor instance** (Crepe only reads CSS variables); the root node carries `data-skin` / `data-mode`, persisted to `localStorage`. Default: Celadon + Dark.

![YuJian UI illustration](./docs/assets/yujian-skins.svg)

| Skin    | 中文 | Dark accent | Light accent | Character                                              |
| ------- | -- | ----------- | ------------ | ------------------------------------------------------ |
| Celadon | 青瓷 | `#5FA8A0`   | `#248077`    | Ru-ware blue-green, the most "jade"-like (default)     |
| Sky     | 天青 | `#5E9DBE`   | `#2B7BA8`    | "sky after rain", cool blue                            |
| Moon    | 月白 | `#93A7B4`   | `#5A7180`    | moon-white glaze, very pale blue-white, low saturation |
| Dai     | 黛  | `#8B7CB8`   | `#6A5A9E`    | ink-violet, the only cool-purple skin                  |
| Amber   | 琥珀 | `#C79A4E`   | `#9A6F24`    | old amber, the only warm skin                          |

**Structure/material layers are decoupled from the hue layer** — switching skin only changes `--hue-*` hue variables; typography, grid, radius, and motion tokens never change.

***

## 🪟 Unified glass · one material for every overlay

v1 collapses the earlier fragmentation (export dropdown, more dropdown, and about panel each had their own glass) into a **single source of truth with dark/light variants**, covering title-bar dropdowns (export / more), context menus, help / preferences / appearance panels, and the in-editor Crepe slash menu, selection bubble, and link preview / editor. Click outside or `Esc` to close.

![YuJian UI illustration](./docs/assets/yujian-glass.svg)

***

## 🔧 Detail polish

### ① Title bar redesign — grouped icon toolbar

No more "shove a text button wherever". Three semantic icon groups: File / Vault ｜ View / Layout ｜ Share / Tools. Dividers mark group boundaries; 28×28 icon targets meet touch; active state uses accent + jade highlight echoing the segmented control's "on". The whole bar is draggable (`-webkit-app-region: drag`); self-drawn window buttons render on Windows only (macOS yields 78px to native lights).

### ② F1 opens the Shortcuts settings · "?" opens Help

`F1` opens the **Shortcuts settings panel** directly (a prior key-guard bug that swallowed F1 is fixed): it lists every command and lets you rebind each one — the entry point for keyboard users to review and remap. Help (Guide + About) moved to the title-bar "?" button: a glass panel with two tabs, ↑↓ to choose, Enter to run, Esc to close, bilingual. The hand-written keybinding list that used to live in Help is gone (it would go stale once bindings are customizable; the Shortcuts panel is now the single source of truth).

### ③ Block handles — consistent left rail, never covers text

Keeps Crepe floating-ui's **block-left-edge**, nudged only `translateX(-12px)` for breathing room; indented blocks shift right, always left of the block edge, never covering text. A `96px` gutter (≈64px handle + 12px shift + 20px margin) prevents clipping even at the narrowest window.

![YuJian UI illustration](./docs/assets/yujian-handle.svg)

### ④ Long-token table wrapping — no more overlap

Tables use `table-layout: fixed`; previously bold/emphasized unbreakable tokens burst the cell and overlapped neighbors. Now `overflow-wrap: anywhere; word-break: break-word; white-space: normal` wraps any token inside the cell. Accent-filled header, zebra rows, hairline grid, rounded corners.

![YuJian UI illustration](./docs/assets/yujian-table.svg)

### ⑤ Code blocks & reading progress — jade details

Code blocks get **adaptive height** (no longer fill the parent) with an inset highlight like "a groove on jade"; global scrollbars are thin, rounded, translucent, brightening only one notch on hover; the editor's native scrollbar is hidden in favor of the **right-side jade reading progress bar**.

### ⑥ Left-edge activity bar & dual-column 2×2 dock — layout redesign

The early "shove new features into 'More', then split 'More' into overlays" crowding is redone as always-on and spread out: a jade activity bar on the left edge carries 7 view entries (4 vault-level + 3 document-level), the two columns each dock two panels and can show together; the four PKM panels (tags / content map / backlinks / snapshot) are embedded as jade dock blocks and are no longer mutually exclusive. The abandoned "rail view" overlay (unbound `v-if`, which broke panel switching) is replaced by a zero-source-change approach: `.dock-slot :deep(...)` neutralizes each panel into a jade block that fills its dock slot.

***

## 🧱 Tech stack

| Layer       | Choice                         | Notes                                          |
| ----------- | ------------------------------ | ---------------------------------------------- |
| Runtime     | Electron 44                    | official prebuilt binary, no C++ toolchain     |
| Build       | electron-vite 5 + vite \~7.3.6 | vite must stay < 8 (electron-vite peer limit)  |
| Frontend    | Vue 3.5 + TypeScript \~5.9.3   | `<script setup>` + composition API             |
| Editor core | @milkdown/crepe 7.22.1         | ProseMirror + remark, best Markdown round-trip |
| Source mode | CodeMirror 6                   | shares the same Markdown text with WYSIWYG     |
| Diagrams    | Mermaid 11 / KaTeX 0.18        | diagrams & math                                |
| Search      | Unified vault index (vaultIndex.ts) | lightweight metadata index, pure Node fs, no native compile |
| Watch       | chokidar 4                     | vault file watching (single watcher)           |
| State       | pinia 4                        | cross-component state (verified with Vue 3.5)  |

> Dependency choices are driven by local constraints: no MSVC / no WebView2, so Tauri is out; we also avoid anything needing node-gyp (better-sqlite3 / sharp / resvg), preferring pure JS or WASM.

***

## 🏗️ Architecture

Three processes, clear security boundary:

```
┌─────────────┐   contextBridge (allowlist)   ┌────────────────┐
│  main proc   │ ──────── safe IPC ────────▶ │   preload      │
│ (Node perms) │                              │  (window.api)  │
│ files/host/… │ ◀──────── events ───────────│               │
└─────────────┘                              └───────┬────────┘
                                                  │ bridged API
                                                  ▼
                                         ┌────────────────┐
                                         │  renderer proc  │
                                         │  Vue 3 sandbox  │
                                         │  EditorHost …  │
                                         └────────────────┘
```

* `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — the renderer gets no Node power.
* Image-host keys live only in the main process, encrypted with `safeStorage`, never in the renderer.
* Session state (`vaultPath` / `activePath` / `mode` / `sidebarWidth` / `startupMode`) is the `SessionState` type in `electron/shared/ipc-channels.ts`; the main `session.ts` writes atomically (temp file + rename).

Full module layout, data flow, fidelity strategy, and risk handling: **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)**.

***

## 🚀 Quick start

```bash
# install deps (.npmrc pins npmmirror mirrors)
npm install

# dev mode (HMR). scripts/dev.mjs strips IDE-injected ELECTRON_RUN_AS_NODE
npm run dev

# type check
npm run typecheck

# core-logic tests (index / auto link rewrite / wikilink round-trip / i18n parity / IPC contract)
npm test

# full gate: typecheck + lint + test
npm run check

# build to out/
npm run build

# package the current platform
npm run dist        # Windows: NSIS
npm run dist:mac    # macOS: dmg (build on macOS)
npm run dist:linux  # Linux: AppImage (build on Linux)
```

If the Electron binary fails to download, fetch it manually:

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

***

## ⚠️ Known environment gotchas

**1. `ELECTRON_RUN_AS_NODE` prevents the window from opening**

Some IDEs (WorkBuddy, VS Code) are themselves Electron apps and inject `ELECTRON_RUN_AS_NODE=1` into child shells, degrading `electron.exe` to plain Node:

* `process.type` becomes `undefined` (should be `browser`);
* `require('electron')` returns a **binary path string**, not the API object;
* the app throws no error but never creates a window.

`scripts/dev.mjs` deletes `process.env.ELECTRON_RUN_AS_NODE` before launch, so `npm run dev` works. To run manually:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

**2. `electron --version` prints the bundled Node version**

Electron 44 bundles Node 24.18.1 + Chrome 152; `--version` reports Node. The real Electron version is in `node_modules/electron/dist/version`.

**3. Electron binary download**

`.npmrc` pins npmmirror mirrors. Note `npm config set electron_mirror` is rejected on npm 10 (unregistered key) — write `.npmrc` directly.

**4. GPU-less sandbox exits immediately**

In a GPU-less sandbox the GPU process crashes repeatedly and triggers "GPU process isn't usable. Goodbye". Set `MD_EDITOR_COMPAT_MODE=1 npm run dev` for compat mode (adds `--no-sandbox`).

***

## 📐 Design docs

* **[`docs/preview/style-report-v1.html`](./docs/preview/style-report-v1.html)** — v1 style report (strictly from the real implementation; open in a browser; the figures in this README share the same source).
* **[`docs/UI-DESIGN.md`](./docs/UI-DESIGN.md)** — design tokens, component specs, material system (jade / glass), skin architecture.
* **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — architecture, module layout, fidelity strategy, roadmap, risks.

***

## 🗺️ Roadmap

| Phase            | Goal                                                                                                                                      | Status                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Foundation    | scaffold + window + IPC                                                                                                                   | ✅ done                                                                                                                                                                                                         |
| 1. Editor core   | Crepe + dual mode + open/save                                                                                                             | ✅ done                                                                                                                                                                                                         |
| 2. Vault         | file tree + auto-save + crash recovery                                                                                                    | ✅ done                                                                                                                                                                                                         |
| 3. Writing suite | Mermaid + math + tables + code                                                                                                            | ✅ done                                                                                                                                                                                                         |
| 4. Images        | paste-to-disk + image host                                                                                                                | ✅ done                                                                                                                                                                                                         |
| 5. Search        | Unified vault index + search panel                                                                                                           | ✅ done                                                                                                                                                                                                         |
| 6. Export        | HTML / PDF / single md                                                                                                                    | ✅ done                                                                                                                                                                                                         |
| 7. Polish        | themes/skins, shortcut hints, settings, title-bar redesign                                                                                | ✅ done (skins + preferences/appearance + icon toolbar + help/shortcuts + unified glass)                                                                                                                        |
| 8. Distribution  | electron-builder + **3-platform CI**                                                                                                      | ✅ done (v1.0.0; GitHub Actions builds Win/macOS/Linux installers)                                                                                                                                              |
| 9. Phase 2       | multi-doc tabs + find/replace + version snapshots + writing stats + Focus (typewriter/zen) mode + export enh. + writing aids + link check | ✅ all batches done — see [`docs/PHASE2-PLAN.md`](./docs/PHASE2-PLAN.md) |
| 10. Phase 3      | PKM (unified index · data safety · bi-links/backlinks · tags · content map MOC · relation graph) + command palette + dual-column 2×2 dock layout | ✅ done — shipped in v2.0.0, see [`docs/PHASE3-PLAN.md`](./docs/PHASE3-PLAN.md) |

**Beyond the roadmap**: bilingual i18n, switch working folder, startup preferences, five skins + dark/light/system, app icon (YuJian), independent panel toggle, jade scrollbars, adaptive code height, right-side reading progress, title-bar icon toolbar redesign, help & shortcut panel (F1), consistent left-rail block handles, unified glass (all overlays follow mode), long-token table wrapping, size trimming (asar + max compression + zh/en locales only).

**Phase 3 shipped in v2.0.0**: see [`docs/PHASE3-PLAN.md`](./docs/PHASE3-PLAN.md) — unified index layer · data safety · bi-links / backlinks · tags · content map MOC · relation graph · command palette · dual-column 2×2 dock layout.

***

## 📦 Installers

### Local build

* **Build**: `npm run dist` (then `electron-vite build` + `electron-builder --win`); publish to GitHub Release with `npm run release` (tag `v*` first).
* **Windows**: `release/yujian-<version>-setup.exe` (NSIS) — customizable dir, desktop + Start-menu shortcut "玉笺" by default.
* **Cross-platform**: macOS `dmg`, Linux `AppImage` targets configured; **must build on the target OS** (see below).
* **Size strategy**: `asar` + max compression + zh/en locales only; removed unused `@codemirror/theme-one-dark`.
* **Size note**: the package is dominated by the Electron runtime and the Mermaid engine; Mermaid is lazy-loaded (only on render) and works offline. Switch to CDN loading for further trimming.

### Automated 3-platform release (GitHub Actions)

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](./.github/workflows/release.yml): it creates a **draft release** on Ubuntu, then builds and uploads installers to that same release in parallel on **windows-latest / macos-latest / ubuntu-latest**.

| Platform | Artifact                     | Target            |
| -------- | ---------------------------- | ----------------- |
| Windows  | `yujian-{version}-setup.exe` | NSIS installer    |
| macOS    | `玉笺-{version}.dmg`           | DMG disk image    |
| Linux    | `yujian-{version}.AppImage`  | AppImage portable |

> **Code signing (optional)**: unsigned builds warn (Windows SmartScreen; macOS needs right-click "Open" + allow). Configure `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (Windows Authenticode) and `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (macOS sign + notarize) in **Settings → Secrets** and CI signs automatically. CI uses official mirrors by default (unaffected by the local `.npmrc` npmmirror).

Release flow:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
# → GitHub Actions builds the three-platform installers into a draft release
# → review on the GitHub Releases page, then click Publish
```

***

## 📄 License

[MIT](./LICENSE). The repository is currently public ([liu-li-huan-ying/yujian](https://github.com/liu-li-huan-ying/yujian)).
