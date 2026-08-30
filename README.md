# 玉笺 Markdown 编辑器 (YuJian)

> 所见即所得的跨平台桌面 Markdown 编辑器，可一键切换源码模式。
> 默认面向**技术写作**场景：代码高亮、Mermaid 图表、数学公式、表格与多格式导出。

[![Electron](https://img.shields.io/badge/Electron-44-47848f?logo=electron\&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3.5-42b883?logo=vue.js\&logoColor=white)](https://vuejs.org/)
[![Milkdown](https://img.shields.io/badge/Milkdown-Crepe%207.22-ff69b4)](https://milkdown.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#%E5%AE%89%E8%A3%85%E5%8C%85)
[![Docs](https://img.shields.io/badge/Docs-%E8%8B%B1%E6%96%87%E7%89%88-blue)](./README_EN.md)

> 🇬🇧 **English documentation**: [README\_EN.md](./README_EN.md) ｜ 📐 第一版样式报告：[docs/preview/style-report-v1.html](./docs/preview/style-report-v1.html)

**玉笺**（yù jiān，意为"玉制的信笺"）是一款本地优先的 Markdown 写作工具：文件夹即笔记库，文档是普通的 `.md` 文件，数据永远可读、可 Git、可迁移。编辑器内核基于 [Milkdown Crepe](https://milkdown.dev/)，Markdown 是一等公民，未编辑的文档保存时一字不改写回原文。

视觉上，玉笺以「玉质」为核心材质语言——框架层温润玉质、浮层玻璃透亮、内容层纯净实色，并提供五套中国传统窑色皮肤（青瓷 / 天青 / 月白 / 黛 / 琥珀）与深 / 浅 / 跟随系统三档明暗。

![1.00](./docs/assets/yujian-overview.svg)

***

## ✨ 功能特性

### 编辑体验

* **双模式编辑** — 默认所见即所得（WYSIWYG），一键切到源码模式（`Ctrl + /`），两模式共享同一份 Markdown 文本，切换无内容丢失。
* **Markdown 往返保真** — 未编辑的文档保存时原样写回，不让格式化器污染你的 Git diff。
* **技术写作套件** — 代码块语法高亮（`@codemirror/language-data` 全语言包）、**自适应内容高度**（短代码紧凑、长代码 `70vh` 上限 + 独立玉质滚动条）、Mermaid 图表渲染、KaTeX 数学公式、表格、任务列表。
* **统一玉质内容主题** — 编辑区所有原生元素（代码块面板、表格、引用块、行内代码、分隔线、列表标记、任务列表复选框、图片、浮层菜单）均套用玉质设计令牌，随五套皮肤与明暗模式自动联动。
* **统一玻璃材质（所有浮层）** — 标题栏下拉、右键菜单、帮助 / 偏好 / 外观面板，以及编辑区内**所有** Crepe 浮层（slash 菜单、选取气泡工具条、链接预览 / 编辑浮层、块「+」菜单）**共用同一套玻璃配方**，且随明暗模式自动切换（暗色墨玉半透、亮色羊脂玉半透），全应用零差异。
* **表格长串自动换行** — 表格为 `table-layout: fixed`，加粗 / 强调等无空格长串会在单元格内断行，不再撑破或与邻格叠字。
* **一致左轨块手柄** — 增加块 / 拖拽手柄改为随「块自身左缘」定位（Notion 式、缩进块手柄随之右移、永不右翻），并左移 12px 落进固定沟槽，重做为玉质玻璃药丸，绝不再压到正文。
* **优雅空状态** — 未打开笔记库 / 文档无标题时，左右两栏呈现居中图标徽章 + 提示文案，与整体气质一致。
* **文档大纲** — 右侧面板实时提取标题层级，点击跳转；滚动时自动高亮当前章节（节流 100ms）。
* **面板布局可定制** — 左侧笔记库与右侧大纲均可**独立显隐**（标题栏图标或 `Ctrl+\` / `Ctrl+Shift+\`），状态持久化；窗口过窄时自动软收起。
* **玉质滚动条** — 侧栏、大纲、编辑区、源码与弹窗统一使用纤细、圆角、半透明的滚动条，随皮肤与明暗联动。
* **右侧阅读进度条** — 编辑区原生滚动条隐藏，改由右侧玉质进度条统一指示（青瓷渐变 + 柔光，悬停 / 拖拽才浮现圆头手柄，可点击跳转）。

### 标题栏与帮助

* **图标工具栏（重设计）** — 标题栏按「文件 / 库 · 视图 / 布局 · 分享 / 工具」三段分组，统一使用 24×24 线性图标（玉质令牌驱动）。低频操作收进「导出 ⌄」「⋯ 更多」下拉，彻底告别早期「每加功能就硬塞文字按钮」的拥挤布局。窗口控件仅在 Windows 自绘，macOS 让位原生红绿灯。
* **帮助面板** — 标题栏「？」或 `F1` 打开，含「快捷键」与「使用指南」双标签页：快捷键按文件 / 视图 / 通用分组并以 `kbd` 键位胶囊呈现；使用指南用 6 段图文带你快速上手。

### 笔记库 (Vault)

* **文件夹即笔记库** — 打开任意文件夹作为工作目录，左侧文件树浏览其中所有 `.md`。
* **自动保存 + 崩溃恢复** — 编辑状态持久化到 `userData/session.json`，重启后自动恢复上次笔记库与文档。
* **外部改动同步** — 基于 chokidar 单例监听，文档被别的程序修改 / 删除时实时反映到界面。
* **切换工作文件夹** — 标题栏「文件夹」图标可**不重启应用**切换到另一目录；切换前自动保存当前文档。
* **全文搜索** — 基于 [MiniSearch](https://minisearch.search/) 倒排索引，搜索结果点击直接定位到命中行（自动切源码模式精确跳转）；命中后可在左侧搜索框展开「全局替换」，仅在命中文件范围内批量替换（不触碰图片/资源，只处理 Markdown 源文本）。

### 多文档与查找

* **多文档标签** — 单窗口内多标签编辑，**单编辑器实例换内容**（严守 Milkdown 单实例红线，绝不每标签建实例）。标签条为玉质材质，激活态青瓷底 + 底部强调线、未保存点；**占满式布局**（默认卡片宽度估算可见数 → 可见标签 `flex` 均匀占满、永远不留空位，窗口缩放时可见数自动增减）；**以当前标签为中心的滑动窗口**，几十到上百个标签时当前文档始终可见，其余收进「更多」下拉（菜单可滚动并高亮当前项）；左右两侧渐隐提示边 + 到头回弹反馈；折叠时显示「当前 / 总数」静音徽标，滚轮在标签条上即可横向翻页（画廊式浏览大量标签，**带阻尼 / 惯性，不会一下飞太远**）；右键支持关闭 / 关闭其他 / 关闭右侧；打开的标签集合与会话一起持久化（`openTabs`）。
* **文件内查找 / 替换** — 标题栏放大镜图标或 `Ctrl+F` 唤起玻璃浮层，所见即所得（ProseMirror 选区高亮当前命中）与源码（CodeMirror 装饰高亮）双模式统一分派；支持区分大小写 / 全词匹配、命中计数 `current/total`、逐个跳转与全部替换；**零新增依赖**（自研轻量实现）。
* **选区字数** — 状态栏实时显示当前选区字符数（中英混排同计）。

### 版本快照与写作辅助

* **版本快照** — vault 内 `.yujian-history/` 自动留档（独立于 `.mdeditor/` 缓存，建议进库 `.gitignore`）；标题栏「历史 `history`」图标唤起玻璃面板，可手动留档并加**备注**（如"发布前"）；列表按时间排序并显示字数差，选中任一份即以 `diff@7` 做**行级 diff 预览**（新增 / 删除 / 上下文三色），回滚 = 把快照内容载入编辑器并标脏、**不立即覆盖磁盘原文**（严守 Markdown 往返保真）。**（注：快照功能已实现但尚未完成运行期验收，面板顶部有「⚠ 实现但未测试」标注，当前建议仅查看、谨慎执行恢复/删除。）**
* **写作统计** — 状态栏实时显示「汉字数 · 英文词数 · 估算阅读时长」（中文单位用汉字：字 / 词 / 分），点击唤起玻璃弹层查看汉字 / 词 / 字符（含 / 不含空白）/ 阅读时长细分 + 当前**选区统计** + SVG 进度环展示**写作目标**完成度（目标随会话持久化）。
* **凝神模式 2.0「雾与纸」** — 标题栏「月亮 `moon`」一键进入：四幕进场（两侧退入雾中 → 框架收幕 → 纸卷微收 720→640 → 雾起锚定，\~360ms），当前文本块青瓷微光、其余文本块按**文本块距五档雾化衰减**（前快后缓）——列表项 / 引用 / 表格单元格内的嵌套文本块也逐块淡出，长列表不再「整棵全亮」，容器结构（表格网格 / 引用竖线 / 列表圆点）保留满透明度；光标行由「纸卷」缓动钉在锚点（粘贴大段匀速补偿、缓出刹住）。凝神中 `Esc` **轻退**——掀起 32px 玻璃信息栏（文件名 · 字数 · 保存时间 · 切换文档 · 退出），再按收起。设置面板可调锚点位置（偏上 1/3 / 黄金分割 / 正中）、雾化衰减（快中慢）、滚动平滑度、自动全屏，改即生效随会话持久化；全部动效尊重系统「减弱动效」偏好。
* **写作辅助** — 标题栏「更多 ⌄ · 写作辅助」唤起玻璃面板，两个标签页：**属性**用项目已依赖的 `gray-matter` 解析文档 frontmatter（标题 / 作者 / 标签 / 日期 / 描述），编辑即改写顶部 YAML 块、正文逐字保留（严守 Markdown 往返保真），未知字段自动透传；**片段**内置文档模板 / 代码块 / 表格 / 提示框 / 任务列表 / 脚注 / 流程图 / 公式块等常用结构，点击即在光标处插入（所见即所得与源码双模式通用）。
* **链接健康检查** — 标题栏「更多 ⌄ · 链接健康检查」一键扫描整个 vault：识别失效的 `[[wikilink]]`（按基名 / 相对路径解析）、相对路径 Markdown 链接与图片引用（解析后判定目标文件是否存在），玻璃面板按 Wiki / 链接 / 图片三色分类列出断链（源文件 · 行号 · 目标），点击即在编辑器中定位该文档；外部链接（http(s) / mailto / 协议相对 / `www.` 域名）与纯锚点自动跳过。纯解析、零依赖，并为 Phase 3 双链埋下解析能力。

### 图片与图床

* **粘贴即落盘** — 截图 / 图片粘贴后自动存入文档同级 `.assets` 文件夹，引用一律相对路径，本地是唯一真源。
* **图床发布** — 支持 SM.MS 与自定义（兼容 PicGo）图床；密钥经主进程 `safeStorage` **加密保存，永不下发渲染层**。可将文档中的本地图片批量替换为远程 URL（用于发布到公众号等平台）。

### 导出

* **导出 HTML** — 直取 ProseMirror DOM（所见即所得交付），自动内联数学公式与 Mermaid 渲染结果。
* **导出 PDF** — 通过 `webContents.printToPDF` 输出，与编辑器内观感一致。

### 外观与个性化

* **五套皮肤**（中国传统窑色系）— 青瓷（默认）、天青、月白、黛、琥珀，每套含深 / 浅两档。
* **三种明暗** — 深色 / 浅色 / 跟随系统（`prefers-color-scheme`）。
* **材质系统** — 框架层玉质、浮起层玻璃（`backdrop-filter`）、内容层保持纯净实色以保证对比度与导出一致。
* **皮肤 / 明暗持久化** — 选择存入 `localStorage`，跨会话保留；切换皮肤不重建编辑器实例。

### 偏好设置

* **启动行为** — 可选「恢复上次会话」（默认）或「每次启动显示全新页面」；配置持久化于 `session.json`。

### 国际化

* **中 / 英 双语** — 状态栏一键切换；Crepe 菜单标签随语言重建（Vue `:key` 重挂载），UI 文案响应式更新。

***

## 🎨 设计哲学 · 三层材质分层

玉的关键不是绿，而是**温润**：光进入后被散射开，颜色不均匀、边缘略亮、内部有絮状层次。玉笺把界面拆成三层，各用一种材质，互不污染：

![1.00](./docs/assets/yujian-material.svg)

1. **框架层（标题栏 / 侧边栏 / 大纲 / 状态栏）= 玉质，静态预渲染。** 渐变 + 极细噪点（`feTurbulence`，opacity .045）一次渲染成型，**零运行时开销**，模拟真实玉石的散射透光，是品牌识别核心。
2. **浮起层（所有菜单 / 命令面板 / 对话框）= 玻璃。** 仅在小面积浮层使用实时 `backdrop-filter: blur(28px) saturate(160~180%)`——玻璃需"背后有东西可透"才有意义，也才值得付性能代价。
3. **内容层（编辑区）= 纯净实色，绝对不加纹理。** 原因有三：长阅读疲劳、降对比度可能跌破 WCAG AA、以及**破坏"直取 DOM 导出"的所见即所得一致性**。

> 选"玉"而非纯玻璃，是因为窗口级材质跨平台不一致（macOS `vibrancy`、Win11 `mica` 可透桌面，Win10 及以下会降级为实色），而玉质降级后依然成立。

***

## 🎨 五套皮肤 · 中国传统窑色系

设置面板（外观）里以真实玉质材质缩略图呈现，选中环用外层描边避免覆盖材质；每套皮肤都有**深 / 浅**两档，外加"跟随系统"。切换皮肤**不重建编辑器实例**（Crepe 只读 CSS 变量），根节点挂 `data-skin` / `data-mode`，选择持久化到 `localStorage`。默认：青瓷 + 深色。

![1.00](./docs/assets/yujian-skins.svg)

| 皮肤      | 中文名 | 深档强调色     | 浅档强调色     | 气质                |
| ------- | --- | --------- | --------- | ----------------- |
| Celadon | 青瓷  | `#5FA8A0` | `#248077` | 汝窑青灰，最沉稳的"玉"味（默认） |
| Sky     | 天青  | `#5E9DBE` | `#2B7BA8` | 雨过天青，偏蓝冷调         |
| Moon    | 月白  | `#93A7B4` | `#5A7180` | 月白釉，极淡蓝白、低饱和      |
| Dai     | 黛   | `#8B7CB8` | `#6A5A9E` | 墨青紫，唯一冷紫调         |
| Amber   | 琥珀  | `#C79A4E` | `#9A6F24` | 老蜜蜡，唯一暖调          |

**结构层 / 材质层与色相层解耦**——换皮肤只改 `--hue-*` 色相变量，整套界面"换色不换骨"；字号、栅格、圆角、动效令牌永不随皮肤改变。

***

## 🪟 玻璃统一 · 所有浮层同一套材质

第一版把此前"导出下拉、更多下拉、关于面板各自一套玻璃"的割裂彻底收敛：`.glass` 改为**明暗双版的单一事实来源**，并统一覆盖到标题栏下拉（导出 / 更多）、右键菜单、帮助 / 偏好 / 外观面板，以及编辑区内 Crepe 的 slash 菜单、选取气泡工具条、链接预览 / 编辑浮层。点外部或 `Esc` 关闭。

![1.00](./docs/assets/yujian-glass.svg)

***

## 🔧 功能细节打磨

### ① 顶部栏重设计 —— 分组图标工具栏

不再"加功能就硬塞文字按钮"。改为**三组语义图标**：文件 / 库（新建 · 切换库 · 打开）｜视图 / 布局（所见即所得⇄源码分段 · 侧栏 · 大纲）｜分享 / 工具（导出⌄ · 外观 · 更多⌄ · 帮助?）。分隔线表达分组边界；图标按钮 28×28 满足触控目标；激活态用强调色 + 玉质高亮底呼应分段控件的"开"。整条标题栏可拖拽（`-webkit-app-region: drag`），自绘窗口按钮仅 Windows 渲染（macOS 用原生红绿灯并让位 78px）。

### ② F1 帮助面板 —— 快捷键 + 使用指南双页

按 `F1` 直接唤起（已修复此前被按键守卫拦截的问题）。玻璃浮层内分「快捷键 / 使用指南」两标签页，支持 ↑↓ 选择、Enter 执行、Esc 关闭；键位写死、描述本地化，中英双语。

### ③ 块操作手柄 —— Notion 式一致左轨，绝不压字

保留 Crepe floating-ui 算出的**块自身左缘**，仅用 `translateX(-12px)` 向左挪出与正文的呼吸缝；缩进块（如列表）的手柄随之右移，始终在块左缘左侧、永不遮字。编辑区左侧预留 `96px` 沟槽（约 64px 手柄 + 12px 位移 + 20px 余量），最窄窗口也不被裁切。

![1.00](./docs/assets/yujian-handle.svg)

### ④ 表格长串换行 —— 修掉叠字

表格为 `table-layout: fixed`，此前加粗 / 强调等无空格长串会撑破单元格、与邻格叠字。已加 `overflow-wrap: anywhere; word-break: break-word; white-space: normal`，任何长串都在单元格内断行。表头用强调色填充、偶行浅底、发丝边单向网格、四角圆角。

![1.00](./docs/assets/yujian-table.svg)

### ⑤ 代码块 & 阅读进度条 —— 玉质细节

代码块改为**自适应内容高度**（不再撑满父容器），面板加内陷高光像"玉上一道凹槽"；全局滚动条细、圆角、半透明、hover 仅微亮一档；编辑区原生滚动条隐藏，改由**右侧玉质阅读进度条**统一指示。

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
| 监听   | chokidar 4                     | 笔记库文件变化监听（单例 watcher）                    |
| 状态   | pinia 4                        | 跨组件状态（已验证与 Vue 3.5 兼容）                   |

> 依赖选型受本机约束驱动：无 MSVC / 无 WebView2，Tauri 不可行，故选 Electron；同时避免一切需 node-gyp 编译的依赖（better-sqlite3 / sharp / resvg 等），优先纯 JS 或 WASM 实现。

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
* 会话状态（`vaultPath` / `activePath` / `mode` / `sidebarWidth` / `startupMode`）统一在 `electron/shared/ipc-channels.ts` 的 `SessionState` 类型，主进程 `session.ts` 原子写（临时文件 + rename）。

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

# 本地打包当前平台安装包
npm run dist        # Windows: NSIS
npm run dist:mac    # macOS: dmg（需在 macOS 上构建）
npm run dist:linux  # Linux: AppImage（需在 Linux 上构建）
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

## 📐 设计文档

* **[`docs/preview/style-report-v1.html`](./docs/preview/style-report-v1.html)** — 第一版样式报告（严格基于真实实现，浏览器直接打开；本 README 配图同源）。
* **[`docs/UI-DESIGN.md`](./docs/UI-DESIGN.md)** — 设计令牌、组件规范、材质系统（玉质 / 玻璃）、皮肤架构。
* **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — 架构设计、模块划分、保真策略、路线图与风险应对。

***

## 🗺️ 开发路线图

| 阶段         | 目标                                              | 状态                                                                                                            |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0. 地基      | 脚手架 + 窗口 + IPC 打通                               | ✅ 已完成                                                                                                         |
| 1. 编辑器核心   | Crepe 接入 + 双模式 + 打开 / 保存                        | ✅ 已完成                                                                                                         |
| 2. 笔记库     | 文件树 + 自动保存 + 崩溃恢复                               | ✅ 已完成                                                                                                         |
| 3. 写作套件    | Mermaid + 公式 + 表格 + 代码块                         | ✅ 已完成                                                                                                         |
| 4. 图片      | 粘贴落盘 + 图床配置                                     | ✅ 已完成                                                                                                         |
| 5. 搜索      | MiniSearch 索引 + 搜索面板                            | ✅ 已完成                                                                                                         |
| 6. 导出      | HTML / PDF / 单 md                               | ✅ 已完成                                                                                                         |
| 7. 打磨      | 主题 / 皮肤、快捷键提示、设置面板、标题栏重设计                       | ✅ 已完成（皮肤 + 偏好 / 外观面板 + 图标工具栏 + 帮助 / 快捷键面板 + 统一玻璃材质）                                                           |
| 8. 分发      | electron-builder 打包 + **三平台 CI**                | ✅ 已完成（v1.0.0；GitHub Actions 自动构建 Win/macOS/Linux 安装包）                                                         |
| 9. Phase 2 | 多文档标签+查找替换+版本快照+写作统计+凝神(打字机/禅)模式+导出增强+写作辅助+断链检查 | 🔧 批次一已完成（多文档标签·文件内查找替换·选区字数）；批次二已完成（版本快照·写作统计·凝神模式）；批次三进行中（**链接健康检查·写作辅助已落地**，导出增强待排期，见 [`docs/PHASE2-PLAN.md`](./docs/PHASE2-PLAN.md)） |

**已实现路线图之外的增强**：中英双语 i18n、切换工作文件夹、启动偏好设置、五套皮肤 + 明暗 / 跟随系统、应用图标（玉笺）、独立面板显隐、玉质滚动条、代码块自适应高度、右侧阅读进度条、标题栏图标工具栏重设计、帮助与快捷键面板（F1）、块操作手柄一致左轨重做、统一玻璃材质（所有浮层随明暗切换）、表格长串自动换行、体积裁剪（asar 归档 + 最大压缩 + 仅保留中英 locale）。

**Phase 2 计划**：见 [`docs/PHASE2-PLAN.md`](./docs/PHASE2-PLAN.md)（多文档标签 / 查找替换 / 版本快照 / 写作统计 / 凝神·打字机·禅模式 / 导出增强 docx·ePub·LaTeX·PDF / 写作辅助包 / 断链健康检查）。**批次一与批次二已落地**；**批次三进行中——链接健康检查·写作辅助已落地**，导出增强（docx·ePub·LaTeX·PDF）待排期。

***

## 📦 安装包

### 本地构建（v1.0.0）

* **构建命令**：`npm run dist`（先 `electron-vite build` 再 `electron-builder --win`）；发布到 GitHub Release 用 `npm run release`（需先打 `v*` tag）。
* **Windows**：产出 `release/yujian-1.0.0-setup.exe`（NSIS 安装包，约 140MB）——可自定义目录、默认创建桌面与开始菜单快捷方式「玉笺」。
* **跨平台**：macOS `dmg`、Linux `AppImage` 目标已配置；**需在对应平台构建**（见下）。
* **体积策略**：`asar` 归档 + 最大压缩 + 仅保留中英 locale；移除未用依赖 `@codemirror/theme-one-dark`。
* **体积说明**：安装包主要由 Electron 运行时与 Mermaid 图表引擎占据；Mermaid 为懒加载（仅渲染图表时载入）、离线可用。若需进一步瘦身，可改为 CDN 加载 Mermaid。

### 自动化三平台发布（GitHub Actions）

推送 `v*` 标签即触发 [`.github/workflows/release.yml`](./.github/workflows/release.yml)：先在 Ubuntu 上创建 **draft release**，再于 **windows-latest / macos-latest / ubuntu-latest** 三个 runner 上并行构建并上传安装包到同一 release。

| 平台      | 产物                           | 目标           |
| ------- | ---------------------------- | ------------ |
| Windows | `yujian-{version}-setup.exe` | NSIS 安装包     |
| macOS   | `玉笺-{version}.dmg`           | DMG 磁盘镜像     |
| Linux   | `yujian-{version}.AppImage`  | AppImage 便携包 |

> **代码签名（可选）**：未配置证书时产物为未签名（Windows 会弹 SmartScreen 警告、macOS 需右键「打开」并授权）。在仓库 **Settings → Secrets** 中配置 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（Windows Authenticode）与 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`（macOS 签名 + 公证）后，CI 会自动签名。CI 默认使用官方镜像源（不受本地 `.npmrc` 的 npmmirror 影响）。

发布流程：

```bash
# 本地打标签
git tag v1.0.0
git push origin v1.0.0
# → GitHub Actions 自动构建三平台安装包并归入 draft release
# → 在 GitHub Releases 页面检查无误后点 Publish 发布
```

***

## 📄 许可证

[MIT](./LICENSE)。本项目仓库当前为公开仓库（[liu-li-huan-ying/yujian](https://github.com/liu-li-huan-ying/yujian)）。
