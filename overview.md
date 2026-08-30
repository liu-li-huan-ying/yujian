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
- **所见即所得模式** `src/editor/find-wysiwyg.ts`：`createFindDecoPlugin`（`$prose` 注册，与凝神同机制）用 ProseMirror `Decoration.inline` 对称高亮全部命中、当前结果行打 `.pm-find--current`；`currentLine` 经 `doc.textBetween` 统计换行映射到文档行号；文档编辑 / 切换文档经 `tr.docChanged` 跟随重算。`MilkdownEditor` 暴露 `setFind(fs|null)`，经 `view.dispatch(tr.setMeta(findKey, fs))` 驱动。
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
放弃 ‹ › 逐个步进，换来**零代码冗余**与两种范围完全一致的交互；但**保留了两端命中常驻高亮**（用户认可源码模式高亮，并进一步补回所见即所得对称高亮）。高亮完全由统一搜索的 `query/opts` 驱动，与「全部 / 本文档」共用一套逻辑，无独立查找引擎冗余。命中定位仍可靠（点击命中行即跳到源码模式对应行并精确滚动）。

## 验证
- `npm run typecheck` + `npm run build` 预期通过（本任务末执行）。
- 网络仍不通：完成本地 commit，暂不 push。
