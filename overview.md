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
docx（`docx` 包）与 ePub（`jszip` 手写 OPF / NCX）。（多文件合订、导出前预览已于 2026-08-30 落地。）
