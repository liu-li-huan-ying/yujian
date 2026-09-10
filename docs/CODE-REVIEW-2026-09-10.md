# 代码质量与架构审查报告（第二轮）

> 审查日期：2026-09-10
> 范围：`src/`（渲染层）+ `electron/`（主进程 / preload / shared）+ `scripts/` + 构建与 CI 配置
> 规模：约 90 个源文件 / 2.8 万行
> 基线：`npm run typecheck` 0 error · `npm run lint` 0 error（2 处有意保留的 `v-html` 警告）
> 上一轮：`docs/CODE-REVIEW.md`（2026-09-01）
> 修订（2026-09-10 当天闭环）：P0/P1/P2 清单已全部落地——`reportSoftError` 可观测层、`trash.ts` 注入拆分（解锁数据安全红线可测）、索引性能基线门禁、`App.vue` composable 抽取、`ARCHITECTURE.md §10` 改写、wikilink 语法共享模块、`wikilink.ts` mdast 最小形状、`readme:assets` 接线。下文「待办」标记据实更新。

---

## 零、总体结论

| 维度 | 评价 | 说明 |
| --- | --- | --- |
| 分层与进程边界 | **好** | 三进程职责清晰，IPC 契约单点收敛，56 个通道 100% 有 handler + preload 暴露（现有测试守住） |
| 数据安全纪律 | **好** | 原子写、绝不静默覆盖、关联数据随文档迁移，三处一致执行 |
| 可测性设计 | **好** | `vaultIndex.ts` 刻意零 Electron 依赖，是本次能建立测试套件的前提 |
| 测试体系 | **本轮从 0 到 1，并已加固** | 改前无任何测试套件；现 `test-core` 124 断言 + `verify:md` 29 + `perf:index` 9 项 + 编码门禁，全部进 CI |
| 组件规模 | **改善中** | `App.vue` 1742 → **1683**（抽出 `usePkmPanels` / `useVaultLinks`）；`Sidebar.vue` 1611、`SnapshotPanel.vue` 1493 待续 |
| 可观测性 | **已修** | 主进程容错失败统一经 `reportSoftError` 记录，完整性面板可见真实故障史 |
| 文档一致性 | **已修** | `ARCHITECTURE.md §10` 改写为「历史决策记录」，与已落地实现对齐 |

**一句话**：架构底子比一般个人项目扎实得多（原子写 + 增量索引 + 契约集中），真正的短板是**工程质量保障体系**——而这恰好是本次补齐的方向。

---

## 一、本轮发现并修复

### 1.1 【P0 · 数据丢失】wikilink 序列化丢弃 `#锚点`

**位置**：`src/editor/features/wikilink.ts` 的 `toMarkdown` runner

```ts
// 修复前
const { target, alias } = node.attrs          // ← anchor 被解构漏掉
const text = alias ? `[[${target}|${alias}]]` : `[[${target}]]`
```

`remarkWikilink` / `parseMarkdown` / `InputRule` **都解析并保存了锚点**，唯独序列化时没写回。后果：一篇写着 `[[A#小节]]` 的笔记，只要在编辑器里打开并保存，锚点就**静默消失**，退化成 `[[A]]`——跳到文首而不是那一节，且**不可逆**（源文件已被改写）。

这正是项目第一号红线「Markdown 往返保真」被击穿的情形，且是 UI 上看不出来的那种。

**修复**：`const { target, alias, anchor } = node.attrs`，按 `[[target#anchor|alias]]` 写回。
**守护**：`scripts/test-core.mjs` D 段的 12 条断言（已验证：把修复 stash 掉后用例立刻 FAIL）。

### 1.2 【P2 · 死代码】三处零引用实现

| 位置 | 情况 | 处置 |
| --- | --- | --- |
| `electron/shared/ipc-channels.ts` `FILE_LIST_DIR` | 声明后**全仓零引用**（主进程无 handler、preload 未暴露、无调用方）——一个永远不会被触发的通道 | 删除 |
| `electron/main/vaultIndex.ts` `matchMetadata` + `MetadataHit` | 注释写着「搜索的快路径」，但 `searchVault` 从未调用它（走的是逐行正文匹配） | 删除 |
| `electron/main/vaultIndex.ts` `escapeRe` | 仅被 `matchMetadata` 使用，随之成为死代码 | 删除 |

### 1.3 【P1 · 重复实现】两份等价的路径映射构建

`buildIndexPathMaps()` 与 `buildPathMaps()` 逐字符等价（前者只作用于 `Object.keys(index.files)`）。已删除前者，`resolveTarget` 改为复用 `buildPathMaps`；同时抽出 `resolveTargetWithMaps(maps, target)` 供批量解析热路径复用（避免每次重建 O(n) 映射）。

### 1.4 【P1 · 隐患】外部改名后路径映射陈旧

`reindexFile`（add/change）与 `deindexFile`（unlink）在**文件集变化**时不失效 `pathMaps` 缓存：

* 外部（资源管理器 / Git / 另一编辑器）重命名笔记 → watcher 收到 `unlink(旧)` + `add(新)` → 映射里仍是旧名；
* 此后任何一篇笔记写 `[[新名]]` 都解析不到 → **反链静默丢失**，直到下一次目录级事件才自愈。

已修：`deindexFile` 一律失效；`reindexFile` 仅在「新文件」时失效（内容编辑仍走缓存热路径，不牺牲 O(1)）。

### 1.5 【新增】测试套件 + CI 门禁

见 §四。改前 `scripts/stress-table.mjs` 写好却**从未接入任何 npm script**（等于不存在），现已接线。

---

## 二、架构评估

### 2.1 值得保留的做法

1. **`vaultIndex.ts` 的零 Electron 依赖**是有意识的设计（文件头注释即写明「不依赖 Electron / app / session，纯 Node fs——便于 esbuild→mjs 后在 Node 跑往返单测」）。本次的两类测试（索引纯函数、引用改写端到端）**完全建立在这个选择之上**。这是整个仓库里最有远见的一处架构决策。
2. **IPC 契约集中**：`electron/shared/ipc-channels.ts` 同时承载通道名与全部跨进程类型；preload 是唯一出口（contextIsolation + sandbox）。56 个通道全对齐，且现在由 F 段测试守住。
3. **落盘统一走 `atomicWrite`**：temp + rename，并对 Windows 只读属性 / 云同步短时锁做了三层兜底（清只读重试 → 删目标重试 → copyFile 覆盖），且保证临时文件不残留。
4. **索引严格增量**：接 chokidar 只重解析变动文件；目录级变动防抖对齐；程序化改动（create/rename/move/delete）置抑制窗跳过昂贵的全库 reconcile。这是刻意规避 Obsidian 规模化覆辙的设计。
5. **「绝不静默覆盖用户内容」在四处一致执行**：外部冲突三选一、未链接提及包裹前回验原文、全局替换只在命中文件范围内、本次的引用改写在**写入前用索引精确判定目标**。
6. **失败隔离策略统一**：单文件失败不阻断整体（`replaceInVault` / `rewriteLinksForMoves` 同款容错）。

### 2.2 结构性问题

**（1）上帝组件 —— 已按能力抽 composable（本轮闭环两块）**

| 文件 | 行数 | 变化 |
| --- | --- | --- |
| `src/App.vue` | **1683** | 上轮 1437 → 本轮审查时 1742 → **抽 composable 后 1683** |
| `src/components/Sidebar.vue` | 1611 | — |
| `src/components/SnapshotPanel.vue` | 1493 | — |
| `electron/main/vault.ts` | 1093 | 主进程最大单文件 |
| `electron/main/vaultIndex.ts` | 990 | 索引层（本轮净减） |

上轮把「导出编排」抽成 `src/export/buildExport.ts` 是对的，但随后 PKM 系列的接线（标签 / MOC / 反链 / 快照 / 活动栏 / 停靠布局）又全堆回 `App.vue`，抵消了那次拆分。

**做法**：不对 `App.vue` 做「整体搬迁式」大重构（风险高、收益慢），而是**按能力抽 composable，一次一块**，不触碰行为：

* ✅ `usePkmPanels()` —— 接管 `leftBottom` / `rightBottom` / `onViewToggle` 与快照面板唤醒刷新（`src/composables/usePkmPanels.ts`）；
* ✅ `useVaultLinks()` —— 接管 `onWikilink` / `onCreateBrokenLink`（双链目标解析与一键创建，`src/composables/useVaultLinks.ts`）；
* ⬜ `useTabs()` —— `store/tabs.ts` 已承载状态；`remapTabPaths` / `markProgrammatic` 仍留在组件里（需 host / session 上下文），继续留待后续按需收编。

依赖一律以参数注入（`vaultPath` / `openPath` / `showToast` …），composable 自身不直接触碰组件实例，保持可独立推理。

**（2）主进程 68 处静默 `catch {}` 无观测**

`catch {}`（带注释说明）作为「编辑器不该因一次 IO 失败就崩」的策略是正确的，但当前**完全没有出口**：

* 索引落盘失败（`saveIndex` 内 `catch {}`）→ 用户以为索引正常，实际每次启动都在重建；
* 历史迁移失败（`moveHistory` 的 `catch {}`）→ 快照静默留在旧哈希桶；
* `.assets` 搬运失败 → 图片静默裂图。

**建议**：在主进程加一个极薄的口子，把「已知可容忍失败」统一路由过去：

```ts
// electron/main/softError.ts
export function reportSoftError(scope: string, err: unknown): void {
  if (process.env.NODE_ENV !== 'production') console.warn(`[soft:${scope}]`, err)
  softErrors.push({ scope, message: String(err), at: Date.now() })  // 供完整性面板读取
}
```

然后 `catch { /* 注释 */ }` → `catch (e) { reportSoftError('index.save', e) }`。**不改任何控制流**，只是不再把错误倒进黑洞；顺带把「完整性自检」面板升级成能看到真实故障史。这是本次审查里**性价比最高的一处非功能性改造**。

**✅ 已落地**：新增 `electron/main/softError.ts`（有界环形缓冲 200 条、`warn`/`debug` 分级、sink 可注入、上报自身永不抛错），`vault.ts` / `vaultIndex.ts` / `snapshots.ts` / `vaultIntegrity.ts` 共 35 处容错 `catch` 全部接线；经 `SOFT_ERRORS_GET` / `SOFT_ERRORS_CLEAR` 两个 IPC 通道透出，`IntegrityPanel.vue` 增加可折叠「被容忍的失败」分区（按 scope 汇总 + 一键清空）。测试侧新增 G 段 30 条断言（含「上报永不抛错」「环形缓冲裁剪」「分级计数」）。

> 附带修掉一个**静默数据风险**：此前 `renameItem` / `deleteItem` / `moveItem` 用 `if (vaultRoot) { 迁移历史/附件 }`，而 `vaultRoot` 只在 `watchVault` 后才被赋值——早于首次 watch 的改名/删除会**静默跳过关联数据迁移**。现改为 `resolveVaultRoot(fromPath)` 自解析（向上找 `.yujian-history` / `.mdeditor` 标记），解析不到才记 `reportSoftError('history.noRoot')`。

**（3）渲染层组件零测试入口**

`src/` 里除 `verify:md` 覆盖的 `mathjax.ts` / `htmlInline.ts` 外，编辑器 feature 与 35 个 Vue 组件全部无自动化覆盖。要补组件级测试需引入 `@vue/test-utils` + DOM 环境，与「优先复用现有依赖、不轻易加包」的原则冲突。

**明确建议：不引入组件测试框架。** 继续走「**把可测逻辑从 UI 里抽成纯模块，用 Node 直测**」的路线——本次 `rewriteWikiLinksInText`（纯函数）+ `rewriteLinksForMoves`（fs 编排，无 Electron 依赖）就是该策略的范例，D 段的 wikilink 往返测试同样只在 feature 模块层面做。这条路线零新依赖、跑得快、且天然逼着代码分层。

---

## 三、代码质量扫描数据

| 指标 | 值 | 评价 |
| --- | --- | --- |
| `TODO` / `FIXME` / `HACK` / `@ts-ignore` / `eslint-disable` | **0** | 优秀（上轮同样为 0） |
| `: any` / `as any` / `<any>` | 64 → **61** 处（按出现次数计；`wikilink.ts` 12 → 9），集中在 5 个 `src/editor/features/*` 文件 | 可接受（与 Milkdown/micromark 的生态接口，eslint 按路径精确豁免；mdast 段已收敛） |
| `console.*` | 7 处（`App.vue` 4 / `i18n/index.ts` 1 / `SourceEditor.vue` 1 / `buildExport.ts` 1） | 克制 |
| 主进程容错 `catch` | **44 处**已接 `reportSoftError`（含本次新增 5 处：原子写降级 / 回收站降级 ×2 / 目录不可读 / 资源读盘） | 已可观测（见 §2.2(2)）；其余为「探测文件是否存在」等预期失败型控制流 |
| IPC 通道 | 56 个，全部 handler + preload 对齐 | 优秀，现有测试守住 |
| i18n | zh-CN / en-US 各 **511** key，键集合与插值变量逐条一致 | 优秀，现有测试守住 |
| 重复实现（`baseName` / `escapeRegExp+buildRegex` / `escapeXml`） | 已收敛到 `src/utils/{path,regex,html}.ts`，无残留副本 | 优秀（上轮 P1-3 已闭环） |

`any` 分布明细（按出现次数）：`inlineMarksSyntax.ts` 16 · `htmlInline.ts` 15 · `tag.ts` 12 · `wikilink.ts` 9（**12 → 9**，mdast 段已收敛为最小 `MdNode` 形状）· `inlineMarks.ts` 9。剩余全部落在 Milkdown / micromark 的框架回调边界。

---

## 四、测试体系专项（本次重点）

### 4.1 改前现状

* 无任何测试套件（`tests/` / `*.spec.ts` 均不存在，glob 只命中 `node_modules`）。
* 唯一的正确性护栏是 `scripts/verify-markdown.mjs`（`npm run verify:md`，29 条，覆盖数学渲染 / 内联 HTML / 主题令牌），**但它是一次性脚本形态，没有断言框架、不计入任何自动门禁**。
* `scripts/stress-table.mjs`（表格往返压测 19 条）写好但**未接入 npm script**。
* CI 只有 `release.yml`（打 tag 时三平台打包），**日常提交与 PR 无任何自动门禁**——`typecheck` / `lint` 是否通过全凭人手跑。

**这就是上轮审查里 P1/P2 类问题能长期潜伏的根因**：没有任何东西在你不注意的时候说「你改坏了」。

### 4.2 改后

| 层 | 手段 | 规模 |
| --- | --- | --- |
| 核心逻辑单测 / 集成 | `npm test` → `scripts/test-core.mjs` | **124 条断言**（A–H 八段） |
| Markdown 解析往返 | `npm run verify:md` | 29 条 |
| Markdown 往返语料矩阵 | `npm run verify:corpus`（`tests/corpus/*.md`） | 9 个用例，逐个断言「parse → serialize 逐字节相等」 |
| 表格稳定性压测 | `npm run stress:table`（新接线） | 19 条 |
| 索引性能基线 | `npm run perf:index`（3000 文件，可由 `YJ_PERF_FILES` 放大） | 9 项断言（含严格增量性） |
| 文本编码门禁 | `npm run check:encoding` | 全部受版本控制文本文件，断言无 U+FFFD |
| 一键门禁 | `npm run check` = typecheck + lint + check:encoding + test + verify:md | — |
| CI | `.github/workflows/ci.yml`：PR / main 推送自动跑 typecheck + lint + 编码检查 + test + verify:md + perf:index + build | 新增 |

### 4.3 `test-core.mjs` 的结构

沿用仓库既有做法（esbuild 把真实 TS 打成 mjs 后 import，**不启动 Electron、不引入测试框架**）：

| 段 | 覆盖 | 为什么值得测 |
| --- | --- | --- |
| A | `rewriteWikiLinksInText` 纯函数：锚点 / 别名保留、只替换 target、断链不动、同形不改、CRLF 逐字节保真 | 引用改写一旦写坏正文，是**批量**损坏 |
| B | 索引纯函数：`parseFile`（title / headings / outLinks 只收解析成功者 / frontmatter+内联标签去重 / 代码块不误收）、`deriveBackLinks`、`indexFile` 增量迁移反链、`removeFileFromIndex`、解析映射同源 | 反链少一条是**静默**的 |
| C / C2 / C3 / C4 | 临时库端到端：文件改名（5 种写法 + 逐字节比对）、目录移动（路径式改 / 基名式不动 / 来源自迁移）、零命中不写盘、幂等、空清单无操作 | 覆盖真实 fs 顺序与来源路径重映射 |
| D | wikilink 语法往返 12 条 | **上线即抓出 `#锚点` 数据丢失** |
| E | i18n 双语键集合 + 插值变量逐条对齐 | 双语项目最常见的静默腐化 |
| F | IPC 契约：每个通道都有主进程接线 + preload 暴露，且无「野通道」 | **抓出 `FILE_LIST_DIR` 死通道** |
| G | 软错误上报：上报不抛错 / 环形缓冲裁剪 / 分级计数 / sink 注入 | 容错路径也要有覆盖（§4.4-4） |
| H | 数据安全红线：改名 / 移动 / 删除对 `.assets` 与 `.yujian-history` 的搬运与清理（回收站注入 fake 后断言「三项都进回收站」） | 硬约束 6，此前**零覆盖**（§4.4-2） |

> 设计要点：F 段先断言「常量表解析到 > 20 个通道」，避免正则失效时「零通道全绿」的假阳性。

### 4.4 建议的下一步（按 ROI 排序）

1. ✅ **索引性能基线测试**（对应硬约束「5000 文件无感知、内存 < 100MB」）——`scripts/perf-index.mjs`（`npm run perf:index`），3000 文件实测：全量构建 ~1.0~1.4s、单文件增量 ~0.007ms、索引 2.04MB、堆增量 ~7MB；并断言「增量不得触碰无关条目」。
   * ⚠️ 「严格增量」的断言方式踩过一次坑：最初写「增量 ≥ 20× 便宜于全量/N」，但全量是 I/O 密集、增量是纯 CPU，机器一快 `全量/N` 变小、比值从本地 48× 掉到 CI 15× → **门禁随机飘红**。已改为**同进程内两个库规模对比**（N vs N/10）：O(1) 时 ~1.06×，退化成 O(n) 时 ~10.5×（已证伪验证）。这条防坑现在是确定性的，不再受机器快慢影响。
2. ✅ **关联数据随迁的回归测试**（对应硬约束 6，数据安全红线）——未做 `vaultFs.ts` 大拆分，改用更小的手术：新增 `electron/main/trash.ts`，以**惰性** `import('electron')` + `setTrashImpl` 注入回收站实现，`vault.ts` / `snapshots.ts` 顶部不再 `import { shell }`，从而可在 Node 直测。H 段 27 条断言覆盖改名 / 移动 / 删除（含文件夹递归、拒止分支）对 `.assets` 与 `.yujian-history` 的搬运与清理。
3. ✅ **Markdown 往返语料矩阵**——`scripts/verify-corpus.mjs`（`npm run verify:corpus`）：`tests/corpus/*.md` 逐个跑完整 remark 流水线（gfm + `wikilink` / `tag` / `htmlInline` 三个自定义插件），断言 parse→serialize 逐字节相等。新增用例 = 丢一个 `.md`，不写 JS。
   * 关键取舍：断言的是「**规范形式**的往返」而非「任何 Markdown 都原样存回」——remark 会把 `-` 正常化成 `*`、`---` 改成 `***`、表格按列宽对齐。这些是上游行为，不是本项目的缺陷，故语料必须按规范形式编写（对照表见 `tests/corpus/README.md`）。
   * 已证伪：把 wikiLink handler 的锚点去掉（历史 P0 缺陷）→ `06-wikilink.md` 正确失败。
4. ✅ **软错误上报**（§2.2(2)）——G 段 30 条断言覆盖「某类失败会被记录」「上报自身永不抛错」「环形缓冲裁剪」。

---

## 五、问题清单

### P0 · 必修 —— 本轮已修

* ✅ wikilink 序列化丢弃 `#锚点`（不可逆数据丢失），已修 + 测试守护。

### P1 · 应修

* ✅ 已修：死代码三处（`FILE_LIST_DIR` / `matchMetadata` / `MetadataHit` / `escapeRe`）。
* ✅ 已修：两份等价的路径映射实现。
* ✅ 已修：外部改名后 `pathMaps` 陈旧导致反链静默丢失。
* ✅ 已修：主进程容错 `catch` 无观测 → 新增 `softError.ts`，44 处接线，`IntegrityPanel` 可见真实故障史（§2.2(2)）；顺带修掉 `vaultRoot` 未就绪时**静默跳过关联数据迁移**的隐患。
* ✅ 已修：`App.vue` 膨胀 → 抽出 `usePkmPanels()` / `useVaultLinks()`，**1742 → 1683 行**（§2.2(1)）。

### P2 · 建议

* ✅ 已修：`ARCHITECTURE.md §10` 整节改写为「历史决策记录」，与已落地实现对齐。
* ✅ 已修：`wikilink.ts` 的 mdast 段 `any` 收敛为最小 `MdNode` 形状（12 → 9 处）；其余 `any` 集中在 Milkdown / micromark 框架回调边界，按路径精确豁免。
* ✅ 已修：新增 `electron/shared/wikilink-syntax.ts`，把 `[[…]]` 定界符正则与解析 / 构造收敛为单一来源，索引层（`vaultIndex.ts`）与编辑器层（`wikilink.ts`）共用；`wikiLinkRegex()` 每次返回**新实例**，避免共享 `lastIndex` 造成状态污染。
* ✅ 已修：`gen-readme-assets.mjs` 产出 6 张 README 配图（README 正在引用）→ 确认保留，接线为 `npm run readme:assets`。

---

## 六、后续可选项（非阻塞）

1. ⬜ `Sidebar.vue`（1611 行）/ `SnapshotPanel.vue`（1493 行）同样偏大，可用 `App.vue` 的同一手法增量抽 composable。
2. ⬜ `useTabs()`：`remapTabPaths` / `markProgrammatic` 仍留在组件里（需 host / session 上下文），按需再收。
3. ⬜ 语料可继续扩：数学（`$…$` / `$$…$$`）、脚注、frontmatter、引用的引用等构造尚未纳入（`frontmatter` 需引入 `remark-frontmatter`）。
