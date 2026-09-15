# 已知问题归档：块级 `\eqref` 重载渲染为 `???`

> 状态：**已根治（2026-09-12）**
> 根因与修复见 §8。此前记载的两条——「`refAutoInputRule` 把裸 `\eqref` 转成数学节点」与「重载时序竞态」——
> 已分别被**代码检索**与**纯逻辑探针**证伪（见 §3、`docs/REVIEW-OPTIONAL-2026-09-11.md` §4）。
> 现按事实重写，勿再据此两版旧结论排查。

## 1. 现象（用户实测，2026-08-31）

- 正文裸写 `\eqref{eq:x}`，**手动重输当下**显示 `(1)` ✅
- **重新打开 / 重载文档**（从磁盘 Markdown 重新解析）→ 显示 `???` ❌

## 2. 已确证的实现事实（读 `src/editor/features/mathjax.ts`）

- 行内 `math_inline` 由 `MathInlineView` 接管（`nodeViews.math_inline`）：构造时同步 `render()`
  → `renderMathWithRef(value, false, token)`，含 `\ref/\eqref` 且 label 未登记时**入队 `pendingRefs` 挂起**。
- 块级 `latex` 代码块走 `codeBlockConfig.renderPreview` → `renderMathBlockPreview()` →
  `renderLatexContent()`（内部亦调 `renderMathWithRef(..., true)`）。
- MathJax 标签表挂在共享 `document` 上、**跨 `convert()` 保留**；`mj.hasLabel(label)` 可查。
- 唤醒接力：`renderMathToSvg()` 每渲染一个含 `\label{` 的公式就调一次 `flushPendingRefs()`。
- 三层保险：①入队后立即复查标签表；②`MAX_REF_ATTEMPTS = 3`；③1200ms 超时兜底。
- 切换文档 `resetMathNumbering()` 清空 `labelNumbers` / `nextLabelNumber` / `pendingRefs`。
- ⚠️ **代码里不存在 `refAutoInputRule`，也没有任何把裸 `\eqref{}` 转成数学节点的输入规则**
  （全库检索零命中）。故旧文档「手动重输→变 math_inline」的说法**无实现支撑**，不能作为排查依据。

## 3. 已排除的方向：重载时序竞态（纯逻辑层不复现）

用真实 `mathjax.ts`（与 `verify:md` 同法打包）跑时序探针：

| 场景 | 结果 |
| --- | --- |
| 行内引用先渲染 / 块级 `\label` 后渲染 | ✅ `(1)` |
| 块级先 / 行内后 | ✅ `(1)` |
| 入队后 token 销毁、同号 token 重建 | ✅ `(1)` |
| `reset` 后同批 inline + block | ✅ `(1)` |

→ 任何合理的重载时序都能结算成 `(1)`。**「逐节点异步竞态导致重载失效」在纯逻辑层不成立。**

## 4. 已修复（2026-09-11 补记）

- **三个连环坑**（详见 `docs/ARCHITECTURE.md` §5.3.2）：`tags:'ams'`（否则 `\label` 是空壳）、
  `data-c="3F"` 字形检测（否则 `???` 判断恒假、重试从未触发）、label→固定编号（杜绝编号漂移）。
- **token 失效挂起缺陷（2026-09-11 修）**：`\eqref` 节点的 pending 任务在其视图销毁后 token 失效时，
  `flushPendingRefs` 曾直接 `return`（既不 resolve 也不再入队），1200ms 兜底又因任务已出队而跳过
  → promise **永久挂起** → DOM 停在占位源码 `$…$`。现改为 `task.resolve(svg)` 结算（调用方有
  `mine !== this.token` 守卫，不会污染陈旧 DOM）；`verify:md` 新增断言覆盖（旧实现必失败）。

## 5. 根因复盘（2026-09-12 定论）

纯逻辑层已排除「逐节点异步竞态」，但此前把剩余可能笼统归到「app 层块级预览派发（`renderPreview`
是否被调用 / 调得够不够早）」——**这一推测方向是错的**。`renderPreview` 在重载路径**本来就会被调用**，
问题不在「有没有调用」，而在「调用得太晚」：

块级 `latex` 代码块走 CodeMirror 懒初始化（`IntersectionObserver → initializeCodeMirror → Vue 挂载 →
renderPreview`），其 `\label` 登记**经常晚于**行内 `\eqref` 的 `1200ms` 超时兜底。而行内引用一旦被兜底结算成
`(???)` 就**出队**了，`pendingRefs` 此后再也无法唤醒它——这正是「已超时 + label 晚到 + 旧 NodeView 不复渲染」
的局部生命周期同步缺口，与「预览派发是否存在」无关。详见 §8。

> 前两次「修复」（`e27e939` 误判 KaTeX 覆盖竞态、`12b85c2` 改接线致图片裂）都栽在**没定论根因就改代码**。
> 本次修复**不改任何预览/接线**，只在 NodeView 生命周期内补一条「晚到 label 通知」，属最小局部改动。

## 6. 接线铁律（事故回放）

- ❌ 改接线为 `crepe.editor.config(...)`（`12b85c2`）：该回调早于 `codeBlockConfig` 注册执行 →
  抛错中断 `init()`（在 `setupImageResolver()` 之前）→ **图片全裂**。必须保持
  `.use((ctx) => () => { ctx.update(codeBlockConfig.key, …) })`。
- ❌ 只加 InputRule 当「修复」：既不覆盖重载路径，且**当前代码本就没有该规则**。
- ❌ 把 `\eqref` 包进 `$$…\eqref…$$`：行间公式让引用失效 → `???`（用户最初正是因此误判功能坏）。

## 7. 用法（当前可用）

- 编号：`$$ \begin{equation}\label{eq:1} … \end{equation} $$`
- 引用：**正文裸写 `\eqref{eq:1}`**；**切勿 `$$ \eqref{eq:1} $$`**。
- 端到端重载行为已于 2026-09-12 根治（见 §8），重载文档后引用自动恢复为编号，无需手动重输。

---

## 8. 根治（2026-09-12）

**根因（局部生命周期同步缺口，非预览派发缺失）**：`pendingRefs` 只唤醒**尚未超时**的引用；一旦
`1200ms` 兜底把任务结算成 `(???)`，该任务出队。而块级公式的 `\label` 经 CodeMirror 懒初始化
（`IntersectionObserver → initializeCodeMirror → Vue 挂载 → renderPreview`）**经常晚于**该兜底才登记，
于是行内 `\eqref` 显示 `(???)` 后永不再刷新（用户删字符重输才恢复，正是 `update()` 重新触发了
`renderMathWithRef`）。

**修复（最小局部改动，见 `src/editor/features/mathjax.ts`）**：

1. 新增 `labelChangeListeners` 通知机制（与 `pendingRefs` 互补，不替换）：
   - `renderMathToSvg()` 在 `mj.convert` 后**确认 MathJax 标签表确有新 label**（`mj.hasLabel`），
     才调 `notifyLabelsChanged(labels)`；
   - `MathInlineView` 构造时 `onLabelsChanged(...)` 订阅：仅当「当前仍是引用公式、`refUnresolved(dom.innerHTML)`
     为 true（仍显示 `???`）、且新注册 label 命中其引用」时 `render()` 补渲染一次；
   - `destroy()` 中 `offLabels?.()` 退订，**避免旧 NodeView 被模块级监听器长期持有**；
   - 全程复用既有 token 守卫（`mine !== this.token`），**不新增异步竞态**、不覆盖用户刚编辑出的新内容。
2. 保留原有「排队重试 + 超时兜底」机制不变；`notifyLabelsChanged` 只负责**已超时、已结算**的那一类引用。

**验证（纯逻辑层，`verify-markdown.mjs`）**：

- `1b`：引用已超时显示 `(???)` 后，晚到 label 使**同一 NodeView** 自动恢复为 `(1)`（修复前必失败）；
- `1c`：无关 label 不触发错误恢复 / 无意义重渲染；
- `1d`：NodeView 销毁后，晚到 label 不更新旧 DOM、不抛异常、不残留 listener；
- `1e`：快速编辑（`eq:a → eq:b`），`eq:a` 的旧异步结果回来时**不覆盖**当前 `eq:b`。

**为什么不再需要做 DOM 取证**：根因是「已超时 + label 晚到」的确定性生活周期缺口，修复为不依赖
`renderPreview` 时序的最小通知机制；无论块级预览何时派发，晚到 label 都能把已 `???` 的引用拉回来。
接线铁律（§6）继续有效——本次**未触碰** `crepe.editor.config(...)`。
