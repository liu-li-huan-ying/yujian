# 搜索重构：单引擎双范围（全部 / 本文档）

## 做了什么
把「单文档查找」与「文件夹全文搜索」**统一为同一套检索引擎**，仅靠「范围」区分，彻底删除独立的编辑器内查找实现，消除代码冗余。

- **主进程 `electron/main/vault.ts`**：`searchVault(root, query, opts?, file?)` 与 `replaceInVault(root, query, replacement, opts?, file?)` 各加可选 `file` 参数。
  - 传 `file` → 只搜这一个文件（不递归）=「本文档」范围；
  - 不传 `file` → 递归整个 vault =「全部」范围。
  - 后端按行切分命中、替换回写、原子写两套范围完全共用。IPC `VAULT_SEARCH`/`VAULT_REPLACE` 与 preload 签名同步透传 `file`。
- **前端 `Sidebar`**：只保留一个搜索框 + 一个 `SearchResults` 渲染器 + 一个替换面板。`scopeFile()` 在「本文档」返回 `props.activePath`、在「全部」返回 `undefined`，作为第 4/5 实参传入。命中结果一律**点击跳转**（复用 `onOpenResult(path, line)` → `EditorHost.revealLine`）。

## 删除的部分（2026-08-30，查找引擎已删除）
- `src/editor/docFindApi.ts`（`DocFindApi` 契约）已删除；`EditorHost` 的 `find/findNext/findPrev/replaceOne/replaceAll/clearFind/findCurrent/findTotal` 暴露与内部状态全部移除；`SourceEditor.getView()` 一并移除。
- 独立的编辑器内查找引擎（‹ › 步进 + 双模式各自实现）被「统一搜索 + 视图层高亮」取代，消除代码冗余。

## 保留 / 补回的命中高亮（视图层，零冗余）
- **源码模式** `src/editor/find-source.ts`：`sourceFindField`（`StateField` + `setSourceFind` effect）按统一 `query/opts` 全文扫描命中打 `.cm-find`、当前结果行打 `.cm-find--current`；文档编辑经 `tr.docChanged` 跟随重算。
- **所见即所得模式** `src/editor/find-wysiwyg.ts`：`createFindDecoPlugin`（`$prose` 注册，与凝神同机制）用 ProseMirror `Decoration.inline` 对称高亮全部命中、当前结果行打 `.pm-find--current`；`currentLine` 经 `isCurrentHit()` 判定（优先源码行文本匹配、回退行号比较，见下节）；文档编辑 / 切换文档经 `tr.docChanged` 跟随重算。`MilkdownEditor` 暴露 `setFind(fs|null)`，经 `view.dispatch(tr.setMeta(findKey, fs))` 驱动。
- **桥接**：`EditorHost.setFindHighlight` 同时转发两端；`Sidebar` 经 `find-highlight` 事件在「有查询且已打开文档」时推送——**两种范围都高亮**（全库范围也高亮当前打开文档内全部命中），无查询 / 无文档时抛 null 清空两端。
- `editor.css` 的 `.cm-find` / `.pm-find` 系列样式（青瓷半透底 + 实强调色反相的 `--current` 变体）。

## 外观与交互细节
- `.scope` 玉质胶囊分段控件（全部 / 本文档）；`.chip` 选项芯片（Aa / ⌗）；`.status`/`.hint` 状态行，延续玉质/玻璃设计令牌。
- `Ctrl+F` 接线 → 聚焦左侧搜索框（默认范围：有打开文档时「本文档」，否则「全部」）。
- `SearchResults` 用 `singleFile` 属性区分元信息：「本文档」显示「N 处命中」，「全部」显示「N 处命中 · M 个文件」。
- 回车（`onSearchEnter`）跳到第一条命中。
- **替换后高亮跟随**：`doReplace` 立即 `executeSearch()` 刷新结果（不走输入防抖），随后 `rederiveCurrentLine()` 让 `currentLine` 指向替换后仍有效的命中（优先当前活动文档首个命中，否则首个文件），确保替换引发行号偏移时高亮 current 标记不残留过期位置。

## 文档与辅助面板
- 使用指南第 3 节改写为统一检索；README「搜索（双范围）」与「文件内查找 / 替换」两段同步为「共用同一套引擎、仅范围不同」；ARCHITECTURE §5.9 改写为单引擎 file 范围 + 两端高亮。

## 取舍
放弃 ‹ › 逐个步进，换来**零代码冗余**与两种范围完全一致的交互；但**保留了两端命中常驻高亮**（用户认可源码模式高亮，并进一步补回所见即所得对称高亮）。高亮完全由统一搜索的 `query/opts` 驱动，与「全部 / 本文档」共用一套逻辑，无独立查找引擎冗余。命中定位在**两种模式都可用**：所见即所得补齐行定位后，点命中行在当前模式下直接滚动定位，不再强制切到源码（详见下节）。

## 命中行定位：不再强制切源码（2026-08-30）

**问题**：点搜索结果 / 断链时，`App.onOpenResult`、`onOpenBrokenLink` 会把 `requestedMode` 强制切到 `'source'`，理由是「渲染模式无法精确定位行」——`EditorHost.revealLine` 里 `if (mode.value !== 'source') return` 直接短路，所见即所得根本没有定位能力。后果：在所见即所得下点结果会**被打断切到源码**，破坏写作沉浸感。

**修正**：所见即所得补齐行定位，`revealLine` 按当前模式分派（源码 CodeMirror / 渲染 ProseMirror），两处强制切模式的逻辑一并移除。

**关键坑：源码行号 ≠ 渲染行号**。`lineOfPos` 基于 `doc.textBetween(0, pos, '\n', '\n')` 统计换行，而 Markdown 空行**渲染后不产生节点**、块之间只算一个换行，渲染态行号被「压缩」，与统一搜索返回的源码行号存在系统性偏移（实测：源码第 3 行会落到渲染第 2 个文本块）。

**统一口径**：改用源码行文本匹配消除偏差——
- `find-wysiwyg.ts` 新增 `stripMd(line)` 与 `findPosByText(doc, needle)`（片段逐级缩短匹配，容忍语法差异，找不到返回 `null`）；
- `MilkdownEditor.revealLine(line)`：先按源码第 `line` 行文本走 `findPosByText`，匹配不到回退 `findPosOfLine`（行号反查留作兜底），命中后 `setSelection(TextSelection.near(...))` 落光标，再经 `scrollPosToCenter()` 把命中行滚到**视口中央**（与源码模式 `EditorView.scrollIntoView(y:'center')` 对称；ProseMirror 事务的 `scrollIntoView` 只保证可见不居中，故改用 `coordsAtPos` 取目标像素坐标、手动调滚动容器 `scrollTop`，中心锚点 0.5）+ `view.focus()`；
- `WysiwygFindState` 新增 `currentLineText`，由 `EditorHost.setFindHighlight` 从 `fidelity.currentText` 取该行原文传入，使 `current` 强化标记与源码行号严格对齐。

## 验证
- `npm run typecheck` ✅、`npm run build` ✅；产物含 `findPosByText` / `currentLineText` / `stripMd` / `TextSelection`。
- 真实浏览器（系统 Edge + puppeteer-core）驱动**真实 Crepe** 实测：初始搜索 / 切源码 / 切回 / 文档变更自愈 / 清空 五个场景装饰数 4·4·4·4·0 全对，CSS 变量解析为 `rgba(95,168,160,0.35)`；源码第 1/3/5/8 行分别落到「标题 / 段落 / 列表项 / 引用」正确块，`current` 标记 4/4 正确；面板 `display:none → 可见` 装饰数 4 → 4 不变。

---

# 导出增强（批次三 · 零依赖批次，2026-08-30）

权威细节见 `docs/PHASE2-PLAN.md` §3.4 与 `docs/ARCHITECTURE.md` §5.6。

## 做了什么
- **LaTeX 导出**：`src/export/markdownToLatex.ts` 纯 TS 零依赖（不引入 pandoc），覆盖标题 / 列表（含嵌套）/ 表格 / 代码 / 引用 / 图片 / 链接 / 脚注 / 公式，默认 `ctexart` 文档类支持中文。
- **PDF 增强**：自动目录（取标题层级并补锚点，PDF 恒开）、A4 分页控制（一级标题另起页、代码与表格不跨页断裂、标题不孤行）、可选封面页。
- **导出范围**：整篇 / 仅选中内容（两端产出同构，无选区回退整篇并提示）；**多文件合订**（2026-08-30）：`CompilePanel.vue` 按文件树顺序列出 vault 内 `.md`，勾选 + 上下移排序 + 合订标题 + 每篇另起页，HTML / PDF / LaTeX 任选，逐文件渲染并按各自目录内联图片后拼接，走同一 `buildExportContent(override, forceInline)` 管道。
- **图片与图表**：base64 内联策略可选；Mermaid 转内嵌 SVG，PDF 与离线 HTML 不再依赖 CDN；合订强制内联（`forceInline`）保证跨目录自包含。
- **管道收敛**：`export:html` 升级为通用 `export:file`，HTML 与 LaTeX 共用一条写盘通道；新增 `file:readBase64`。
- **导出前预览**（2026-08-30）：`exportPrefs.preview` 开关 + 合订面板内勾选；`ExportPreview.vue` 对 HTML/PDF 用 Blob+iframe 渲染真实排版、LaTeX 显示源码，确认后才落盘 / 打印。
- **菜单**：HTML / PDF / LaTeX + 五个开关（自动目录 / 封面页 / 图片内联 / 仅选中范围 / 导出前预览）+ 多文件合订入口。

## 关键坑
1. **计划里 mammoth 选型是错的**：mammoth 只能 *docx → HTML*（解析既有 docx），**不能生成 docx**；生成应用 `docx` 包。已在计划文档订正。
2. **LaTeX 转义与「公式 / 代码 / 链接」互斥**：必须先用占位符抽出这些片段，再对正文转义，否则 URL 的 `_`、公式的 `\`、宏名的 `#` 会被破坏。
3. **PDF 此前必然丢图**：它经隐藏窗口加载 `tmpdir` 下的临时 HTML，相对路径图片取不到 —— 故 PDF 强制内联 base64。
4. **构建 EPERM**：`out/` 残留会致 `EPERM: KaTeX_*.woff2`，需沙箱外 `rm -rf out` 后重建。

## 验证
typecheck ✅；LaTeX 转换器 Node 单测 **19 项断言全通过**（含「公式 / 代码 / 链接 URL 不被转义」）。

## 待办
~~docx / ePub / RTF / ODT~~ —— 已于 2026-08-30 全部落地（见下方「导出格式全集扩展」一节）。（多文件合订、导出前预览已于 2026-08-30 落地。）

---

# 导出链路细节打磨（2026-08-30，二次打磨）

## 背景
用户反馈：开启「导出前预览」后导出，**没看到预览界面、没弹出「保存到哪里」的系统对话框、不知道导出是否成功**。要求把这条链路打磨扎实，不再静默失败。

## 根因定位
- **真因（源码模式取正文）**：`EditorHost.getHTML()` 旧逻辑在源码模式下先 `setMarkdown(fidelity.currentText)` 再读 `view.dom.innerHTML`；但源码模式下所见即所得视图 DOM 滞后/为空 → 读到空串 → `buildExportContent` 因 `!body` 直接返回 `null` → 不预览、不弹窗、不提示。用户正是在**源码模式**下触发的，症状完全吻合。
- **共因（全链路无兜底）**：`doExport`/`onCompile`/`confirmExport`/`writeExport` 均无 try/catch，任一环节（渲染/读图/内联/Mermaid/写盘）抛错都会静默 reject，用户看不到任何反馈。

## 修复
- `EditorHost.getHTML()`：源码模式改为直接 `return markdownToHtml(fidelity.currentText)`（复用 Milkdown `parserCtx`/`schemaCtx`/`DOMSerializer`，与合订/选区导出同源），不再依赖滞后视图 DOM；所见即所得模式仍走 `milkdown.getHTML()`。
- `App.vue` 四处函数包裹 try/catch：失败 `console.error` + `showToast(...,'err',5000)` 显示具体错误；写盘成功 toast 时长延至 4500ms 并显式展示保存路径；主进程 `EXPORT_FILE`/`EXPORT_PDF` 回传 `{ok,path|canceled|error}`，导出结果（成功/取消/失败）均有明确 toast。
- `ExportPreview.vue` UX：`exportPreviewConfirm` 改为「确认并选择位置」、`exportPreviewHint` 加「确认后将弹出系统对话框，选择保存位置」明示会弹框；补 `exportPreviewEmpty` 空内容兜底态；文件名 `.panel__name` 加粗醒目。i18n zh-CN/en-US 各补 3 键。

## 验证
- `npm run typecheck` ✅、`npm run build` ✅（16s 左右，`✓ built in 15.43s`）。
- 无头环境驱动完整 UI 不可靠（开库→开文档→导出需真实交互），故以**静态分析 + 针对性修复**为准；源码模式 `getHTML` 真因建议运行期验收。

## 运行期验收清单（本机未验证）
1. 开启「导出前预览」后，从**源码模式**与**所见即所得模式**分别导出 HTML / PDF / LaTeX，确认：
   - 预览浮层出现且渲染真实排版（LaTeX 显示源码）；
   - 点「确认并选择位置」后弹出系统保存对话框；
   - 成功后 toast 显示保存路径、失败/取消有明确提示。
2. 合订面板内勾选「导出前预览」走同一路径验证。

---

# 导出崩溃修复：渲染进程 Buffer is not defined（2026-08-30）

## 背景
上一轮把导出全链路加 try/catch 后，导出不再静默失败，但用户实测报「导出失败，buffer is not define」。根因是 mermaid 的若干图表模块（swimlanes 等）在浏览器/渲染进程里引用 Node 全局 `Buffer`，而本应用 renderer 为 `contextIsolation/sandbox`（无 Node 全局），Vite 不会为浏览器自动 polyfill → 含 Mermaid 代码块的文档导出渲染时抛 `Buffer is not defined`。

## 为什么之前没暴露
源码模式 `getHTML()` 旧实现返回空串会让 `buildExportContent` 提前短路，导出管线根本走不到 mermaid 渲染；修复「源码模式取正文」后管线真正跑起来，才撞上这个依赖级的 `Buffer` 引用。

## 修复
- 安装纯 JS 的 `buffer` 包（无 node-gyp 编译，符合约束），加入 `dependencies`。
- `src/main.ts` 入口首行注入并赋值全局：`import { Buffer } from 'buffer'; (globalThis as ...).Buffer = Buffer`。
  - **不能**放进独立 `polyfills.ts` 模块——rollup 会把它当无副作用模块 tree-shake 掉；入口模块 `main.ts` 的顶层副作用不会被剔除，故放入口。
  - **不能**放 `index.html` 内联 `<script>`——CSP `default-src 'self'` 禁止内联脚本。
- 验证：构建产物入口 chunk 含 `globalThis.Buffer = bufferExports.Buffer`，`buffer` 包（`SlowBuffer` 特征串）已打进 bundle。
- 副作用：同时修了编辑器内 Mermaid 实时预览潜在的同类崩溃。

## 验证
- `npm run typecheck` ✅；`npm run build` ✅（先 `rm -rf out` 清 EPERM 残留再重建）。
- 待运行期验收：含 Mermaid（尤其 swimlanes 等进阶图）的文档，开启/关闭「导出前预览」分别导出 HTML/PDF/LaTeX，确认不再报 `Buffer is not defined`。

## 文件
`src/main.ts`、`package.json`（新增 `buffer` 依赖）、`docs/PHASE2-PLAN.md` §3.4、`docs/ARCHITECTURE.md` §5.6。

---

# 导出预览打磨（2026-08-30，三次打磨）

## 用户反馈
导出已能成功，但：① 预览界面**一片白什么也看不见**；② 在**深色模式**下，填写文件名的地方（系统原生保存框）是**偏白背景 + 白字**看不清，且与 app 整体色调不搭。

## 根因
1. **预览白屏 = CSP 拦截 blob 框架**。预览用 `Blob` + `<iframe :src="blobUrl">` 渲染，`index.html` 的 CSP 是 `default-src 'self'`，**没有 `frame-src blob:`** → 浏览器按 `default-src` 回退判定不允许加载 blob 框架 → iframe 空白（一片白）。叠加 `sandbox="allow-scripts"` 缺 `allow-same-origin`：blob URL 归属父文档源，沙箱无同源则无法加载。
2. **深色保存框白底白字 = 原生主题未同步**。文件名在 Electron 的**系统原生保存框**里填写，而 app 的深色完全由渲染层 CSS（`data-mode`）驱动；Electron 原生控件明暗由 `nativeTheme.themeSource` 决定，此前从未设置 → 原生框按系统默认（浅色）渲染，与深色 app 割裂。

## 修复
- **CSP**：`index.html` 追加 `frame-src 'self' blob:`（blob iframe 的**内部**子资源——CDN mermaid/KaTeX——由其自身文档 CSP 决定，blob 文档无 CSP，故不受父 CSP 约束，无需额外放开 script/style）。
- **`ExportPreview.vue`**：`sandbox` 改 `allow-scripts allow-same-origin`（同源才能加载父文档创建的 blob）；修正误用的未定义令牌 `--text-primary/--text-secondary` → 真实令牌 `--hue-text-1/2`；文件名区改为与主题一致的可读 chip（`background: var(--hue-border-subtle)`）。
- **原生主题同步**：新增 IPC `app:setNativeTheme`（`electron/shared/ipc-channels.ts` → `preload` 暴露 `setNativeTheme` → `main` 设 `nativeTheme.themeSource = mode`）；`appearance.applyAppearance` 每次切换（含启动 `initAppearance`）都把 `mode`（dark/light/system）同步给主进程，原生保存框/菜单与 app 同明暗。

## 验证
- `npm run typecheck` ✅；`npm run build` ✅。产物核验：`out/renderer/index.html` 含 `frame-src 'self' blob:`；`ExportPreview` chunk 含 `allow-scripts allow-same-origin`；CSS 含 `hue-text-1/2` 与 `panel__meta` chip。
- 本机未验证（用户缺验证软件，暂不验证）：深色模式下开启预览导出，确认① 预览渲染真实排版（不再白屏）；② 点「确认并选择位置」弹出的系统保存框为深色、文件名清晰可读、与 app 色调一致。

## 文件
`src/index.html`、`src/components/ExportPreview.vue`、`src/appearance.ts`、`electron/shared/ipc-channels.ts`、`electron/preload/index.ts`、`electron/main/index.ts`、`docs/PHASE2-PLAN.md` §3.4、`docs/ARCHITECTURE.md` §5.6。

---

# 合订面板「书名输入框」细节打磨（2026-08-30）

## 症状
深色模式下，合订（多文件合并）面板里「给合并后文件起名」的输入框是一块**偏白背景 + 偏白字**的框，与整体玉质/玻璃风格割裂、看不清。

## 根因
`.opt__input` 用了两个**本应用根本不存在**的 CSS 令牌：
- `background: var(--hue-bg-input, rgba(255,255,255,0.7))` → 回退到近白色，深色下成白块；
- `color: var(--text-primary)` → 未定义，声明失效、靠继承，深色下继承出偏白字。
整块面板其实都在用未定义令牌靠继承续命（`--text-primary/--text-secondary` 全项目无定义），只是其余元素恰好继承到可读色，唯独带显式白底的输入框破功。

## 修复（`src/components/CompilePanel.vue`）
- 输入框重做为**凹陷玻璃字段**：深色 `background: rgba(0,0,0,.22)` + `inset 0 1px 2px rgba(0,0,0,.35)` 内阴影表达「刻入」层次（呼应 UI-DESIGN §10.1 Depth 原则）；高度提到 30px（对齐 28px 触控目标 + 与搜索框一致）；`radius-md`、字号 12.5px、字体走 `--font-ui`。
- 前导 `book` 图标（青瓷色相 `--hue-text-3`）提升可发现性，输入区左内缩让位。
- 占位符显式 `--hue-text-3`（`opacity:1`），聚焦时青瓷描边 + `0 0 0 3px` 半透明强调光环（无障碍 §7 焦点可见）。
- 浅色覆盖：`background: rgba(20,30,28,.05)` 极淡墨调凹陷，避免白底浮在羊脂玉玻璃上；聚焦光环转 `--hue-accent` 深青。
- 顺手把面板内全部 `--text-primary/--text-secondary` 映射到真实令牌 `--hue-text-1/2`，深色渲染不再依赖脆弱继承。

## 验证
- `npm run typecheck` ✅、`npm run build` ✅；产物 CSS 确认含凹陷阴影、强调焦点环、`[data-skin][data-mode='light'] .opt__input` 浅色覆盖，无 `--hue-bg-input`/`--text-primary` 残留。

---

# 导出格式全集扩展（9 种，2026-08-30）

## 需求
用户在已落地的 HTML / PDF / LaTeX 之上，要求**尽量把能纯 JS / WASM 实现的导出格式都加上**，明确不依赖 pandoc 等外部二进制。

## 最终格式集（9 种）
| 格式 | 类别 | 实现 | 关键依赖 |
| --- | --- | --- | --- |
| Markdown | 文本（透传） | `getMarkdown()` 直出 | 无 |
| 纯文本 | 文本 | `htmlToPlainText(article)` | 无 |
| HTML | 网页 | 规范化 HTML 模板 | 无 |
| PDF | 网页/打印 | 隐藏窗口 `printToPDF` | 无 |
| LaTeX | 源码 | `markdownToLatex.ts` | 无 |
| Word (docx) | 二进制 | 手写 OOXML + `jszip@3.10.1` | 纯 JS |
| EPUB | 二进制 | `jszip@3.10.1` 手写 OPF | 纯 JS |
| RTF | 二进制 | 零依赖手写 RTF 1.9 | 无 |
| ODT | 二进制 | `jszip@3.10.1` 手写 ODF 1.2 | 纯 JS |

## 架构要点
- **文本类（md/txt/html/latex）与 PDF** 直接走通用 `export:file` IPC 写文本 / 打印。
- **二进制类（docx/epub/rtf/odt）** 在**渲染进程**序列化为 `Uint8Array`，经 `ExportPayload.binaryBase64` 以 base64 传给主进程，`writeFile(Buffer.from(b64,'base64'))` 精确写盘——规避 sandbox 下主进程无法访问渲染层 DOM，也避免文本编码损坏。
- `buildExportContent(kind, scope, override?)` 按 `ExportKind` 分派：md 透传、txt 取 article 纯文本、latex 走转换、其余先建规范化 HTML（二进制 / PDF / 强制内联时内联图片与 Mermaid），再调 `serializeBinary(kind, html, ctx)`。
- Mermaid `<svg>` 在 DOCX/RTF/ODT 经 `rasterizeSvgToImg` 用 canvas 光栅化为 PNG 嵌入；EPUB 保留内联 SVG。
- 导出菜单用 `MenuEntry.separatorTitle` 分「文本 / 排版·网页 / 办公·电子书」三组，合订面板下拉同步 9 选项；i18n 中/英双语补全（zh-CN/en-US）。

## 关键坑与修复（本轮）
1. **RTF 中文乱码**：RTF 的 `\u` 转义要求是**带符号 16 位**（-32768~32767）。初版直接输出原始码点，导致 ≥ U+8000 的常见汉字（如 中 0x4E2D 正常，但 語/裡等大量字 ≥ 0x8000）产生 >32767 的值，严格 RTF 解析器会坏。已改为 `c >= 0x8000 ? c - 0x10000 : c` 转带符号值；辅助平面（emoji）拆 UTF-16 代理对各发一个带符号 `\u`。
2. **ODT 标题无样式**：初版 `<text:h>` 只设 `outline-level` 未引用段落样式，LibreOffice 虽进导航但无字号/加粗。已改用 `text:style-name="Heading1..6"` 关联 STYLES_XML 中的 `Heading1–6`。
3. **类型层旧 union 残留**：`doExport` / `onCompile` 的 `kind` 仍为 `'html'|'pdf'|'latex'`，调 `doExport('md')` 报 TS2345。已拓宽为 `ExportKind`。
4. **`separatorTitle` 误传 boolean**：`TitleBar` 里写成 `separatorTitle: true`，而 `MenuEntry.separatorTitle` 类型为 `string`，报 TS2322。已改为字符串分组标题。

5. **DOCX 导出导致整窗漆黑（严重）**：初版 DOCX 用 `html-to-docx@1.8.0`，但其在模块顶层 `import crypto/fs/path/zlib/stream/http/url/https/events/util` 一整条 Node 内置模块；Vite 打包时 externalize 成浏览器空壳，**渲染进程启动即崩** → 窗口漆黑、什么都不渲染。Node 里烟雾测试能过是因为 Node 自带这些模块，浏览器没有。**已弃用该包**，改用 `jszip` 手写 OOXML（`src/export/docx.ts`：document/styles/numbering/rels/content-types 全拼装，标题/列表/表格/图片/超链接/代码块齐全），与已落地的 ODT/EPUB 同构，纯 JS、零 Node 依赖。

## 验证
- `npm run typecheck` ✅；`npm run build` ✅（`✓ built in 18.94s`）。
- 构建警告确认清除：原先 `crypto/fs/path/xmlbuilder2/@oozcitak/url/htmlparser2` 的 `externalized for browser compatibility` 警告、**整条 html-to-docx 依赖树**、以及 `mermaid dynamic/static import` 警告均消失。
- 依赖：仅新增 `jszip@3.10.1`（EPUB / ODT / DOCX 打包），纯 JS、无 node-gyp/fs/path 引用，可在 sandbox 渲染进程直接打包；**已移除 `html-to-docx`**。
- **本机未验证（用户缺验证软件，暂不验证）**：深色模式下分别导出 9 种格式（尤其含 Mermaid 图表的文档导 docx/epub/rtf/odt），确认预览浮层、系统保存框、产物可正常打开（Word/EPUB 阅读器/LibreOffice）。待用户本机具备对应软件后逐项验收。

## 文件
- 新增：`src/export/types.ts`、`src/export/domUtils.ts`、`src/export/docx.ts`、`src/export/epub.ts`、`src/export/rtf.ts`、`src/export/odt.ts`、`src/export/serialize.ts`。
- 改动：`src/App.vue`（`buildExportContent`/`writeExport`/`doExport`/`onCompile` 分派 + `BytesToBase64` + `kindLabel`/`mimeFor`）、`src/components/TitleBar.vue`、`src/components/TitleMenu.vue`、`src/components/CompilePanel.vue`、`src/components/ExportPreview.vue`、`electron/shared/ipc-channels.ts`（`ExportPayload.binaryBase64`/`mime`）、`electron/main/index.ts`（按 `binaryBase64` 写字节）、`src/i18n/locales/{zh-CN,en-US}.ts`。

---

# 全文档与软件内快捷键/介绍同步 + 废弃清理（2026-08-30）

## 做了什么
按用户要求，把**软件内（UI）与所有文档**的快捷键、功能介绍同步到最新状态，并筛查删除无用的过时/废弃文件。

### 软件内（renderer）
- `src/App.vue`：移除 `onToggleSnapshot` 上方"⚠ 实现但未测试"陈旧注释；新增 `appVersion` ref，`onMounted` 经 `window.api.appVersion()` 动态取**真实版本号**，传给 `<HelpPanel :version>`（根治硬编码过时版本）。
- `src/components/HelpPanel.vue`：新增 `version?` prop；使用指南「关于」节追加「{{ aboutVersion }} {{ version }}」。
- `src/i18n/locales/{zh-CN,en-US}.ts`：新增 `aboutVersion` 键；`aboutBody` 去掉硬编码"版本 1.1"（改由运行时版本动态显示）。

### 文档
- `README.md`：快照说明改为"2026-08-30 经用户运行期验证可用，已无未测试标注"。
- `docs/PHASE2-PLAN.md` §2：FindPanel 入口改为"已于 2026-08-30 移除，`Ctrl/Cmd+F` 现聚焦左侧搜索框"。
- `docs/UI-DESIGN.md`：§5.6 标题标"⚠️ 设计中，尚未实现"；§5.2/§430 注明 `Ctrl+K` 命令面板未实现、`Ctrl+F` 为实际键位。
- `docs/PHASE2-BATCH1-UI-PLAN.md`：状态块补"⚠️ 功能变更(2026-08-30)：FindPanel 已移除"注记。
- `docs/PHASE2-BATCH2-UI-PLAN.md`：5 处 `FindPanel` 定位语言引用改为 `.glass` 浮起层规范（FindPanel 已删，避免指向死组件）。
- `docs/preview/{theme-yujian,style-report-v1}.html`：2 处"命令面板"加"设计目标，当前尚未实现，见 F1"注记。

## 废弃清理（Part B）
- 删除 4 个 gitignored 根目录残留：`.1788052741701.tmp`、`electron.vite.config.1788055056509.mjs`、`electron.vite.config.1788090960032.mjs`、`electron.vite.config.1788091055277.mjs`（均匹配 `.gitignore` 的 `.*.tmp` / `electron.vite.config.*.mjs`）。**保留**真正的 `electron.vite.config.ts`。
- 确认 `src/editor/find-source.ts` / `find-wysiwyg.ts` 仍被左侧搜索高亮使用，非死代码，不删。

## 验证
- `npm run typecheck` ✅；`npm run build` ✅（先 `rm -rf out` 清 EPERM 残留再重建）。
- 产物核验：renderer bundle 无残留"版本 1.1"，`aboutVersion`/`appVersion` 已打进；`find-source`/`find-wysiwyg` 仍在 bundle（高亮保留）。
- 待运行期验收：F1 帮助「关于」显示真实版本号（非硬编码 1.1）。

## 快捷键事实来源（2026-08-30 核实）
`main` 进程**不建原生 Menu 加速器**，全部快捷键由 `src/App.vue` `onKeydown` 窗口监听分发，这是唯一事实来源。当前 8 条：
`F1` 帮助 · `Ctrl/Cmd+O` 打开 · `Ctrl/Cmd+S` 保存 · `Ctrl/Cmd+\` 切侧栏 · `Ctrl/Cmd+Shift+\` 切大纲 · `Ctrl/Cmd+/` 切渲染/源码 · `Ctrl/Cmd+F` 聚焦左侧搜索框 · `Esc` 凝神状态机。

---

# Markdown 渲染问题修复（2026-08-30 晚）

用户提交 9 项渲染问题，确认 4 个方向后**全部落地**，typecheck ✅ + clean build ✅（`✓ built in 14.92s`）。

## 已修

| # | 问题 | 处理 |
|---|------|------|
| 1 | 粗体高亮不明显 | `editor.css`：`strong` 由 `font-weight:500`（与正文同色同重）改 `700` |
| 2 | Ctrl+链接无法跳转 | 新增 IPC `app:openExternal`（main 用 `shell.openExternal`，仅放行 http(s)）；编辑器点击委托，仅 Ctrl/⌘ 拦截，普通点击照常可编辑 |
| 3 | 互联网图片不显示 | `src/index.html` CSP `img-src` 补 `https:`（原仅 `'self' data:`） |
| 4 | Mermaid/甘特图/饼图不渲染 | 编辑区改为**默认直接显示图表**（§5.3.1） |
| 5 | 脚注不能跳回正文 | 编辑区点击双向跳转 + 导出注入回跳锚点 |
| 6 | Emoji 短代码不转换 | `:smile:` 输入自动转换 + 只读装饰显示 + 导出替换 |
| 7 | LaTeX 公式能力不足 | **KaTeX → MathJax**：支持 `\ce` / `\require` / `\label` / `\eqref` |

## 关键设计取舍

**Mermaid 编辑区默认渲染**：`previewOnlyByDefault` 是全局布尔，直接设 true 会让*所有*代码块变只读预览。
解法是靠 `renderPreview` 返回值天然分流——非 mermaid/latex 返回 `null`（预览面板不渲染、编辑器不加 `hidden`，
**普通代码块行为完全不变**），命中图表类则默认显示渲染结果、点 Edit 仍可改源码。零 schema 改动、零副作用。

**MathJax 只换渲染层**：保留 Crepe 的 Latex Feature（schema + `remark-math` 解析），
让「Markdown 往返保真」红线继续由已验证实现承担。
- 行内 `$…$`：`math_inline` 原子节点，Crepe 渲染写在 `toDOM` 里调 katex 但**未注册 nodeView**
  → 补 `props.nodeViews.math_inline` 插件即可无冲突接管。
- 块级 `$$…$`：`language='latex'` 代码块走 `renderPreview`，Crepe 的 Latex Feature 会拦截，
  必须用 `editor.config(ctx => ctx.update(codeBlockConfig.key, …))` 在**其之后**覆盖
  （`featureConfigs` 不行——包裹发生在 Crepe 构造期）。
- 沙箱安全：用 `liteAdaptor`，实测**无任何 document/window 全局**也能渲染，
  不会重蹈 mermaid 缺 `Buffer` 的覆辙；输出 SVG(`fontCache:'none'`) 自包含，不依赖外部 CSS。

**脚注不做 DOM 注入**：编辑区只用点击委托 + CSS `↩` 提示，避免与 ProseMirror 托管 DOM 打架；
仅在导出副本（离屏）注入真实 `<a>` 锚点。

## 新增依赖
- `mathjax-full@^3.2.2`（CJS，Vite commonjs 插件正常转换；分块 AllPackages 375kB / svg 1.5MB）
- `markdown-it-emoji@^3.1.0`（**只用其 `lib/data/full.mjs` 词典**，不用其 markdown-it 插件）

## 新增文件
`src/editor/features/mathjax.ts`、`src/editor/features/emoji.ts`、`src/types/markdown-it-emoji-data.d.ts`

## 待运行期（GUI）验收
mermaid / 公式在编辑区的默认渲染观感；行内数学编辑浮层（Crepe `inlineLatexTooltip`）与自研 nodeView 的兼容性；
emoji 输入规则的触发时机；Ctrl+点击外链跳转。

## 说明：整篇 LaTeX 文档
`\documentclass…\begin{document}` 这类**完整 LaTeX 文稿**不属于 MathJax 的能力范围
（MathJax 渲染"数学"，不渲染 article 文档类）。行内/行间数学已全部支持；
若确有整篇文稿渲染需求，需另行引入 LaTeX.js 之类的方案。

---

# Markdown 渲染问题修复 · 第二轮（2026-08-30 晚）

用户对第一轮改动做运行期复验并补充新需求。本轮定位并修复确定 bug + 落地 4 类新内联语法。

## 关键修复：块级数学被 katex 覆盖（根因 bug）
上一轮块级 `$$…$$` 的 MathJax 覆盖用 `editor.config(...)` 写在 `create()` 之前，而 Crepe 的 Latex
特性在 `create()` 期间也会 `ctx.update(codeBlockConfig.key, …)` 用 katex 包裹，且排在前面 → 我的覆盖被盖掉，
`\label \eqref \ce \require` 以字面量出现。

**修复**：改用 `crepe.editor.use((ctx) => () => ctx.update(...))` —— `.use()` 特性排在构造函数里
`loadFeature` 注册的内部特性之后，`create()` 时 runner 按注册顺序执行，MathJax 包装成为**最外层**，
`latex` 语言最终命中 MathJax。（详见 `docs/ARCHITECTURE.md` §5.3.2 修订）

## mermaid 复验
带 polyfill 的 jsdom 无头测试确认 mermaid 11.17.2 在 `securityLevel:'strict'` 下
**flow / sequence / pie / gantt 全部成功出 SVG** —— 渲染能力本身没问题，编辑区默认渲染（§5.3.1）逻辑正确。
用户报"时序图/甘特图/饼图渲染不出来"疑为旧构建或源码模式，需 GUI 实跑确认。

## 新增：内联标记（§5.3.5）
`==高亮==` / `^上标^` / `~下标~` / `<kbd>` 在所见即所得以对应样式呈现。复用 emoji 的
「装饰 + 导出后处理」模式，**不引入新 schema**，源码一字不改、Markdown 往返保真红线稳保：
- `src/editor/features/inlineMarkup.ts`：`inlineMarkupDecorationPlugin` 给命中片段加 `.yj-*` 装饰（跳过代码/公式块）
- `src/export/domUtils.ts`：`replaceInlineMarkupInHtml` 导出时把片段落为 `<mark>/<sup>/<sub>/<kbd>`
- `src/export/docTemplate.ts` + `src/styles/editor.css`：接入导出流程并补样式

下标用单 `~`（避开 GFM `~~删除线~~`）；上标 `^…^` 内部禁空格/^，避免误吞行首锚点/公式。

## 验证
typecheck ✅ + clean build ✅（`✓ built in 14.50s`）。
**待 GUI 验收**：块级数学是否真走 MathJax（覆盖顺序无法无头验证）、mermaid 实跑观感、内联标记手感、kbd 导出。

## 说明：整篇 LaTeX 文档
`\documentclass…\begin{document}` 是**完整 LaTeX 文档**而非数学。放进 ```latex 围栏走块级数学时，MathJax
对 `\documentclass`/`\begin{document}` 报错 → 降级显示源码 + 提示。MathJax 渲染"数学"不渲染"文档类"；
若需整篇文档渲染需另引 LaTeX.js（待你拍板是否做）。
