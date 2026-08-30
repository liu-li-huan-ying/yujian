# 搜索重构：单引擎双范围（全部 / 本文档）

## 做了什么
把「单文档查找」与「文件夹全文搜索」**统一为同一套检索引擎**，仅靠「范围」区分，彻底删除独立的编辑器内查找实现，消除代码冗余。

- **主进程 `electron/main/vault.ts`**：`searchVault(root, query, opts?, file?)` 与 `replaceInVault(root, query, replacement, opts?, file?)` 各加可选 `file` 参数。
  - 传 `file` → 只搜这一个文件（不递归）=「本文档」范围；
  - 不传 `file` → 递归整个 vault =「全部」范围。
  - 后端按行切分命中、替换回写、原子写两套范围完全共用。IPC `VAULT_SEARCH`/`VAULT_REPLACE` 与 preload 签名同步透传 `file`。
- **前端 `Sidebar`**：只保留一个搜索框 + 一个 `SearchResults` 渲染器 + 一个替换面板。`scopeFile()` 在「本文档」返回 `props.activePath`、在「全部」返回 `undefined`，作为第 4/5 实参传入。命中结果一律**点击跳转**（复用 `onOpenResult(path, line)` → `EditorHost.revealLine`）。

## 删除的部分（2026-08-30）
- `src/editor/find-source.ts`（CodeMirror 高亮）、`src/editor/find-wysiwyg.ts`（ProseMirror 装饰）、`src/editor/docFindApi.ts`（`DocFindApi` 契约）三个文件已删除。
- `EditorHost` 的 `find/findNext/findPrev/replaceOne/replaceAll/clearFind/findCurrent/findTotal` 暴露与内部状态全部移除；`SourceEditor.getView()`、`MilkdownEditor` 的 `createFindDecoPlugin` 注册一并移除。
- `editor.css` 的 `.cm-find` / `.pm-find` 高亮样式（33 行）已删除。
- i18n 删除不再使用的 `docHits` / `noMatchInDoc` 键；指南第 3 节改为描述「共用同一套检索逻辑、命中点击即跳转」。

## 外观与交互细节
- `.scope` 玉质胶囊分段控件（全部 / 本文档）；`.chip` 选项芯片（Aa / ⌗）；`.status`/`.hint` 状态行，延续玉质/玻璃设计令牌。
- `Ctrl+F` 接线 → 聚焦左侧搜索框（默认范围：有打开文档时「本文档」，否则「全部」）。
- `SearchResults` 用 `singleFile` 属性区分元信息：「本文档」显示「N 处命中」，「全部」显示「N 处命中 · M 个文件」。
- 回车（`onSearchEnter`）跳到第一条命中。

## 文档与辅助面板
- 使用指南第 3 节改写为统一检索；README「搜索（双范围）」与「文件内查找 / 替换」两段同步为「共用同一套引擎、仅范围不同」；ARCHITECTURE §5.9 改写为单引擎 file 范围。
- `scFind` 为「聚焦搜索」；快捷键面板含「搜索」分组（Ctrl+F）。

## 取舍
放弃编辑器内逐命中常驻高亮 + ‹ › 步进（即最初"所见即所得下只跳转不够直观"的体验），换来**零代码冗余**与两种范围完全一致的交互；命中定位仍可靠（点击命中行即跳到源码模式对应行并精确滚动）。

## 验证
- `npm run typecheck` + `npm run build` 预期通过（本任务末执行）。
- 网络仍不通：完成本地 commit，暂不 push。
