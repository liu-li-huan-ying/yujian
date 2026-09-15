# 结构与解耦审计（2026-09-15）

> 范围：`src/` + `electron/` + `scripts/` + 仓库文件组织；**不评估功能正确性**（那由 `npm run check` 与运行验收负责）。
> 基线：`docs/AUDIT-2026-09-14.md`（前一日的质量审计）· `docs/ARCHITECTURE.md`。
> 方法：`node scripts/analyze-structure.mjs`（只读诊断）产出 `docs/_structure-analysis.md`，本文所有数字均为该脚本实测。
> 目标（主人指令）：**细颗粒解耦，严禁累积胖文件；在不影响功能的前提下，把文件管理 / 代码管理 / 架构管理 / 逻辑管理做到教科书级清爽。**

---

## 零、总体结论

代码纪律层（类型、lint、编码、往返保真、测试）**已经很好**；短板集中在**结构层**，且有四类问题已从「不够优雅」退化为**真实缺陷**——它们不是风格问题，是会咬人的：

1. **存在 1 组循环依赖**（4 个文件）——模块级互引，改不动、测不了。
2. **存在 3 处分层越界**——**主进程直接 import 渲染层源码**、导出层 import 编辑器层。三进程边界与可测性同时被破坏。
3. **31 处重复的错误归一化惯用法** + **2 份并行的 mermaid 懒加载单例**——同一件事写了两遍以上。
4. **一个「单一事实源」文档不在版本库里**——`EQREF-KNOWN-ISSUE.md` 位于被 gitignore 的 `.workbuddy/` 下，克隆者看不到。

另有 2 个文件是明确的上帝模块（`electron/main/vault.ts` 混 7 类职责；`App.vue` 扇出 45），以及 `docs/` 19 个平铺文件无分类。

**核心判断**：本项目的问题不是「代码写得差」，而是**缺少结构约束**——上一轮加的 `check-structure.mjs` 只盯行数、`any`、遗留标记三个硬指标，管不到循环依赖、分层越界与职责混装。故本轮的重心是**把结构规则变成可执行门禁**，而不是只做一次性清理。

---

## 一、架构缺陷（必修：会咬人，非风格问题）

### A1｜循环依赖：导出调度器 ↔ 各格式实现（4 文件环）

实测（`analyze-structure.mjs` §1）：

```
src/export/serialize.ts → docx.ts, epub.ts, odt.ts
src/export/docx.ts / epub.ts / odt.ts → serialize.ts
```

**根因**：环不是由运行时代码造成的，而是由**一个契约类型放错了位置**造成的。

```ts
// serialize.ts —— 它是「调度器」
export interface SerializeCtx { title: string; author?: string; date?: string }

// docx.ts / epub.ts / odt.ts —— 它们是被调度者，却反过来 import 调度器的类型
import type { SerializeCtx } from './serialize'
```

即**依赖方向反了**：实现依赖了「使用它的调度器」。教科书解法是依赖倒置——契约下沉到中立的 `types.ts`，于是调度器依赖实现、实现只依赖契约，环自然消失。

**危害**：调度器改动会牵动所有实现；单测任一种格式都要连带拖入整个调度器；新增格式时必须回头改调度器再被它反向引用，容易再长出一个环。

**验收**：`analyze-structure.mjs` §1 无环；新增格式无需修改任何既有文件即可注册（除调度器的 `switch` 分支）。

### A2｜分层越界：主进程 import 渲染层源码 ⚠️ 最严重

实测：

```
electron/main/vault.ts:36  import { buildRegex } from '../../src/utils/regex'
```

**这是三进程架构的实质性破坏**：`electron/main/` 是主进程，`src/` 是渲染层。主进程直接引用渲染层源码意味着——

- 渲染层一旦引入 DOM / `window` / Vite 特有语法，**主进程构建会一起崩**；
- 「共享代码」没有中立位置，往后每多一处共享就多一条越界边；
- 破坏了 `electron.vite.config.ts` 里两条独立构建管线的前提。

前一日刚把 `vault.ts` 与编辑器内搜索「收敛到同一实现」（§5.32.1），**方向正确但落点错了**：单一来源不该落在渲染层，而该落在 `electron/shared/`——那才是本项目为三进程共享契约预留的位置（`ipc-channels.ts` / `wikilink-syntax.ts` 就在那儿）。

**验收**：`electron/**` 不再出现指向 `src/**` 的 import；`analyze-structure.mjs` §2 中「主进程不得 import 渲染层」规则零命中。

### A3｜分层越界：导出层 import 编辑器层

实测两条边：

```
src/export/docTemplate.ts  → src/editor/features/mathjax.ts   （renderLatexContent）
src/export/exportMeta.ts   → src/editor/frontmatter.ts        （parseFrontmatter）
```

**判读**：这不是「多引了一个文件」，而是**两个文件放错了层**：

- `mathjax.ts`（659 行）是**渲染引擎适配**，被编辑器、导出、组件三方共用——它不是「编辑器的私有特性」，放在 `editor/features/` 下才导致越界。同理 `mermaid.ts`。
- `frontmatter.ts` 是**Markdown 语法处理**，被 `App.vue`、`WritingAidsPanel.vue`、`export/exportMeta.ts` 共用，与 ProseMirror 无关。放在 `editor/` 下同样错位。

**危害**：`src/export/**` 是项目里少有的「可在 Node 下直接测」的纯逻辑层（`exportMeta` 的 `[T]` 段即靠此）。一旦它 import 编辑器层，测试就会连带拽入 Milkdown / DOM，这层就失去可测性——这是**可测性被分层污染拖垮**的典型案例。

**验收**：`src/export/**` 与 `src/utils/**` 不 import `src/components/**`、`src/editor/**`；`mathjax` / `mermaid` 迁到中立渲染层，`frontmatter` 迁到 markdown 层。

### A4｜重复实现：两份并行的 mermaid 懒加载单例

| 文件 | 行数 | 用途 | theme |
| --- | --- | --- | --- |
| `src/editor/features/mermaid.ts` | 117 | 编辑器内代码块预览 | 跟随应用明暗 |
| `src/export/mermaidSvg.ts` | 57 | 导出时内联 SVG | `default` + 指定字体 |

两份各自维护 `mermaidPromise` 缓存、各自 `loadMermaid()`、各自 `mermaid.initialize()`。第二份的注释还写着「**复用同一套能力，不新增依赖**」——**注释表达了意图，代码没有兑现**：它确实是同一个依赖，但却是第二套初始化。

**危害**：mermaid 是重依赖（1.3MB × 多种图表，已独立 chunk）。两份初始化意味着主题、字体、`securityLevel` 等配置要改两处，且极易漂移——尤其本项目有条铁律是「编辑器里看到的与导出的必须一致」（MathJax 正是为此刻意共用 `mathjax.ts`）。**同一个理由在这里没有被贯彻。**

**验收**：单一 `loadMermaid()` + 单一 `renderMermaidSvg(code, opts)`；编辑器与导出都从它取。

### A5｜仓库卫生：权威文档不在版本库

```
.workbuddy/memory/EQREF-KNOWN-ISSUE.md   ← 7477 字节，.workbuddy/ 被 .gitignore 排除
```

该文件是 `\eqref` 那个「顽固 `???`」问题的**单一事实源**（记忆与 CHANGELOG 都指向它）。但它位于智能体工作目录、不进版本库——**别人克隆下来，这个项目最难的一个 bug 的完整根因分析就凭空消失了**。同时 `git ls-files` 确认它未被跟踪。

**其他卫生问题**：

- 根目录游离文档 `overview.md`（344 行，内容为「搜索重构」设计记录，未在 `ARCHITECTURE.md` 覆盖）——放在仓库根而非 `docs/`。
- `docs/` 19 个平铺文件，计划 / 设计 / 评审 / 审计混在一起，无分类，也没有索引表明**哪份是权威现状、哪份是历史快照**。
- 本地 `tmp/` 残留 7 个一次性脚本、根目录 `_check.log`（均已 gitignore，属本地卫生）。

**验收**：`docs/` 有分类子目录与 `README.md` 索引；权威文档全部入库；生成物（分析报告）标记为不追踪。

---

## 二、上帝模块与胖文件

### B1｜`electron/main/vault.ts`：1135 行 / 12 导出 / **7 类职责**

实测其顶层结构，混装了 7 件互不相关的事：

| # | 职责 | 代表符号 | 应归属 |
| --- | --- | --- | --- |
| 1 | 文件系统原语 | `exists` / `isPermError` / `clearReadOnlyRecursive` / `trashOrRemove` / `copyRecursive` | `fs-util.ts` |
| 2 | 中文数字排序（**纯逻辑**） | `cnDigit` / `cnUnit` / `parseCnNumber` / `tokenize` / `humanCompare` | `cn-sort.ts` |
| 3 | 库根解析 / 程序化变更标记 | `resolveVaultRoot` / `markProgrammaticChange` | `vault-root.ts` |
| 4 | 文件树读 + 建文档 / 文件夹 | `scan` / `listTree` / `createDoc` / `createFolder` | `tree.ts` |
| 5 | 改名 / 删除 / 移动（关联数据迁移 + 引用改写） | `renameItem` / `deleteItem` / `moveItem` | `mutations.ts` |
| 6 | 索引生命周期 | `ensureIndex` / `getLiveIndex` / `reindexFile` / `deindexFile` / `scheduleSave` | `index-store.ts` |
| 7 | 目录监听 / 搜索替换 / 链接检查 | `watchVault` / `searchVault` / `replaceInVault` / `checkLinks` | `watcher.ts` / `search.ts` / `link-check.ts` |

**收益（不只是行数）**：

- 第 2 类（中文数字排序）是**当前完全无法断言的纯逻辑**——`humanCompare` 决定文件树里「第 2 章 vs 第 10 章」的排序，是用户天天看得见的逻辑，却因为埋在 1135 行大文件里而没进测试。拆出即可测。
- 第 5 类是数据安全红线所在（关联数据必须跟着走），却与文件系统原语、中文排序混在一个文件里。拆开后「改删除逻辑」不再需要通读 1135 行。

### B2｜`App.vue`：1590 行 / **扇出 45**

全项目扇出第一名，远超第二名（`MilkdownEditor.vue` 19）。它是标准的**协调型上帝组件**：所有能力都在此接线，于是任何能力变动都先改它。

前两轮已抽走导出与命令面板热键（`useExport` / `paletteHotkey`，合计 −205 行）。剩余可抽块：快照/标签/图谱视图入口、文件操作编排、快捷键派发。

### B3｜其他 ≥600 行文件（16 个，占 13%）

| 行数 | 文件 | 判读 |
| --- | --- | --- |
| 1590 | `src/App.vue` | 见 B2 |
| 1437 | `src/components/Sidebar.vue` | 搜索已抽，剩余为文件树交互 |
| 1378 | `src/components/SnapshotPanel.vue` | 列表 / 时间轴 / 分支 / A-B 对比 / diff 五块视图混装 |
| 1135 | `electron/main/vault.ts` | 见 B1 |
| 1046 | `electron/main/vaultIndex.ts` | 元数据解析 + 索引构建 + 双链查询 + 标签 / MOC / 未链接提及 四类混装 |
| 895 | `src/editor/MilkdownEditor.vue` | 扇出 19，编辑器接线 |
| 852 | `src/components/GraphView.vue` | Canvas 绘制 + 力导布局 + 面板 |
| 729 / 723 | `src/i18n/locales/*.ts` | **数据文件，不拆**（拆反而难维护） |
| 694 | `src/editor/EditorHost.vue` | 双模式（源码 / 所见即所得）宿主 |
| 659 | `src/editor/features/mathjax.ts` | 见 A3，应迁至渲染层 |
| 655 / 650 / 645 / 618 / 615 | `TagPanel` / `IntegrityPanel` / `ipc-channels` / `main/index` / `ShortcutsSettings` | 次级目标 |

**关于 `ipc-channels.ts`（645 行 / 59 导出 / 扇入 34）的诚实判断**：它确实是「共享类型杂物抽屉」，混了 10 个 IPC 域的类型与常量。但其中绝大部分是**纯类型**（构建时擦除），拆成 8 个文件只是增加 import 记账、并不降低真实耦合。**故本轮不拆**——避免为了«看起来清爽»而制造无收益的 churn。真正值得拆的是其中**运行时常量**（通道名）与类型的分野，纳入观察项而非本轮目标。

---

## 三、逻辑管理（DRY）

### C1｜31 处重复的错误归一化

实测同一表达式被抄了 **31 遍**（另加 3 处同名函数定义）：

```ts
e instanceof Error ? e.message : String(e)
```

分布在 20 个文件：`App.vue`×2 · `IntegrityPanel`×3 · `ImgHostSettings`×2 · `BackupPanel`×2 · `TagPanel`×3 · `MocPanel`×2 · `useExport`×4 …

**危害**：这是「错误提示文案」的唯一来源。真要改（例如剥掉 Electron IPC 包装前缀、过滤掉无意义的 `Error:` 前缀），得改 31 处且必然漏。属典型**该抽未抽**。

### C2｜`showToast` 有两套

`App.vue:514`（全局，支持 `ok/err/info` + 时长）与 `Sidebar.vue:431`（侧栏私有，自带 `toast` ref + `timer` + 模板）。同一应用两套提示机制、两套样式、两套生命周期管理。

### C3｜路径工具重复

`src/utils/path.ts` 仅有 `baseName`（5 行），而 `Sidebar.vue:144` 自己写了 `parentDir`，多处自行 `split(/[\\/]/)`。路径规范化逻辑散落，且 `path.ts` 只有 5 行说明**该收敛而未收敛**。

### C4｜17 处 `setTimeout` 定时器样板

「存句柄 → 用前 clear → 卸载时 clear」在 17 处重复（App / FileTree / GraphView / MathEditPanel / MocPanel / ReadingProgress …）。是否值得抽需看形态是否一致——**观察项**，若形态统一则抽 `useTimeout()`。

---

## 四、可执行建议（按 ROI 排序）

| # | 建议 | 预期收益 | 成本 |
| --- | --- | --- | --- |
| 1 | **契约下沉**：`SerializeCtx` → `export/types.ts` | 消除唯一循环依赖 | 极低 |
| 2 | **共享层归位**：`regex.ts` → `electron/shared/` | 消除主进程越界（最严重） | 低 |
| 3 | **层归位**：`mathjax`/`mermaid` → 渲染层；`frontmatter` → markdown 层 | 消除导出层越界，保住可测性 | 中 |
| 4 | **mermaid 合并**：单一 `loadMermaid` + `renderMermaidSvg(code, opts)` | 消除重复实现，主题不再漂移 | 低 |
| 5 | **错误归一化收敛**：`src/utils/error.ts` 的 `errMsg()` 替换 31 处 | 文案单一来源 | 低 |
| 6 | **拆分 `vault.ts`**：按 7 类职责拆 7 个文件 + 门面 `index.ts` | 解锁中文排序可测；数据安全逻辑独立 | 中高 |
| 7 | **拆分 `vaultIndex.ts`**：解析 / 索引 / 双链 / PKM 查询四块 | 主进程第二大胖文件 | 中高 |
| 8 | **组件瘦身**：`SnapshotPanel` → 抽 composable；`App.vue` 继续抽 | 降扇出、解锁可测 | 中 |
| 9 | **文件管理**：`docs/` 分类 + 索引；`EQREF-KNOWN-ISSUE.md` 入库；根目录清理 | 仓库自解释 | 低 |
| 10 | **门禁升级**：循环依赖 + 分层越界 + 按目录行数上限入 `check:structure` | **让劣化无法回来** | 低 |

**明确不做**（避免为了好看而 churn）：

- 不重命名 `src/components/` → `src/ui/`：纯外观改动，牵动 ~50 处 import，风险大于收益。
- 不拆 `i18n/locales/*.ts`：数据文件，拆开更难维护。
- 不拆 `ipc-channels.ts`：主体是构建期擦除的类型，拆只增记账。
- 不引入组件测试框架：ROI 不如「抽纯逻辑 + 现有 `bundle()` 体系」。

---

## 五、验收标准

1. `node scripts/analyze-structure.mjs`：循环依赖 0、分层越界 0。
2. `npm run check` 全绿（含升级后的 `check:structure`）。
3. 门禁新增三条硬规则，且能拦住人为回归：
   - 循环依赖（SCC）不得出现；
   - 分层越界（主进程→渲染层、导出层→编辑器层、渲染层→主进程实现）不得出现；
   - 生产文件行数上限按目录收紧，`electron/main/` 单文件 ≤ 450 行。
4. 功能零回归：`test-core` / `verify:markdown` / `verify-corpus` / `build` 全通过，且断言数只增不减。
5. `git ls-files` 能查到全部权威文档；`docs/README.md` 说明每份文档的性质与权威性。

---

## 六、落实结果

（本节在改造完成后据实填写，供下次审计直接对照。）

按「波次」推进，每波都要求**零功能变更 + 门禁全绿 + 调用方零改动**。

| 波次 | 内容 | 结果 |
| --- | --- | --- |
| Wave A/B | 建议 1~5：契约下沉、`regex`/`error` 归位到 `electron/shared/`、`mathjax`/`mermaid`/`frontmatter` 层归位、mermaid 单例合并 | 已落地，提交 `5879297`。循环依赖 0、分层越界 0；`errMsg()` 收敛 31 处 |
| Wave C | 建议 6：`vault.ts` 1134 行 → `vault/` 包 9 文件（最大 431） | 已落地，提交 `a68608d`。函数/常量/公开导出 100% 在位；`humanCompare` 变为可测纯函数 |
| Wave D | 建议 7：`vaultIndex.ts` 1045 行 → `vaultIndex/` 包 9 文件（最大 272） | 已落地，提交 `e1b8d1f`。删掉 `writeAtomic` 二行包装；门面导出面与原文件一致 |
| Wave E | 建议 7 续：`electron/main/index.ts` 618 行 → 29 行引导 + `assetProtocol.ts` + `window.ts` + `ipc/` 9 域模块 + 总注册口 | 已落地。53/53 IPC 接线计数一致、5 个函数符号全保留、产物含全部通道字符串 |
| Wave F | 建议 10：门禁升级 | 已落地。`check:structure` 从 3 条规则扩到 6 条，新增「无循环依赖 / 无自环 / 无分层越界」三类 + `electron/main/` 450 行目录级上限 |
| 待做 | 建议 8（`App.vue` / `SnapshotPanel` 继续瘦身）、建议 9（`docs/` 分类索引、`EQREF-KNOWN-ISSUE.md` 入库、根目录清理） | 未做 |

### 验收标准逐条核对（§五）

1. ✅ `analyze-structure.mjs`：循环依赖 0、分层越界 0。
2. ✅ `npm run check` 全绿（typecheck / lint / check:encoding / test / verify:md / verify:corpus / check:structure）。
3. ✅ 门禁新增三条硬规则，且**验证过能拦住人为回归** ——
   （a）循环依赖 SCC 检测：注入 `ipc/win.ts → ipc/index.ts` 后门禁报红并精确指出
   `ipc/win.ts ↔ window.ts ↔ ipc/vault.ts ↔ ipc/index.ts` 四点环，还原后恢复绿；
   （b）分层越界三规则（渲染层 ↛ 主进程实现、主进程 ↛ 渲染层、纯逻辑层 ↛ 编辑器/Vue）已进门禁；
   （c）`electron/main/` 单文件 ≤ 450 行（实际当前最大 431）；
   （d）`test-core.mjs` `[F]` 段由「只读 `main/index.ts`」改为**整树递归扫描**，
   否则 IPC 注册一搬位置该断言就静默失效。
4. ✅ 功能零回归：`test-core` **266 断言**、`verify:markdown` 34、`verify:corpus` 18、`perf:index` 9
   （全量构建 1205ms / 增量 0.0069ms，与拆分前同量级，证明拆包零运行时开销）、`build` 通过。
5. ⬜ `git ls-files` 覆盖全部权威文档、`docs/README.md` 建立索引 —— 属建议 9，未做。

### 本次审计暴露的「元问题」

- **门禁写死单文件路径**：`test-core.mjs` `[F]` 段读 `electron/main/index.ts` 一个文件。
  拆分一发生，断言立刻「全通道报未接线」（本轮亲眼出现）。**门禁的扫描面必须与被守护代码的
  组织方式解耦**，否则重构本身就变成门禁的敌人。
- **文档宣称 ≠ 门禁落地**：`lib/depgraph.mjs` 注释写着「诊断与门禁共用」，
  但门禁从未 import 它 —— 循环依赖与分层越界实际上没有任何 CI 保护。
  凡在注释/文档里写下「已被门禁覆盖」，就必须有一次**注入故障 → 期望报红**的验证留痕。
- **拆分脚本会引入排版劣化**：脚本按「最小缩进」去前导空格，导致新文件函数体被压平到列 0。
  类型与 lint 都拦不住（缩进不在规则里），只能靠 Prettier 收口 ——
  故拆分后必须对新文件跑一次 `prettier --write`，并把这一步写进流程。
