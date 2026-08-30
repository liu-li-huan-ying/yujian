# 玉笺 Phase 2 开发计划

> 状态：**批次一（多文档标签 + 文件内查找替换 + 选区字数）+ 批次二（版本快照 + 写作统计 + 凝神模式）已落地**；批次三（导出增强·写作辅助·断链检查）待排期。
> 基线：v1.0.0 已发布，阶段 0–8 全部完成，三平台 CI 已打通。
> 定位：技术写作型 Markdown 编辑器。Phase 2 聚焦「写作生产力 + 出版分发」，并补精细化打磨。

***

## 0. 不可违背的约束（沿用 v1 红线）

1. **Markdown 往返保真**：未编辑的文档保存时必须一字不改写回原文；查找/替换/快照/导出均不得污染用户原文。
2. **Milkdown 单实例**：全项目只用 `@milkdown/crepe` 单包，不混装低版本插件；多标签**不每标签建实例**，用单 EditorHost 换内容规避多实例上下文错误。
3. **禁 node-gyp / 编译型依赖**：不引入 better-sqlite3 / sharp / resvg 等；导出库一律选纯 JS / WASM 实现（不打包 pandoc 二进制）。
4. **本地唯一真源**：图床只是镜像；历史/快照属用户价值，与 `.mdeditor/`（可删缓存）分离。
5. **体积可控**：新增依赖评估对 asar 体积影响；优先小体积纯 JS 库。

***

## 1. 已确认范围（问答锁定 + 精细化补充）

| 块           | 是否纳入  | 备注                                           |
| ----------- | ----- | -------------------------------------------- |
| 多文档标签       | ✅     | 单窗口内标签页；右键菜单/过多折叠/按标签恢复滚动                    |
| 全局/文件内查找替换  | ✅     | 复用 MiniSearch；匹配计数/循环/选区范围/全局上下文片段+键盘导航+范围筛选 |
| 版本快照        | ✅     | 自动（保存+定时）+ 手动；行级 diff 预览 + 命名备注              |
| 写作统计        | ✅     | 汉字/英文/字符/阅读时长；选中统计；写作目标追踪                    |
| 打字机 / 禅模式   | ✅     | 融合为「凝神」模式：当前行垂直居中 + 当前块高亮、其余块淡化 + 失焦暂停（零依赖）  |
| 导出增强：docx   | ✅     | 手写 OOXML + jszip，纯 JS                      |
| 导出增强：ePub   | ✅     | jszip 手写 OPF (EPUB3)                            |
| 导出增强：RTF    | ✅     | 手写 RTF 1.9（无依赖）                              |
| 导出增强：ODT    | ✅     | jszip 手写 ODF 1.2                               |
| 导出增强：LaTeX  | ✅     | 模板生成 .tex                                    |
| 导出增强：PDF 增强 | ✅     | 目录/分页/封面                                     |
| 导出精细化       | ✅     | 多文件合订 + 导出前预览 + 图片内联策略 + Mermaid 转静态图        |
| 写作辅助包       | ✅     | 片段/模板 + 文档属性面板（frontmatter 表单）               |
| 链接健康检查      | ✅     | vault 断链扫描（衔接 Phase 3 双链）                    |
| AI 辅助写作     | ❌ 暂不做 | 用户无可用 API；Crepe AI 接口保留                      |

***

## 2. 分批交付

### 批次一：多文档标签 + 查找替换（最高频、零外部依赖）

含：标签精细体验、查找做精（计数/循环/选区/全局上下文+导航+筛选）、拖放打开文件/图片。

### 批次二：版本快照 + 写作统计 + 打字机/专注（写作安全与沉浸，中等工作量）

含：快照行级 diff + 命名备注、统计细分 + 写作目标追踪、打字机配套专注/禅模式。

### 批次三：导出增强 + 写作辅助 + 链接检查（依赖纯 JS 格式库，工作量最大，放最后）

含：docx/ePub/LaTeX/PDF 增强、多文件合订/预览/Mermaid 转图、片段模板/属性面板、断链健康检查。

***

## 3. 技术方案要点

### 3.1 多文档标签

* 新增 Pinia store `src/store/tabs.ts`：
  * `openTabs: { id, path|null, title, dirty, markdown, scrollTop, caret? }[]`
  * `activeId`；方法 `open(path)` / `openBlank()` / `close(id)` / `activate(id)` / `markDirty(id)`。
* **单 EditorHost 实例换内容**（守红线 2）：切 tab 时先 `captureScroll()` + 把当前 tab 的 `fidelity.currentText` 写回该 tab，再 `setMarkdown(next.markdown)`，`onReady` 后经 `rAF` `restoreScroll()`（复用 v1 滚动保持）。
* 标题栏新增**玉质 tab 条**：复用 `.jade` / `.glass` 设计令牌；未保存态用 accent 小圆点；双击标签重命名（仅显示名）。
* **标签精细**：右键菜单「关闭 / 关闭其他 / 关闭右侧 / 关闭全部」；标签超宽时折叠为「▾更多」下拉；恢复会话时按标签记滚动/光标。
* 新建：标题栏「＋ 新建」→ 空白 tab（`path=null`，首存走 save-as）。
* **拖放**：从资源管理器拖 `.md` 文件进窗口即打开；拖图片进编辑器走现有粘贴落盘逻辑（粘贴已有，拖放补齐）。
* 范围约束：v2 限定**同 vault 内**多标签；切换工作文件夹时提示保存并关闭其他库标签。

### 3.2 查找替换（做精）

* **文件内**：基于 ProseMirror decoration 实现轻量搜索高亮 + 上下跳转（经 `@milkdown/kit` 接入 search plugin，非破坏性 decoration，守红线 1）；支持「区分大小写 / 全词 / 正则」三开关；替换走受控事务。
* **精细项**：匹配计数（如 3/12）、到末尾循环回顶、选区范围内查找、替换全部 / 替换并查找下一个。
* **全局跨库**：复用阶段 5 MiniSearch 索引，结果面板展示「标题 + 上下文片段 + 行号」；**键盘上下导航**；可按「当前文件夹 / 全部 vault」筛选；点击定位并高亮该笔记；搜索命中后可在左侧 `Sidebar.vue` 搜索框展开玉质「全局替换」区块（新增 `vault:replace` 通道），仅在命中文件范围内做字面量替换并写回磁盘（详见 §3.8）。
* **选中统计**：选区变化时实时显示选区字数（喂给批次二统计）。
* 入口：标题栏「更多 ⌄」下挂「查找」（Ctrl/Cmd+F 文件内；加 Shift 开全局），玻璃浮层。

### 3.3 版本快照 + 写作统计

* **存储**：main 进程在 vault 根建 `.yujian-history/<path-hash>/<ISO8601>.md`（独立于 `.mdeditor/`）；建议写入 vault `.gitignore`；导出/图床逻辑忽略此目录。
* **策略（自动+手动）**：每次保存（防抖 800ms）写一份；定时每 10 分钟（仅当有改动）写一份；标题栏「保存快照」按钮即时留档，可填**备注**（如"发布前"）。
* **差异查看**：历史面板用 `diff@^7.0.0`（纯 JS，`diffLines` 行级 diff）做行级 diff 预览，回滚前先看差异；回滚 = 把快照内容载入编辑器并标 dirty，**不立即覆盖磁盘**（守红线 1）。
  > 选型修正：原计划写 `jsdiff`，但 `jsdiff@1.1.1` 实为「JSON 对象 diff」库（装配错误）；正确行级 diff 库是 `diff@^7.0.0`（`diffLines` 可用），已在 `package.json` 落地，`jsdiff` 已卸载。
* **保留策略**：默认每文档最多 50 份或 30 天（偏好可配）；清理走回收站，不用 `rm`。
* **写作统计**：状态栏实时显示——汉字数 / 英文单词数 / 字符数（含/不含空白）/ 估算阅读时长（中文 \~300 字/分）；**选中文本统计**（与 3.2 联动）；**写作目标追踪**：偏好设每篇/每日目标，状态栏进度环展示完成度；状态栏单位随语言切换（`unitHan='字'/'chars'`、`unitWord='词'/'words'`、`unitMin='′'/'min'`），与统计弹层 `unitMin` 一致（详见 §3.8）。

### 3.4 导出增强（做精）

> **进度（2026-08-30）**：**导出格式全集已落地（9 种）** —— Markdown / 纯文本 / HTML / PDF / LaTeX / Word(docx) / EPUB / RTF / ODT，全部纯 JS / WASM 实现，**不依赖 pandoc 等外部二进制**。其中 docx / epub / rtf / odt 为二进制格式：在渲染进程序列化为字节，经 IPC 以 base64 传给主进程精确写盘（`ExportPayload.binaryBase64`）。HTML / PDF / LaTeX 增强、导出范围（整篇 / 选中）、图片内联策略、Mermaid 转内嵌 SVG、通用写盘 IPC 均已就绪。

* **docx**：✅ **已实现（2026-08-30，2026-08-30 晚修正）**。初版用 `html-to-docx@1.8.0`，但其在**模块顶层** `import crypto/fs/path/zlib/stream/http/url/https/events/util` 一整条 Node 内置模块，Vite 打包时 externalize 成浏览器空壳，渲染进程启动即崩 → **整窗漆黑、什么都不渲染**（Node 里烟雾测试能过是因为 Node 自带这些模块，浏览器没有）。**已弃用该包**，改用 `jszip` **手写 OOXML**（`src/export/docx.ts`）：手工拼装 `word/document.xml` / `styles.xml`（Normal + Heading1–6 + Quote + Code）/ `numbering.xml`（多级有序·无序列表）/ `_rels` / `[Content_Types].xml` / `docProps`，标题/段落/粗斜体/下划线/链接/有序无序列表（含嵌套）/引用/代码块/表格/图片（PNG 经 canvas 光栅化嵌入）/超链接齐全。取规范化 HTML 的 `<article>` 内层 → Mermaid `<svg>` 光栅化为 PNG → 拼装 DOCX 包。*已知边界*：LaTeX 公式转 OMML 或静态图、脚注转尾注尚未做，公式以图片/占位呈现。
* **ePub**：✅ **已实现（2026-08-30）**。`src/export/epub.ts` 用 **`jszip@3.10.1`** 手写 EPUB3：`mimetype` 须 STORE 且为首个条目；含 `META-INF/container.xml`、`OEBPS/content.opf`（含 nav properties）、`nav.xhtml`（按标题层级缩进的目录）、`style.css`、`section-001.xhtml`（内联 SVG 保留 Mermaid 图表）、内联图片（`data:` → `OEBPS/images/`）。
* **RTF**：✅ **已实现（2026-08-30）**。`src/export/rtf.ts` **零依赖**手工生成 RTF 1.9：`\ansicpg936` + `\lang2052` 支持中文；覆盖标题 / 段落 / 粗斜体 / 下划线 / 链接（HYPERLINK field）/ 列表 / 引用 / 代码 / 图片（`\pngblip` 十六进制）/ 表格（降级为制表符分隔）。Mermaid `<svg>` 先光栅化为 PNG 再嵌入。非 ASCII 走 `\u` 带符号 16 位转义（≥ U+8000 的码点转负值、辅助平面拆代理对），保证严格 RTF 解析器可读。
* **ODT**：✅ **已实现（2026-08-30）**。`src/export/odt.ts` 用 **`jszip@3.10.1`** 手写 OpenDocument 1.2：含 `content.xml` / `styles.xml`（内嵌 `STYLES_XML`，Heading1–6 / Quote / code / bold / italic / underline / mono）/ `meta.xml` / `manifest.xml` / `Pictures/`；标题引用 `Heading1–6` 段落样式，Mermaid `<svg>` 先光栅化为 PNG 嵌入。
* **LaTeX**：✅ **已实现（2026-08-30）**。`src/export/markdownToLatex.ts` 纯 TS 零依赖，不引入 pandoc。关键设计：**转义与「公式 / 代码 / 链接」互斥**——先把这些片段抽成占位符，对剩余文本做 LaTeX 特殊字符转义，最后回填；否则 URL 里的 `_`、公式里的 `\` 会被破坏。覆盖标题 / 列表（含嵌套）/ 表格 / 代码 / 引用 / 图片 / 链接 / 脚注 / 公式，默认 `ctexart` 文档类支持中文（需 XeLaTeX）。Node 单测 19 项断言全通过。
* **PDF 增强**：✅ **已实现（2026-08-30）**。在现 `webContents.printToPDF` 之上，`src/export/docTemplate.ts` 增加：`@page` A4 分页、**自动目录**（取正文标题层级并补锚点，PDF 恒开、HTML 可选）、**封面页**（标题 / 作者 / 日期取自 frontmatter，可选）、分页控制（一级标题另起页、代码块 / 表格 / 图表 `break-inside: avoid`、标题不孤行）。
* **导出范围**：✅ **整篇 / 当前选中 / 多文件合订均已实现**——选中走 ProseMirror 选区序列化，源码模式取选区 Markdown 再渲染，两种模式产出同构；无选区回退整篇并提示。
  * **多文件合订**（2026-08-30）：`src/components/CompilePanel.vue` 按文件树顺序列出 vault 内全部 `.md`，支持勾选 + 上下移排序 + 合订标题 + 每篇另起页（PDF `break-before:page`）；输出 HTML / PDF / LaTeX 任选。逐文件 `readFile → markdownToHtml（复用 Milkdown parser/schema，不建第二实例）→ inlineImages（按各自文档目录解析相对图片）→ 拼接`，再走与单文档完全相同的 `buildExportContent(override, forceInline)` 管道，`forceInline` 强制内联图片与图表，保证跨目录自包含。
  * **导出前预览**（2026-08-30）：`exportPrefs.preview` 开关（导出菜单可切换），或在合订面板内勾选。预览浮层 `src/components/ExportPreview.vue` 对 HTML/PDF 用 Blob + `iframe(sandbox="allow-scripts allow-same-origin")` 渲染真实排版、LaTeX 显示源码，确认后才写盘 / 打印；预览与落盘共用同一份已构建内容，不重复渲染。
    * **预览白屏修复**：预览 iframe 用 `blob:` URL，但 CSP `default-src 'self'` 未含 `frame-src blob:` 会拦截加载；`sandbox` 缺 `allow-same-origin` 也会阻止 blob 加载 → 一片白。已给 CSP 加 `frame-src 'self' blob:`、iframe 改 `sandbox="allow-scripts allow-same-origin"`，预览恢复正常渲染。
    * **深色模式原生保存框不同步**：文件名在系统原生保存框里填写，而 app 深色由 CSS 驱动、Electron 原生主题（`nativeTheme.themeSource`）未同步 → 深色 app 弹出浅色对话框、文字发白看不清。新增 IPC `app:setNativeTheme`，`appearance.applyAppearance` 每次切换时把 `nativeTheme.themeSource` 同步为 `mode`，原生对话框与 app 同明暗。
    * **`ExportPreview.vue` 令牌修正**：原误用未定义的 `--text-primary/--text-secondary`（实际为 `--hue-text-1/2`），已改正确，并把文件名区做成与主题一致的可读 chip。
  * **导出细节二次打磨（2026-08-30）**：用户实测「开了预览却没看到预览界面、没问导出到哪里、不知是否成功」——根因是导出全链路**无异常兜底**，任一环节抛错即静默 reject。本轮收口：
    * **源码模式取正文修复（真因）**：`EditorHost.getHTML()` 旧实现先 `setMarkdown` 再读所见即所得 DOM，但源码模式下 WYSIWYG 视图 DOM 滞后/为空 → 返回空串 → `buildExportContent` 因 `!body` 静默返回 null → 不预览、不弹框、不提示，与用户症状完全吻合。改为：**源码模式直接走 `markdownToHtml(fidelity.currentText)` 解析管线**（与合订/选区导出同源），不再依赖滞后视图 DOM。
    * **全链路异常可见化**：`doExport` / `onCompile` / `confirmExport` / `writeExport` 全部包 try/catch，任何失败 `console.error` 并 `showToast(..., 'err', 5000)` 提示具体错误；写盘成功 toast 时长延至 4500ms 并**显式展示保存路径**，取消 / 失败均回传明确状态。
    * **预览 UX 打磨**：确认按钮文案改为「确认并选择位置」并加 hint「确认后将弹出系统对话框，选择保存位置」，明示会弹系统保存框；预览浮层补**空内容兜底态**（「当前内容为空，无可预览内容」），文件名加粗醒目。
* **图片与图**：✅ **已实现**。图片**内联（base64）vs 相对路径**可选（`src/export/imageInline.ts`，按文档所在目录解析相对路径，经 `file:readBase64` 读取）；**Mermaid 转内嵌 SVG**（`src/export/mermaidSvg.ts`），使 PDF 与离线 HTML 不再依赖 CDN。**PDF 强制内联**——它经隐藏窗口加载 `tmpdir` 下的临时文件，相对路径图片与 CDN 脚本都取不到（这也是此前 PDF 丢图的根因）。
* **渲染进程 Node 全局 polyfill（2026-08-30 修复）**：`mermaid` 的部分图表模块（swimlanes 等）在浏览器/渲染进程里引用全局 `Buffer`，而本应用 renderer 为 `contextIsolation/sandbox`（无 Node 全局），Vite 不自动 polyfill → 导出含 Mermaid 代码块的文档时抛 `Buffer is not defined`。已在 `src/main.ts` 入口注入纯 JS 的 `buffer` 包（`globalThis.Buffer = Buffer`），确保 mermaid 渲染前全局可用（同时惠及编辑器内 Mermaid 实时预览）。
* **依赖约束**：二进制格式仅新增纯 JS 依赖 **`jszip@3.10.1`**（EPUB / ODT / DOCX 打包），无 node-gyp / fs / path 引用，可在 sandbox 渲染进程直接打包，不触碰「禁编译型依赖」红线；RTF 为零依赖手写。曾经引入的 `html-to-docx` 因其模块顶层 import 一整条 Node 内置模块、在浏览器打包后被 externalize 成空壳并导致渲染进程启动即崩（整窗漆黑），**已移除**。全部格式仍 **不依赖 pandoc 等外部二进制**。
* **UI**：✅ 导出菜单由 `TitleMenu` 的 `MenuEntry.separatorTitle` 分组为「文本（Markdown / 纯文本）/ 排版·网页（HTML / PDF / LaTeX）/ 办公·电子书（Word / EPUB / RTF / ODT）」三段，下接四个开关（自动目录 / 封面页 / 图片内联 / 仅选中范围）+ 多文件合订入口；合订面板 `CompilePanel.vue` 的格式下拉同步 9 选项；未新增组件。元信息由批次二属性面板的 frontmatter 供给。
* **IPC 收敛**：`export:html` 升级为通用 `export:file`（content + defaultName + filters），HTML 与 LaTeX 共用一条写盘通道，避免逐格式加通道的冗余；新增 `file:readBase64` 供图片内联。
* **本机验证状态（2026-08-30）**：9 种格式代码均已实现并通过 `typecheck` / `build`，但用户本机缺对应验证软件（Word / EPUB 阅读器 / LibreOffice 等），**产物正确性尚未在本机运行期验证**。导出管道已全链路加异常兜底、预览浮层 / 系统保存框 / 原生主题同步均已打磨，待用户本机具备对应软件后逐项验收。

### 3.5 凝神模式 = 打字机 + 专注/禅 融合

> 用户决策：打字机与禅模式本质都是「沉浸写作」体验，融合为一个更典雅的「**凝神**」模式（图标 `moon`，英文 `Focus`），标题栏一个开关统一控制，避免两个按钮割裂。

* **打字机居中**：当前光标所在行在视口内垂直居中（默认偏上 1/3，即内容列 1/3 处）；`behavior:'smooth'` 平滑滚动；**rAF 节流**，避免抖动；**失焦暂停**（非编辑态不滚动）。
* **块级淡化（禅）**：当前光标所在块加 `.zen-active`（高亮），其余块加 `.zen-dim`（opacity .26 + saturate 降饱和）。必须用 ProseMirror **node Decoration** 实现——CSS 无法按光标给「除当前块外的所有块」加类；Decoration 是非破坏性的，不改动文档、不误标 dirty。
* **单实例红线 + 开关机制（修复「凝神无效」根因）**：所见即所得走 `src/editor/zen.ts` 的 `createZenPlugin()`（ProseMirror Plugin），装饰状态由 `PluginKey<ZenValue>` 持有；`setZen` 经 `view.dispatch(tr.setMeta(zenKey, value))` 切换——**meta 事务必定触发** `apply` 重建装饰。早期版本用模块级标志 + 空事务 `dispatch(v.state.tr)`，空事务在视图派发链中常被当作「无变化」跳过，导致装饰不重算、淡化/高亮不出现（即「凝神无效」）；改 meta 后稳定生效。源码模式走 `SourceEditor` 的 `EditorView.scrollIntoView` 居中（同源 `isZenActive()` 模块级开关，仍保留供源码模式与 plugin `view.update` 读取）；居中两模式都跑，淡化仅 WYSIWYG 生效。
* **多标签兼容**：切 tab 时 `zenState.active` 已是 false（面板/模式切换前暂停居中），互不冲突；与 `captureScroll/restoreScroll` 互不打架。
* **持久化**：`SessionState` 新增 `focusMode?: boolean`，随会话恢复（`App.onMounted` 读 `focusMode` → 若为真则 `setZen(true)`）。纯 CSS + 选区监听，零新增依赖。
* **凝神 2.0「雾与纸」（批次二收尾后升级，权威细节见 `docs/FOCUS-MODE-2.0-DESIGN.md` 与 ARCHITECTURE §5.11）**：四幕进场/三幕退场布局动画（`styles/zen.css`，`.shell[data-zen]` 驱动）、**文本块距五档雾化衰减**（`.zen-dim-1..5`，档位走 `--fog-1..5` 变量；按文档序遍历全部文本块——列表项 / 引用 / 表格单元格内的嵌套文本块也逐块淡出，长列表不再「整棵全亮」，顶层叶块按前置文本块数计距，容器结构保留满透明度）、纸卷 lerp 滚动（单帧限幅、只脏时拉锚）、Esc **轻退栏**（32px 玻璃胶囊）与**设置面板**（锚点/雾化/平滑度/自动全屏/轻退栏，偏好持久化于 `SessionState.zenPrefs`）。

### 3.6 写作辅助包

* **已实现（2026-08-30）**：渲染侧 `src/editor/frontmatter.ts` 复用已依赖的 `gray-matter` 解析 / 回写 frontmatter，正文逐字保真、未知字段透传；新增 `EditorHost.insertText`（所见即所得走 ProseMirror `tr.insertText`、源码走 CodeMirror dispatch）作为片段插入与未来命令面板的统一入口。`src/components/WritingAidsPanel.vue` 玻璃面板双标签页——**属性**（标题/作者/描述/标签/日期表单，应用即改写顶部 YAML、`loadMarkdownExternal` 自动保存）与**片段**（内置文档模板/代码块/表格/提示框/任务列表/脚注/流程图/公式块，点击光标处插入）。标题栏「更多 ⌄ · 写作辅助」唤起；i18n 文案集中在 `ui.writingAids`。直接喂给导出元信息与 Phase 3 标签体系。

### 3.7 链接健康检查

* **已实现（2026-08-30，2026-08-30 二次打磨）**：主进程 `electron/main/vault.ts` 的 `checkLinks(root)` 两遍遍历（先收集全部 md 建基名 / 相对路径索引，再逐文件逐行抽取 `[[wikilink]]` 与 (md/image) 链接解析判定），新增 IPC `vault:checkLinks` 与 preload `window.api.checkLinks`；渲染侧 `LinkCheckPanel.vue` 玻璃浮层按 Wiki / 链接 / 图片三色分类展示断链（源文件 · 行号 · 目标 · **所在行原文预览**），支持类型筛选与按类型拆分计数，点击经 `App.onOpenBrokenLink` **定位到断链具体行**（切源码 + `revealLine`）。外部链接与纯锚点跳过；断链条目上限 2000。`BrokenLinkItem` 含 `context`（所在行原文）。
* 与 Phase 3 双链天然衔接：Phase 2 先埋"解析 + 报告"能力，Phase 3 升级为正向/反向索引与跳转。

### 3.8 近期打磨（批次二收尾：语言一致性与界面细节）

* **凝神模式修复**：开关从「模块级标志 + 空事务」改为「`PluginKey<ZenValue>` + `tr.setMeta(zenKey, value)`」，`apply` 必定触发装饰重算，解决「凝神无效」（见 §3.5、ARCHITECTURE §5.10）。
* **状态栏单位 i18n**：切换中/英后右下角显示 `字/词/′` 或 `chars/words/min`，与统计弹层单位一致（`U.unitHan/unitWord/unitMin`）。
* **快照标注**：版本快照功能已于 2026-08-30 经用户运行期验证可用，原「⚠ 实现但未测试」标注已从代码注释、面板 UI 横幅与文档中移除（见 §3.3、ARCHITECTURE §5.10）。
* **左侧搜索增强全局替换**：保留左侧文件树搜索框，新增玉质「全局替换」区块（`vault:replace`），仅在搜索命中文件范围内做字面量替换、写回磁盘并自动重载当前文档（见 §3.2、ARCHITECTURE §5.10）。
* **文件树 UI redesign**：`FileTree.vue` 重写——目录/文件用不同 `Icon`、选中态改强调色文字 + 左侧 2px 高亮条（`::before`）、嵌套层级用细玉质分隔线表达归属，整体更契合玉质体系；顶部栏不再保留「搜索」图标按钮（其唤起的 in-doc FindPanel 入口已于 2026-08-30 按用户要求移除，仅保留左侧文件树全局搜索框，避免与全局搜索重复）。

***

## 4. 风险与注意

| # | 风险                | 应对                                       |
| - | ----------------- | ---------------------------------------- |
| 1 | 多标签切走后内容/光标丢失     | 单实例换内容 + capture/restore scroll（v1 已验证）  |
| 2 | Milkdown 多实例上下文错误 | 严守单 EditorHost，不每 tab 建实例                |
| 3 | 导出改写用户原文          | 导出一律基于内存 DOM/文本，不写回磁盘原文                  |
| 4 | 新增依赖撑大安装包         | 只选纯 JS 小库；mammoth/jsdiff/epub-gen 评估后纳入  |
| 5 | 历史目录被误当缓存清理       | 独立于 `.mdeditor/`；进 vault `.gitignore` 建议 |
| 6 | 跨平台构建             | 纯 JS 依赖三平台 CI 无原生编译问题                    |
| 7 | 打字机/禅模式与多标签滚动打架   | 切 tab 时暂停居中；rAF 节流，避免抖动                  |
| 8 | 多文件合订顺序错乱         | 由大纲/文件树顺序决定，提供拖拽排序确认                     |

***

## 5. 验收标准

* **批次一**：单窗口开 ≥3 篇并切换，未保存标记/右键菜单/过多折叠正确；文件内查找高亮+替换+计数+循环生效；全局查找带上下文片段+键盘导航+范围筛选并定位；拖放 `.md` 可打开；切回原文一字不改。
* **批次二**：保存后 `.yujian-history/` 生成快照；手动留档可加备注；历史面板行级 diff 预览并回滚（仅改编辑器、不覆盖磁盘）；统计汉字/英文/字符/阅读时长+选中统计+目标进度环正确；凝神模式（打字机居中 + 当前块高亮/其余块淡化 + 失焦暂停）符合预期；`focusMode` 会话持久化恢复正确。**（注：快照功能已于 2026-08-30 由用户运行期验证可用，上述快照相关验收项已通过。）**
* **批次三**：导出 docx/ePub/LaTeX 可正常打开、PDF 带目录分页；支持多文件合订+预览+图片内联+Mermaid 转图；片段模板与属性面板可用；断链健康检查报告准确；四种导出产物与编辑器内观感一致。

***

## 6. 明确不在 Phase 2 范围

AI 辅助写作（无 API，接口保留）· 插件系统 · 云同步 · 加密库 · Vim/Emacs 模式 · 移动端 · 实时协作。
（双链/反链/关系图见 §8，属 Phase 3。）

***

## 7. 后续动作

确认本计划后：

1. 更新 `README.md` / `docs/ARCHITECTURE.md` 路线图（新增阶段 9 = Phase 2）。
2. 按批次一开始实现，每批遵循「先更文档再提交」纪律。
3. 批次一完成打 `v1.1.0` 并走三平台 CI。

***

## 8. Phase 3 前瞻（个人知识库方向，用户有意拓展，不在 Phase 2）

> 用户后期有意从「技术写作编辑器」向「个人知识库」拓展。以下为建议的递进路线，待 Phase 2 完成后再评估，**不进入 Phase 2 范围**。Phase 2 的「链接健康检查（§3.7）」已先埋解析能力。

* **第一优先：双向链接 + 反链面板**（`[[wikilinks]]` + vault 级反向索引）。最高杠杆、最低风险，复用现有 vault 文件模型；编辑器内 `[[` 触发补全（经 `@milkdown/kit` 自研 node/plugin），点击跳转对应 md；反链面板列「哪些笔记链接着当前笔记」。
* **第二：标签 / MOC（内容地图）**：YAML frontmatter 或 `#标签` 语法，纯解析（Phase 2 属性面板已铺路），比文件夹更柔。
* **第三（锦上添花）：关系图（graph view）**：力导布局（d3-force 纯 JS），大库需采样/收起防卡顿；易成坑，放最后。
* **架构**：需建 vault 级 link index（正向 + 反向），可复用 MiniSearch 或轻量 JSON；图数据由 index 派生，不存原始图。
* **定位提醒**：PKM 是建在编辑核心之上的「关系层」，建议作为可开关的知识层，保留纯净编辑体验底座，避免把简单笔记用户吓跑。

