# 玉笺 Markdown 编辑器 (YuJian)

> 所见即所得的跨平台桌面 Markdown 编辑器，可一键切换源码模式。
> 默认面向**技术写作**场景：代码高亮、Mermaid 图表、数学公式、表格与多格式导出。

[![Electron](https://img.shields.io/badge/Electron-44-47848f?logo=electron\&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3.5-42b883?logo=vue.js\&logoColor=white)](https://vuejs.org/)
[![Milkdown](https://img.shields.io/badge/Milkdown-Crepe%207.22-ff69b4)](https://milkdown.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)

**玉笺**（yù jiān，意为"玉制的信笺"）是一款本地优先的 Markdown 写作工具：文件夹即笔记库，文档是普通的 `.md` 文件，数据永远可读、可 Git、可迁移。编辑器内核基于 [Milkdown Crepe](https://milkdown.dev/)，Markdown 是一等公民，未编辑的文档保存时一字不改写回原文。

***

## ✨ 功能特性

### 编辑体验

* **双模式编辑** — 默认所见即所得（WYSIWYG），一键切到源码模式（`Ctrl + /`），两模式共享同一份 Markdown 文本，切换无内容丢失。
* **Markdown 往返保真** — 未编辑的文档保存时原样写回，不让格式化器污染你的 Git diff（详见 `docs/ARCHITECTURE.md` §5.2）。
* **技术写作套件** — 代码块语法高亮（`@codemirror/language-data` 全语言包）、**自适应内容高度**（短代码紧凑不浪费空间、长代码 `70vh` 上限 + 独立玉质滚动条）、Mermaid 图表渲染、KaTeX 数学公式、表格、任务列表。
* **统一玉质内容主题** — 编辑区所有原生元素（代码块面板、表格、引用块、行内代码、分隔线、列表标记、任务列表复选框、图片、浮层菜单）均套用玉质设计令牌，随五套皮肤与明暗模式自动联动，告别「组件原生、风格脱节」。
* **统一玻璃材质（所有浮层）** — 标题栏下拉、右键菜单、帮助 / 偏好 / 外观面板，以及编辑区内**所有** Crepe 浮层（slash 菜单、选取气泡工具条、链接预览 / 编辑浮层、块「+」菜单）**共用同一套玻璃配方**，且随明暗模式自动切换（暗色墨玉半透、亮色羊脂玉半透），全应用零差异、不再割裂。
* **表格长串自动换行** — 表格为 `table-layout: fixed`，加粗 / 强调等无空格长串原本会撑破单元格、与左右单元格叠字；现已在单元格内断行，长内容乖乖折返。
* **一致左轨块手柄** — 增加块 / 拖拽手柄原本会随块缩进与窗口宽度忽左忽右（Crepe 的 `flip` 中间件所致），现改为随「块自身左缘」定位（Notion 式、缩进块手柄随之右移、永不右翻），并左移 12px 落进固定沟槽，重做为玉质玻璃药丸，绝不再压到正文。
* **优雅空状态** — 未打开笔记库 / 文档无标题时，左右两栏呈现居中图标徽章 + 提示文案，并给出强调色「选择文件夹」按钮，与整体气质一致。
* **文档大纲** — 右侧面板实时提取标题层级，点击跳转到对应章节；滚动时自动高亮当前所在章节（节流 100ms）。
* **面板布局可定制** — 左侧笔记库与右侧大纲均可**独立显隐**：标题栏的「侧栏 / 大纲」图标开关（或快捷键 `Ctrl+\` / `Ctrl+Shift+\`）即可收起任一面板，状态持久化于 `session.json`；窗口过窄时自动软收起，加宽后恢复你的选择。
* **玉质滚动条** — 侧栏、大纲、编辑区、源码与弹窗统一使用纤细、圆角、半透明的滚动条，随五套皮肤与明暗模式联动，告别系统默认的粗重滚动条。

### 标题栏与帮助

* **图标工具栏（重设计）** — 标题栏按「文件 / 库 · 视图 / 布局 · 分享 / 工具」三段分组，统一使用 24×24 线性图标（玉质设计令牌驱动）。低频操作收进「导出 ⌄」「⋯ 更多」下拉菜单，彻底告别早期「每加一个功能就硬塞一个文字按钮」的拥挤布局。窗口控制（最小化 / 最大化 / 关闭）仅在 Windows 自绘，macOS 让位原生红绿灯。
* **帮助面板** — 标题栏「？」图标或 `F1` 打开，含「快捷键」与「使用指南」两个标签页：快捷键按文件 / 视图 / 通用分组并以 `kbd` 键位胶囊呈现；使用指南用 6 段图文带你快速上手（打开笔记库 → 新建写作 → 双栏联动 → 导出分享 → 图片图床 → 外观皮肤）。「更多 · 关于」也会打开同一面板并定位到指南页。

### 笔记库 (Vault)

* **文件夹即笔记库** — 打开任意文件夹作为工作目录，左侧文件树浏览其中所有 `.md`。
* **自动保存 + 崩溃恢复** — 编辑状态持久化到 `userData/session.json`，断电/崩溃重启后自动恢复上次笔记库与文档。
* **外部改动同步** — 基于 chokidar 单例监听，文档被别的程序修改/删除时实时反映到界面（不污染 Git diff 的纯内容变化会被智能忽略）。
* **切换工作文件夹** — 标题栏「文件夹」图标可在**不重启应用**的情况下切换到另一个目录；切换前自动保存当前文档，并清空活动状态，新库打开即空白。
* **全文搜索** — 基于 [MiniSearch](https://minisearch.search/) 的倒排索引，搜索结果点击直接定位到命中行（自动切源码模式以精确跳转）。

### 图片与图床

* **粘贴即落盘** — 截图/图片粘贴后自动存入文档同级 `.assets` 文件夹，引用一律相对路径，本地是唯一真源。
* **图床发布** — 支持 SM.MS 与自定义（兼容 PicGo）图床；密钥经主进程 `safeStorage` **加密保存，永不下发到渲染层**。可将文档中的本地图片批量替换为远程 URL（用于发布到公众号等平台）。

### 导出

* **导出 HTML** — 直取 ProseMirror DOM（所见即所得交付），自动内联数学公式与 Mermaid 渲染结果。
* **导出 PDF** — 通过 `webContents.printToPDF` 输出，与编辑器内观感一致。

### 外观与个性化

* **五套皮肤**（中国传统窑色系）— 青瓷（默认）、天青、月白、黛、琥珀。
* **三种明暗** — 深色 / 浅色 / 跟随系统（`prefers-color-scheme`）。
* **材质系统** — 框架层玉质、浮起层玻璃（`backdrop-filter`），内容层保持纯净实色以保证对比度与导出一致（详见 `docs/UI-DESIGN.md`）。
* **皮肤/明暗持久化** — 选择存入 `localStorage`，跨会话保留；切换皮肤不重建编辑器实例。

### 偏好设置

* **启动行为** — 标题栏「偏好设置」面板可选：
  * **恢复上次会话**（默认）— 重新打开上次使用的笔记库与文档；
  * **每次启动显示全新页面** — 不恢复任何上次状态，打开即从空笔记库开始。
  * 配置持久化于 `session.json`，于应用启动时读取。

### 国际化

* **中 / 英 双语** — 状态栏一键切换；Crepe 菜单标签随语言重建（Vue `:key` 重挂载），UI 文案响应式更新。

***

## 🧱 技术栈

| 层    | 选型                             | 说明                                       |
| ---- | ------------------------------ | ---------------------------------------- |
| 运行时  | Electron 44                    | 官方预编译二进制，不依赖任何 C++ 工具链                   |
| 构建   | electron-vite 5 + vite \~7.3.6 | vite 不可升 8（electron-vite 的 peer 限制）      |
| 前端   | Vue 3.5 + TypeScript \~5.9.3   | `<script setup>` + 组合式 API               |
| 编辑内核 | @milkdown/crepe 7.22.1         | 基于 ProseMirror + remark，Markdown 往返一致性最好 |
| 源码模式 | CodeMirror 6                   | 与 WYSIWYG 共享同一份 Markdown 文本              |
| 图表   | Mermaid 11 / KaTeX 0.18        | 图表与公式渲染                                  |
| 搜索   | MiniSearch 7                   | 纯 JS 倒排索引，零原生编译                          |
| 监听   | chokidar 4                     | 笔记库文件变化监听（单例 watcher，切换文件夹无泄漏）           |
| 状态   | pinia 4                        | 跨组件状态（已验证与 Vue 3.5 兼容）                   |

> 依赖选型受本机约束驱动：无 MSVC / 无 WebView2，Tauri 不可行，故选 Electron；同时避免一切需 node-gyp 编译的依赖（better-sqlite3 / sharp / resvg 等），优先纯 JS 或 WASM 实现。详见 `docs/ARCHITECTURE.md` §0。

***

## 🏗️ 架构概览

三进程模型，安全边界清晰：

```
┌─────────────┐   contextBridge (白名单)   ┌────────────────┐
│  main 进程   │ ──────── 安全 IPC ────────▶ │   preload      │
│ (Node 权限)  │                            │  (window.api)  │
│ 文件/图床/…  │ ◀──────── 事件回调 ─────────│               │
└─────────────┘                            └───────┬────────┘
                                                  │ 经桥暴露的 API
                                                  ▼
                                         ┌────────────────┐
                                         │  renderer 进程   │
                                         │  Vue 3 沙箱     │
                                         │  EditorHost 等  │
                                         └────────────────┘
```

* `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，渲染层拿不到 Node 能力。
* 图床密钥等敏感数据只存主进程，用 `safeStorage` 加密，绝不出现在渲染层。
* 会话状态（`vaultPath` / `activePath` / `mode` / `sidebarWidth` / `startupMode`）统一在 `electron/shared/ipc-channels.ts` 的 `SessionState` 类型，主进程 `session.ts` 原子写（`临时文件 + rename`）。

完整的模块划分、数据流向、保真策略与风险应对见 **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)**。

***

## 🚀 快速开始

```bash
# 安装依赖（已配置 npmmirror 镜像，见 .npmrc）
npm install

# 开发模式（热更新）。脚本会自动清除 IDE 注入的 ELECTRON_RUN_AS_NODE
npm run dev

# 类型检查
npm run typecheck

# 构建产物到 out/
npm run build

# 打包 Windows 安装包（NSIS）
npm run dist
```

首次运行若 Electron 二进制未下载成功，可手动补：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

***

## ⚠️ 已知环境坑

**1. `ELECTRON_RUN_AS_NODE` 导致窗口起不来**

部分 IDE（如 WorkBuddy、VS Code）本身是 Electron 应用，会向派生 shell 注入 `ELECTRON_RUN_AS_NODE=1`，使 `electron.exe` 退化成纯 Node：

* `process.type` 变成 `undefined`（正常应为 `browser`）；
* `require('electron')` 返回**二进制路径字符串**而非 API 对象；
* 应用不报错，但永远不创建窗口。

`scripts/dev.mjs` 已在启动前 `delete process.env.ELECTRON_RUN_AS_NODE`，`npm run dev` 可直接用。命令行手动运行时：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

**2. `electron --version` 打印的是内置 Node 版本**

Electron 44 内置 Node 24.18.1 + Chrome 152，`--version` 报的是 Node 版本。查真实 Electron 版本看 `node_modules/electron/dist/version` 文件。

**3. Electron 二进制下载**

`.npmrc` 已配置 npmmirror 镜像。注意 `npm config set electron_mirror` 在 npm 10 上会被拒绝（非已注册配置项），必须直接写 `.npmrc`。

**4. 受限环境无 GPU 导致直接退出**

无 GPU 的沙箱里 GPU 进程反复崩溃会触发 "GPU process isn't usable. Goodbye"。可设 `MD_EDITOR_COMPAT_MODE=1 npm run dev` 进入兼容模式（含 `--no-sandbox`）。

***

## 🎨 设计文档

* **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — 架构设计、模块划分、保真策略、9 阶段路线图与风险应对。
* **[`docs/UI-DESIGN.md`](./docs/UI-DESIGN.md)** — 设计令牌、组件规范、材质系统（玉质/玻璃）、皮肤架构。
* **[`docs/preview/theme-yujian.html`](./docs/preview/theme-yujian.html)** — 玉质主题效果预览（浏览器直接打开）。

***

## 🗺️ 开发路线图

| 阶段       | 目标                           | 状态                                                   |
| -------- | ---------------------------- | ---------------------------------------------------- |
| 0. 地基    | 脚手架 + 窗口 + IPC 打通            | ✅ 已完成                                                |
| 1. 编辑器核心 | Crepe 接入 + 双模式 + 打开/保存       | ✅ 已完成                                                |
| 2. 笔记库   | 文件树 + 自动保存 + 崩溃恢复            | ✅ 已完成                                                |
| 3. 写作套件  | Mermaid + 公式 + 表格 + 代码块      | ✅ 已完成                                                |
| 4. 图片    | 粘贴落盘 + 图床配置                  | ✅ 已完成                                                |
| 5. 搜索    | MiniSearch 索引 + 搜索面板         | ✅ 已完成                                                |
| 6. 导出    | HTML / PDF / 单 md            | ✅ 已完成                                                |
| 7. 打磨    | 主题/皮肤、体积裁剪、快捷键提示、设置面板、标题栏重设计 | ✅ 已完成（皮肤 + 偏好/外观面板 + 标题栏图标工具栏 + 帮助/快捷键面板 + 统一玻璃材质 + 体积裁剪） |
| 8. 分发    | electron-builder 打包          | ✅ 已完成（v1.0.0：NSIS 安装包，asar + 最大压缩 + 精简 locale；dmg/AppImage 跨平台目标已配置） |

**已实现路线图之外的增强**：中英双语 i18n、切换工作文件夹、启动偏好设置、五套皮肤 + 明暗/跟随系统、应用图标（玉笺）、独立面板显隐、玉质滚动条、代码块自适应高度、标题栏图标工具栏重设计、帮助与快捷键面板（F1）、块操作手柄一致左轨重做、统一玻璃材质（所有浮层随明暗切换）、表格长串自动换行、体积裁剪（asar 归档 + 最大压缩 + 仅保留中英 locale）。

***

## 📄 许可证

## 📦 安装包（v1.0.0）

* **构建命令**：`npm run dist`（先 `electron-vite build` 再 `electron-builder --win`）；发布到 GitHub Release 用 `npm run release`（需先打 `v*` tag）。
* **Windows**：产出 `release/yujian-1.0.0-setup.exe`（NSIS 安装包，约 140MB）——非一键安装、可自定义目录、默认创建桌面与开始菜单快捷方式「玉笺」。
* **体积策略**：`asar` 归档 + 最大压缩 + 仅保留中英 locale；移除未用依赖 `@codemirror/theme-one-dark`。
* **跨平台**：macOS `dmg`、Linux `AppImage` 目标已配置，需在对应平台构建。
* **体积说明**：安装包主要由 Electron 运行时与 Mermaid 图表引擎占据；Mermaid 为懒加载（仅渲染图表时载入）、离线可用。若需进一步瘦身，可改为 CDN 加载 Mermaid。

***

[MIT](./LICENSE)。本项目仓库当前为公开仓库（[liu-li-huan-ying/yujian](https://github.com/liu-li-huan-ying/yujian)）。
