# 可选审查项评估（2026-09-11）

> 对象：`docs/CODE-REVIEW-2026-09-10.md` §六 里列出的 4 项「非阻塞可选项」。
> 本轮只做**审查与取证**，未改任何生产代码。所有结论都有代码位置或可复现证据支撑。
> 目的：先证伪「这些项值不值得做、按什么形式做」，再决定动手。

## 结论速览

| # | 项目 | 判定 | 建议动作 |
| --- | --- | --- | --- |
| 1 | Sidebar / SnapshotPanel 抽 composable | **部分成立**，但「大」是 CSS 撑的，不是逻辑 | 抽 SnapshotPanel 的 **diff 引擎**（纯 util + 单测）；Sidebar 搜索块次之；其余不动 |
| 2 | `useTabs()` 抽取 | **基本冗余** | 不新建 composable；只把 `remapTabPaths` 收进已有 store |
| 3 | 语料矩阵扩到 math/frontmatter | **提法有误导** | frontmatter 不属 remark 链；math 需先给 harness 加 remark-math 才有意义；真正缺口是 `frontmatter.ts` 无测试 |
| 4 | `\eqref` 重载 `???` | **文档自相矛盾 + 提法失实**，且**发现一个真实挂起缺陷** | 先对齐文档、再按 DOM 证据修；切勿凭推测改 |

---

## 1. Sidebar.vue / SnapshotPanel.vue 抽取

### 先揭穿「1600 行大组件」的错觉

行数构成（脚本 / 模板 / 样式）：

| 文件 | `<script>` | `<template>` | `<style scoped>` | 合计 |
| --- | --- | --- | --- | --- |
| `Sidebar.vue` | 637 | 386 | 583 | 1611 |
| `SnapshotPanel.vue` | 372 | 255 | **861** | 1493 |

**两个文件的大头都是 scoped CSS，不是逻辑。** SnapshotPanel 尤其夸张：脚本仅 372 行，样式 861 行。
所以「1611/1493 行」不构成抽取理由——真正该看的是脚本里的关注点密度。

### Sidebar.vue 的关注点（脚本 637 行）

1. **搜索引擎**（约 87–306 行，≈220 行）：`searchScope/searchQuery/选项/防抖/watch/flatHits/命中导航(go·next·prev)/替换(askReplace·doReplace)/rederiveCurrentLine/focusSearch`。
2. **文件树状态**：`expanded/editingPath/selectedPath` + `expand/toggle/expandAncestors`。
3. **CRUD 编排**：`createNewFile/Folder、doRename、doDelete、doMove、onMenuSelect`。
4. **拖拽调宽** `startDrag`；5. **toast**。

搜索块是**最干净的抽取候选**：依赖面极窄（`props.activePath` / `props.vaultPath` + `showToast` + 3 个 emit：`find-highlight` / `open-result` / `replaced`），自成一界。
CRUD 块与 App 耦合较深（要 `emit('moved'/'delete-node/'renamed')`、迁移展开态），抽出去只是把胶水挪个位置，收益低。

### SnapshotPanel.vue 的关注点（脚本 372 行）

1. **快照/分支/标签 CRUD**：基本是 `useSnapshotsStore()` 的胶水 + 少量本地态。
2. **diff 引擎**（149–316 行，≈170 行）：`diffRows / diffHunks(+行号累计) / splitPairs(+SplitRow) / diffStats / diffMode / diffSource / deltaChars`。
3. **对比选择与内容加载**：`compareA/B` + 三个 `watch` 读快照。

**diff 引擎是纯逻辑**（两段文本 → 结构），零 Vue 依赖，`diffHunks` 的行号累计逻辑（`baseOld/baseNew` 推进）**极易出错且当前无任何测试**。这是全场最高价值抽取项。

### 建议

- **做**：把 diff 引擎抽成 `src/utils/snapshotDiff.ts`（纯函数：`buildDiffRows(a,b)`、`buildHunks(rows)`、`splitPairs(rows)` + 类型），并进 `test-core.mjs` 加断言（hunk 边界、行号、split 配对、空 diff）。**这是 util，不是 composable**——纯逻辑不该藏在组件里。
- **可做**：`useSidebarSearch()`（把搜索/替换整块搬出）。价值中等，主要收益是可单测命中导航。
- **不做**：Sidebar 的 CRUD 块抽 composable——只会搬家不减熵。

---

## 2. `useTabs()` 抽取

**现状：标签状态层已存在** —— `src/store/tabs.ts` 的 `useTabsStore()`，已含
`tabs / activePath / activeIndex / paths / has / open / activate / close / closeOthers / closeToRight / restore`。

App.vue 里剩下的「标签相关」代码全是**编排胶水**，每条都同时牵动 4 个外部依赖：

| App.vue 函数 | 依赖 |
| --- | --- |
| `onRenamed / onMoved` | `markProgrammatic`（watcher 抑制）+ `patchSession` + `refreshTree` |
| `onDeleted / onDeleteNode` | 递归关标签 + `host.cancelPendingSave` + `deleteItem` + `syncEditorToActive` |
| `closeTab` | `host.save()` + `host.dirty` + `patchSession` + `syncEditorToActive` |
| `activateTab / closeOthers / closeToRight` | store + `patchSession` |

把这些塞进 `useTabs()` 需要注入 5–6 个依赖，**只是把 300 行胶水从 App.vue 挪到另一个文件**，认知负担不变，反而多一层间接。

**唯一确实放错位置的**是 `remapTabPaths(oldPath,newPath)`（App.vue 165–192）：它是纯粹的「标签列表前缀重映射 + activePath 迁移」，不碰编辑器/会话/文件树，**天然属于 tabs store 的一个 action**（如 `remap(oldPath, newPath): { activeChanged, immune }`）。

### 建议
- **不新建 `useTabs()`**。
- 把 `remapTabPaths` 收进 `useTabsStore` 作为 `remap` action（顺带可单测：文件夹前缀批量重映射、嵌套标签、activePath 命中）。
- 其余编排胶水留在 App.vue——它本质是「App 级协调」，不该被 composable 藏起来。

---

## 3. 语料矩阵扩展（math / frontmatter）

### 核心问题：语料 harness 的流水线比真实编辑器窄

`scripts/verify-corpus.mjs` 的流水线只有：
`remarkParse + remarkGfm + remarkWikilink + remarkTag + remarkHtmlInline + handlers + remarkStringify`。

而真实编辑器（Crepe，`[Crepe.Feature.Latex]: true`，见 `MilkdownEditor.vue:408`）**内部还挂了 remark-math**。
两者对 `$…$` 的解析结果**不同**：

- 语料 harness 无 remark-math → `$x$` 当**普通文本** → 往返必然一致 → **假绿**。
- 编辑器有 remark-math → `$x$` 是 `math_inline` 节点 → 走 schema runner 序列化。

所以「往 corpus 丢一个 math 的 .md」在当前 harness 下**测不到真实路径，是假覆盖**。要让 math 语料有意义，**必须先给 `verify-corpus.mjs` 的流水线补上 remark-math**（对齐 Crepe），这是改 harness，不是「丢个 .md」。

### frontmatter 根本不走 remark 链

项目里 frontmatter 是**独立层**：`src/editor/frontmatter.ts` 的 `parseFrontmatter / serializeFrontmatter`，
被 `App.vue`（MOC 标记、属性面板、导出元信息）直接调用。编辑器里它是「先剥掉 YAML 头 → 只编辑正文 → 再拼回」。
把它做成 corpus 的 `.md` 会被 remark 当成 `***` 分隔线 + 正文 → 与真实行为**南辕北辙**。

**真正的缺口**：`frontmatter.ts` 的 parse/serialize **没有任何直接测试**。它的核心承诺是
「**正文逐字保留，只改写顶部 YAML 块**」——这是数据保真红线，一旦 serialize 吞掉正文就是事故。
这条应进 `test-core.mjs`（纯函数，零依赖），**不是 corpus**。

### 真正值得补的 corpus 用例（同一流水线内）
- gfm：[^脚注]、任务列表边界、删除线、自动链接、表格转义/对齐变体；
- 硬换行（行尾两空格 / `\`）、围栏 `~~~`、带 meta 的围栏；
- 块级 HTML（`<div>`）与 `htmlInline` 的边界；
- 链接引用定义 `[a]: url`、实体与转义（`&amp;`、`\#`）；
- 更深嵌套；wikilink/tag 的边界（空 target `[[]]`、`[[a|b|c]]`、`#` 后接标点）。

### 建议
- **不要**为了「补 math/frontmatter」直接丢 .md——先决定 harness 是否补 remark-math。
- **优先**：给 `frontmatter.ts` 加 `test-core` 断言（正文逐字保留 / 无 frontmatter 时不动 / YAML 特殊字符）。
- **其次**：补上面「同一流水线内」的语料，价值实打实。

---

## 4. `\eqref` 重载显示 `???`

### 4.1 文档自相矛盾，且引用了不存在的符号

- `docs/ARCHITECTURE.md §5.3.2`：称 `\eqref` 于 2026-08-31 **已根治**（记录三坑：`tags:'ams'` / `data-c` 检测 / 编号漂移）。
- `.workbuddy/memory/EQREF-KNOWN-ISSUE.md`：称**未解决**，重载仍 `???`。
- `docs/PHASE3-PLAN.md`：第 50 行标 `✅ 批次零` 已完成；第 100 行又写 `⚠️ 未解遗留`。**同一文件内自相矛盾。**

更关键：`EQREF-KNOWN-ISSUE.md` 把「手动重输 → 变 math_inline」归因于 `refAutoInputRule` ——
**该符号在整个代码库零匹配**（`grep refAutoInputRule` 无结果）。项目里**没有任何把裸 `\eqref{}` 转成数学节点的输入规则**，也没有 `remark-math` 的显式引入。

> 含义：这份「已知问题」文档描述的是一条**当前并不存在**的机制。它不能作为修复的依据。

### 4.2 纯逻辑层：文档的"重载竞态"假设**不复现**

用真实 `mathjax.ts` 模块（与 `verify-md` 同一打包手法）跑重载时序探针，结果：

| 场景 | 结果 |
| --- | --- |
| A 行内 `\eqref` 先渲染（`display=false`）/ 块级 `\label` 后渲染 | ✅ `(1)` |
| A2 同上 + token 有效 | ✅ `(1)` |
| B 块级先 / 行内后（"手动重输"类比） | ✅ `(1)` |
| C 入队后 token 销毁、同号 token 重建 | ✅ `(1)` |
| D 入队后 **token 永久失效**（无继任） | ⚠️ **永久挂起**（promise 永不 resolve） |
| E `reset` 后同批 inline+block | ✅ `(1)` |

**任何合理的重载时序都能解析成 `(1)`**。也就是说：`renderMathWithRef` 的「排队 + 注册后 flush」接力
（pendingRefs / flushPendingRefs / 1200ms 兜底）**在纯逻辑层是有效的**——`verify-md` 的 test #1 早已覆盖此路径。

### 4.3 探针揪出的**真实缺陷**（文档未记载）

**场景 D**：`\eqref` 内联节点的 pending 任务若在其「视图销毁」后失去有效 token，
`flushPendingRefs` 会走到 `if (task.token > 0 && !isTokenValid(task.token)) return` —— **直接 return，既不 resolve 也不重新入队**；
而 1200ms 兜底又因 `pendingRefs.indexOf(task) < 0`（任务已被 flush 取出）而跳过。
→ `renderMathWithRef` 的 promise **永久挂起** → `MathInlineView` 的 `.then` 永不执行 → DOM 停在占位文本 `$…$`。

现有 `verify-md` 的 test #8 只测了「label 不存在 → 3s 兜底返回 `???`」，**没测 token 失效这条**，所以漏网。

（注意：该缺陷表现为**占位源码卡住**，不是 `???`。因此它**不是**用户所报 `???` 的直接解释，但是一个必须独立修的真 bug。）

### 4.4 那 `???` 到底怎么来的？

要让内联引用**结算**为 `???` 并**持久**，只有一个条件：**块级公式的 `\label` 在引用耗尽重试前始终没登记**。
纯逻辑已排除时序问题，所以故障只可能在 **app 层的块级预览派发**：
`codeBlockConfig.renderPreview('latex', …)` 在重载时**到底有没有被调用 / 调得够不够早**，
以及 Crepe 的 `Latex` 特性是否在 `replaceAll` 这条路径上派发了预览。

**这必须靠运行中的 app 抓 DOM 才能定论**——正是 `EQREF-KNOWN-ISSUE.md` 自己要求的验证，
而它此前两次「修复」都栽在没做这一步就改代码。

### 建议
1. **先对齐文档**（唯一事实源）：把三处矛盾合并，删掉对 `refAutoInputRule` 的引用，明确当前未解。
2. **先取证**：在 Electron 里重载含 `\eqref` 的文档，抓（a）内联节点 DOM 到底是不是 `MathInlineView` 产出、
   （b）块级 `renderPreview` 是否被调用、（c）`mj.hasLabel('eq:x')` 在引用结算前是否变 true。
3. **修 D 的挂起**（低风险、可测）：token 失效时应 `resolve` 最后一版 SVG（或按 `MAX_REF_ATTEMPTS` 结算），
   而不是静默丢弃；补一条 `verify-md` 回归断言。
4. **勿凭推测改块级预览接线**——`12b85c2` 的教训（改接线会中断 init → 图片裂）仍在。

---

## 推荐优先级

1. **修 4.3 的挂起**（真实缺陷、可复现、可单测、改动局部）。
2. **抽 SnapshotPanel diff 引擎 + 单测**（纯逻辑、高价值、零风险）。
3. **`frontmatter.ts` 加 test-core 断言**（数据保真红线，当前零覆盖）。
4. `remapTabPaths` 收进 tabs store。
5. `\eqref`：对齐文档 → 抓 DOM 取证 → 再决定是否实施「文档级两遍渲染」。
6. 语料扩展：先定 harness 是否补 remark-math，再补 gfm/转义/HTML 块等真能覆盖的用例。
