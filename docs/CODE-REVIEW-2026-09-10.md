# 代码质量与架构审查报告（第二轮）

> 审查日期：2026-09-10
> 范围：`src/`（渲染层）+ `electron/`（主进程 / preload / shared）+ `scripts/` + 构建与 CI 配置
> 规模：约 90 个源文件 / 2.8 万行
> 基线：`npm run typecheck` 0 error · `npm run lint` 0 error（2 处有意保留的 `v-html` 警告）
> 上一轮：`docs/CODE-REVIEW.md`（2026-09-01）

---

## 零、总体结论

| 维度 | 评价 | 说明 |
| --- | --- | --- |
| 分层与进程边界 | **好** | 三进程职责清晰，IPC 契约单点收敛，56 个通道 100% 有 handler + preload 暴露（现有测试守住） |
| 数据安全纪律 | **好** | 原子写、绝不静默覆盖、关联数据随文档迁移，三处一致执行 |
| 可测性设计 | **好** | `vaultIndex.ts` 刻意零 Electron 依赖，是本次能建立测试套件的前提 |
| 测试体系 | **本轮从 0 到 1** | 改前无任何测试套件；现 1 套 / 67 断言 + CI 门禁 |
| 组件规模 | **偏差** | `App.vue` 1742 行、`Sidebar.vue` 1611 行、`SnapshotPanel.vue` 1493 行 |
| 可观测性 | **偏差** | 主进程 68 处 `catch {}` 静默吞错，无任何遥测 / 开发态日志 |
| 文档一致性 | **中性偏好** | 主体准确，但 `ARCHITECTURE.md §10` 仍是 v1 时代遗留问题（全部已落地） |

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

**（1）上帝组件仍未拆动，且继续增长**

| 文件 | 行数 | 变化 |
| --- | --- | --- |
| `src/App.vue` | **1742** | 上轮审查时 1437，**+305** |
| `src/components/Sidebar.vue` | 1611 | — |
| `src/components/SnapshotPanel.vue` | 1493 | — |
| `electron/main/vault.ts` | 1093 | 主进程最大单文件 |
| `electron/main/vaultIndex.ts` | 990 | 索引层（本轮净减） |

上轮把「导出编排」抽成 `src/export/buildExport.ts` 是对的，但随后 PKM 系列的接线（标签 / MOC / 反链 / 快照 / 活动栏 / 停靠布局）又全堆回 `App.vue`，抵消了那次拆分。

**建议**：不要再对 `App.vue` 做「整体搬迁式」大重构（风险高、收益慢），改为**按能力抽 composable**，一次一块：

* `usePkmPanels()` —— 接管 `leftBottom` / `rightBottom` / `onViewToggle` / 各面板刷新联动；
* `useVaultLinks()` —— 接管 `onWikilink` / `onCreateBrokenLink` / 未链接提及 / 反链跳转；
* `useTabs()` —— 已有 `store/tabs.ts`，但 `remapTabPaths` / `markProgrammatic` 仍在组件里，可一并收编。

每抽一块立刻能得到「组件只留模板绑定」的净收益，且不触碰行为。

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

**（3）渲染层组件零测试入口**

`src/` 里除 `verify:md` 覆盖的 `mathjax.ts` / `htmlInline.ts` 外，编辑器 feature 与 35 个 Vue 组件全部无自动化覆盖。要补组件级测试需引入 `@vue/test-utils` + DOM 环境，与「优先复用现有依赖、不轻易加包」的原则冲突。

**明确建议：不引入组件测试框架。** 继续走「**把可测逻辑从 UI 里抽成纯模块，用 Node 直测**」的路线——本次 `rewriteWikiLinksInText`（纯函数）+ `rewriteLinksForMoves`（fs 编排，无 Electron 依赖）就是该策略的范例，D 段的 wikilink 往返测试同样只在 feature 模块层面做。这条路线零新依赖、跑得快、且天然逼着代码分层。

---

## 三、代码质量扫描数据

| 指标 | 值 | 评价 |
| --- | --- | --- |
| `TODO` / `FIXME` / `HACK` / `@ts-ignore` / `eslint-disable` | **0** | 优秀（上轮同样为 0） |
| `: any` / `as any` / `<any>` | 46 处，集中在 5 个 `src/editor/features/*` 文件 | 可接受（与 Milkdown/micromark 的生态接口，eslint 按路径精确豁免） |
| `console.*` | 7 处（`App.vue` 4 / `i18n/index.ts` 1 / `SourceEditor.vue` 1 / `buildExport.ts` 1） | 克制 |
| 主进程 `catch {}` | 68 处 | 策略正确，但**无观测**（见 §2.2(2)） |
| IPC 通道 | 56 个，全部 handler + preload 对齐 | 优秀，现有测试守住 |
| i18n | zh-CN / en-US 各 **511** key，键集合与插值变量逐条一致 | 优秀，现有测试守住 |
| 重复实现（`baseName` / `escapeRegExp+buildRegex` / `escapeXml`） | 已收敛到 `src/utils/{path,regex,html}.ts`，无残留副本 | 优秀（上轮 P1-3 已闭环） |

`any` 分布明细：`inlineMarksSyntax.ts` 12 · `htmlInline.ts` 10 · `wikilink.ts` 9 · `tag.ts` 9 · `inlineMarks.ts` 6。

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
| 核心逻辑单测 / 集成 | `npm test` → `scripts/test-core.mjs` | **67 条断言** |
| Markdown 解析往返 | `npm run verify:md` | 29 条 |
| 表格稳定性压测 | `npm run stress:table`（新接线） | 19 条 |
| 一键门禁 | `npm run check` = typecheck + lint + test | — |
| CI | `.github/workflows/ci.yml`：PR / main 推送自动跑 typecheck + lint + test + verify:md + build | 新增 |

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

> 设计要点：F 段先断言「常量表解析到 > 20 个通道」，避免正则失效时「零通道全绿」的假阳性。

### 4.4 建议的下一步（按 ROI 排序）

1. **索引性能基线测试**（对应硬约束「5000 文件无感知、内存 < 100MB」）：造 5000 篇临时笔记，断言 `buildIndex` 耗时上限与单文件增量重解析耗时上限。当前这项硬约束**只靠人工手测**，是最容易随重构悄悄退化、又最贵的指标。
2. **关联数据随迁的回归测试**（对应硬约束 6，数据安全红线）：`renameItem` / `moveItem` / `deleteItem` 对 `.assets` 与 `.yujian-history/<sha1>` 的搬运 / 清理**目前零自动化覆盖**。
   * 前置结构改造：`vault.ts` 因 `import { shell } from 'electron'`（回收站）而无法在 Node 里直测。建议把纯 fs 编排拆到 `vaultFs.ts`，把 `trashItem` 以参数注入——**这是本仓库下一步最有价值的结构改造**：它同时解锁「数据安全红线的可测性」。
3. **Markdown 往返语料矩阵**：把 `verify:md` 从「手写用例」扩成「语料文件夹 → 逐文件 parse→serialize 断言逐字节相等」，防止后续自定义语法扩建时踩坑。
4. **软错误上报**（§2.2(2)）：打通后可在测试里断言「某类失败会被记录」，让容错路径也有覆盖。

---

## 五、问题清单

### P0 · 必修 —— 本轮已修

* ✅ wikilink 序列化丢弃 `#锚点`（不可逆数据丢失），已修 + 测试守护。

### P1 · 应修

* ✅ 已修：死代码三处（`FILE_LIST_DIR` / `matchMetadata` / `MetadataHit` / `escapeRe`）。
* ✅ 已修：两份等价的路径映射实现。
* ✅ 已修：外部改名后 `pathMaps` 陈旧导致反链静默丢失。
* ⬜ 待办：主进程 68 处静默 `catch {}` 无观测 → 引入 `reportSoftError` 薄口子（§2.2(2)）。
* ⬜ 待办：`App.vue` 继续膨胀 → 按能力抽 composable（§2.2(1)）。

### P2 · 建议

* ⬜ 文档漂移：`ARCHITECTURE.md §10「需要你拍板的遗留问题」`仍是 v1 时代的 6 个问题（图片位置 / 自动保存 / 多标签 / 图床优先级 / AI 辅助…），**全部早已落地**，应整节改写为「历史决策记录」或删除。
* ⬜ `src/editor/features/*` 的 46 处 `any` 可逐步收敛为最小接口类型（如 mdast 节点最小形状），优先 `wikilink.ts`（9 处，且是活跃代码）。
* ⬜ `vaultIndex.ts` 仍有裸文本正则扫 `[[...]]`（索引层与 remark 层各扫一遍）；两者语义需长期保持一致，建议把「wikilink 定界符正则」收敛为单一常量导出，避免两边漂移。
* ⬜ `scripts/gen-readme-assets.mjs` 同样未接入 npm script，确认是否仍需保留。

---

## 六、下一步建议（按优先级）

1. 落地 `reportSoftError`，把 68 处黑洞变成可观测（半天量级，零行为变更）。
2. 拆 `vaultFs.ts`（纯 fs，回收站注入）→ 补关联数据随迁测试（数据安全红线的可测性）。
3. 补索引性能基线测试（5000 文件）。
4. 抽 `usePkmPanels()` / `useVaultLinks()` 收敛 `App.vue`。
5. 清理 `ARCHITECTURE.md §10` 文档漂移。
