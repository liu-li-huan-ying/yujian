# 玉笺 Phase 3 开发计划（个人知识库方向）

> 状态：**批次零已落地，批次一已完成（2026-09-01），批次二已落地（2026-09-02），批次三（一：#标签 内联语法 + 标签聚合面板）已落地（2026-09-03），批次三（二·上：内容地图 MOC）已落地（2026-09-03）**。基线 v1.1.0（2026-09-01 发布，三平台 CI 打通），Phase 2 三批次全落地。批次三（二·下：关系图谱）~五待启动。
> 定位升级：从「技术写作型 Markdown 编辑器」向「**个人知识库（PKM）**」拓展——双链 / 标签 / 关系图谱（对应 `docs/ARCHITECTURE.md` §1.2 P3 与 `docs/PHASE2-PLAN.md` §8）。
> **本文件是 Phase 3 的权威计划，新会话开发前必读。**

***

## 0. 不可违背的约束

沿用 v1 / v2 红线：

1. **Markdown 往返保真**：未编辑的文档保存时必须一字不改写回原文。
2. **Milkdown 单实例**：只用 `@milkdown/crepe`，新能力用 `@milkdown/kit` 自研，不混装低版本插件。
3. **禁 node-gyp / 编译型依赖**：一律纯 JS / WASM。
4. **本地唯一真源**：图床只是镜像。
5. **体积可控**：新增依赖先评估对 asar 体积影响。

Phase 3 新增两条：

6. **`[[wikilink]]` 必须是「真节点 + to-markdown handler」**：按红线 4 推论，自定义内联语法要做成 ProseMirror 真节点，并由序列化 handler 原样输出 `[[...]]` 定界符。**绝不能**用「装饰显示 + 导出后处理」——`[[` 会被 remark/gfm 当普通文本或链接，往返必丢定界符。同时**必须配 InputRule**（`[[` 触发），否则当下敲了没反应。
7. **索引分层存储**：链接 / 标签索引属**可重建缓存** → 放 `.mdeditor/`（与快照 `.yujian-history/` 严格分离，后者是用户价值不可丢）。索引丢失须能**静默自动重建**，不得因此弹错。

***

## 1. 现状盘点（动手前必读，避免重复造轮子）

| 能力                    | 现状                                                                    | Phase 3 要补什么                     |
| --------------------- | --------------------------------------------------------------------- | ------------------------------- |
| `[[wikilink]]` 解析     | ✅ 主进程 `checkLinks` 已提取 wikilink（两遍遍历）+ `LinkCheckPanel` 报告断链         | 编辑器内节点 / 补全 / 跳转，以及正向+反向索引      |
| wikilink 编辑器节点        | ❌ 无（grep 确认 `src/` 无 wikilink node）                                   | 批次一新建                           |
| 标签                    | ⚠️ frontmatter `tags` 表单已有（写作辅助属性面板）；**无 `#标签` 内联语法、无标签聚合面板**         | 批次二                             |
| 关系图                   | ❌ 无                                                                   | 批次三                             |
| 命令面板                  | ❌ 无（Phase 2 §3.6 提及为未来项）                                               | 可选                              |
| 全文检索索引                | ⚠️ **实为暴力递归扫描**（`vault.ts:searchVault` 逐文件 `searchInFile`），上限 20 命中/文件、80 文件 | 批次三统一索引收口 + 解除上限                |
| `minisearch` 依赖        | ⚠️ `package.json` 里有，但**代码中零引用（死依赖）**                                  | 批次零清理 + 修正文档表述                  |

> **关键架构洞察**：vault 目前**没有任何持久化索引**——搜索与断链检查都是每次全量扫描。PKM 的反链 / 标签 / 图谱都需要持续的 vault 级关系数据 → Phase 3 应引入**统一的 vault 索引层**（内容 + 链接 + 标签），由既有 chokidar watcher（`watchVault`）增量维护。这一举两得：既支撑 PKM，又解除搜索的 80 文件上限。这是整个 Phase 3 的地基。

***

## 2. 已确认范围

> 2026-09-01 扩充：按用户要求，把 `docs/PRODUCT-POLISH-IDEAS.md` 里全部「值得做」项纳入 Phase 3（同行案例对照后新增：数据安全与完整性、大文档性能、中文排版、写作体验细节、个性化、技术写作特化、发布闭环）。批次由 4 个扩为 6 个。

### 2.1 地基与数据安全（批次零 · 批次一）

| 块                                 | 是否纳入  | 备注                                            |
| --------------------------------- | ----- | --------------------------------------------- |
| P0：`\eqref` 重载失效修复                | ✅ 批次零 | 已知未解缺陷，技术写作核心场景，方向已明确（文档级两遍渲染）               |
| 清理死依赖 `minisearch` + 修正文档表述       | ✅ 批次零 |                                               |
| **统一 vault 索引层**（内容 + 链接 + 标签，增量） | ✅ 批次零 | **整个 Phase 3 的地基**，提前到批次零；同时解除搜索 80 文件上限     |
| **vault 级完整性自检与修复**               | ✅ 批次一 | 索引/磁盘不一致、孤儿快照、缺失附件 → 一键修复/重建（Obsidian 恰恰缺这个） |
| **整库备份与恢复**                       | ✅ 批次一 | 现有快照是单文件级，缺整库备份                               |
| **外部修改冲突策略**                      | ✅ 批次一 | 「我正编辑 + 外部也改了」的呈现与处置                          |
| **表格稳定性压测**                       | ✅ 批次一 | Obsidian 有表格反复操作损坏的先例                         |

### 2.2 知识层（批次二 · 批次三）

| 块                                  | 是否纳入  | 备注                       |
| ---------------------------------- | ----- | ------------------------ |
| 双向链接 `[[wikilink]]` 节点 + 补全 + 跳转   | ✅ 批次二 | 最高杠杆                     |
| 反向链接面板 + 未链接提及                     | ✅ 批次二 | 含上下文片段、一键包裹成双链           |
| 断链检查接入索引 + 一键创建目标                  | ✅ 批次二 | 复用 Phase 2 §3.7          |
| 标签（`#标签` + frontmatter）+ 标签聚合面板     | ✅ 批次三 | 双轨采集                     |
| MOC（内容地图）                          | ✅ 批次三 | 以标签 / 双链聚合               |
| 关系图谱（力导布局）                         | ✅ 批次三 | 纯 JS，Canvas，限节点采样，易成坑放最后 |

### 2.3 中文排版与写作体验（批次四）

| 块                               | 是否纳入  | 备注                                                      |
| ------------------------------- | ----- | ------------------------------------------------------- |
| **中文排版（渲染层）**                   | ✅ 批次四 | 中英混排 ¼ em 自动视觉间距、中文斜体改颜色/着重号、标点挤压、避头尾、中英字体 fallback     |
| **大文档性能**（虚拟滚动 / 分块渲染）          | ✅ 批次四 | 10 万字以上流畅度；Typora「4 年从不卡顿」是用户忠诚核心                       |
| **复杂元素临时编辑界面**（表格 / 代码块 / 公式）   | ✅ 批次四 | 学 Typora：可视化调列宽、专注代码编辑区、公式编辑器                           |
| **中文分词**                        | ✅ 批次四 | 改善双击选词（现双击中文可能整段选中）+ 中文搜索质量                             |
| **命令面板 + 快捷键自定义**               | ✅ 批次四 | 面板增多后的统一入口；⚠️ 键位规划见 `docs/PHASE3-UI-DESIGN.md` §3.4（Ctrl+K 现状需先厘清） |

### 2.4 技术写作与发布闭环（批次五）

| 块                          | 是否纳入  | 备注                                        |
| -------------------------- | ----- | ----------------------------------------- |
| **参考文献 / 引文管理**            | ✅ 批次五 | BibTeX 导入、GB/T 7714 / APA 样式、Zotero 联动    |
| **文档 lint 扩展**             | ✅ 批次五 | 中英混排检查、术语一致性、标题层级跳跃、重复标题                  |
| **静态站点导出**（vault → 博客/文档站） | ✅ 批次五 | Obsidian Publish / Quartz 已验证需求           |
| **用户 CSS 片段 / 自定义样式**      | ✅ 批次五 | 低成本高收益的个性化（Typora / Obsidian snippets 均验证） |
| 一键发布公众号/知乎                 | ❌ 暂不做 | 需各平台 API 适配；静态站导出已覆盖多数发布需求，建议 Phase 4 再评估  |
| 团队协作 / 云同步                 | ❌ 不做  | 需后端，ARCHITECTURE §1.3 明确另立项目               |
| 实时协作 · 插件市场 · 移动端 · AI     | ❌ 不做  | 沿用 Phase 2 §6；插件市场另因性能不可控（Obsidian 教训）     |

***

## 3. 分批交付

> 六个批次按「地基 → 信任 → 知识 → 体验 → 专业」递进。批次零是其余一切的地基，务必最先做。

### 批次零：P0 缺陷修复 + 统一索引地基（最先做） ✅ 2026-09-01 已完成

> 已落地：`vaultIndex.ts` 统一索引层（增量维护 + `.mdeditor/vault-index.json` + 静默重建）；`watchVault` 增量接线；`searchVault` 改消费索引（解除 80 文件上限，软上限 1000/500 + `truncated`）；`VAULT_INDEX_REBUILD` IPC；`minisearch` 死依赖移除（pkg + lock + 文档表述修正）。`typecheck` + `lint` 通过。
> ⚠️ 未解遗留：块级 `\eqref` 重载显示 `???`（见 `docs/EQREF-KNOWN-ISSUE.md`，需浏览器 DOM 验证后实施文档级两遍渲染）。

* **块级 `\eqref` 重载后显示 `???`**：当前「逐节点 pending/flush 异步竞态」在重载路径不可靠。修复方向见 `.workbuddy/memory/EQREF-KNOWN-ISSUE.md` §5——**文档级确定性两遍渲染**：重载后等 MathJax 就绪且节点挂载完，先遍历全部 `math_inline` / `latex` 块**只登记 label**，再统一触发渲染，彻底消除「引用先于定义渲染」的竞态。
  * ⚠️ **实施前必须先在浏览器实跑抓 DOM 验证**：确认重载后行内 `\eqref` 到底走没走 `MathInlineView`、block 的 label 是否在 inline 解析前已登记。**前两次修复均因凭推测改错层而被推翻**，勿重蹈。
  * ⚠️ 接线铁律：保持 `.use((ctx) => () => { ctx.update(codeBlockConfig.key, …) })`，**切勿改 `crepe.editor.config(...)`**——该回调早于 codeBlockConfig 注册执行，会中断 init 于图片解析器之前，导致图片全裂（已发生一次真实回归，回退过）。
* **死依赖 `minisearch`**：代码中零引用，从 `package.json` 移除；同步修正 README / ARCHITECTURE 里「MiniSearch 倒排索引」的表述（实际为暴力扫描 + 上限）。
* **统一 vault 索引层（地基，提前做）** `electron/main/vaultIndex.ts`：
  * 结构：`{ version, files: { [path]: { mtime, title, headings, outLinks, tags } }, backLinks: { [path]: string[] } }`。
  * 持久化 `.mdeditor/vault-index.json`（可重建缓存，丢失**静默**重建）。
  * **严格增量**：接 `watchVault` 只重解析变动文件并修正反向条目；禁止任何遍历全库重算的周期任务。
  * **性能预算（硬约束）**：索引只存轻量元数据，**不缓存正文、不索引全文**；目标 vault 5000 文件时输入无感知退化、索引内存 < 100MB；每批完成用大样本库实测。
  * 建成后把 `searchVault` 从暴力递归扫描切到索引检索，**解除 80 文件 / 20 命中上限**（改分层加载）。
  * ⚠️ 防坑准则详见 `docs/PRODUCT-POLISH-IDEAS.md` §2（Obsidian 规模化翻车的实证）。

### 批次一：数据安全与完整性（信任基础） ✅ 2026-09-01 已完成

> 已落地：vault 级完整性自检（`vaultIntegrity.ts` + `IntegrityPanel.vue`，报告索引/磁盘不一致、孤儿快照、缺失附件并可一键修复/重建索引）；整库备份与恢复（`vaultBackup.ts` + `BackupPanel.vue`，zip 打包/恢复，与 `.yujian-history/` 单文件快照互补）；外部修改冲突策略（`ConflictDialog.vue` 三选一：保留我的/采用磁盘/双方对照，绝不静默覆盖，冲突前自动取消待定自动保存、抑制自身保存回声）；表格稳定性压测（`scripts/stress-table.mjs`，19 项全过，含 200 次随机突变往返稳定）。`typecheck` + `lint` 通过。

* **vault 级完整性自检**：扫描「索引与磁盘不一致 / 孤儿快照 / 断链 / 缺失附件 / 空索引」，分组列出并提供「一键修复 / 重建索引」。Obsidian 恰恰缺这个能力。
* **整库备份与恢复**：一键把整个 vault 打包（zip）到用户指定位置；可从备份恢复。与单文件快照（`.yujian-history/`）互补。
* **外部修改冲突策略**：chokidar 已能感知外部改动，需明确——当前文档有未保存改动且磁盘文件被外部修改时，呈现「保留我的 / 采用磁盘 / 双方对照」三选一，**绝不静默覆盖**。
* **表格稳定性压测**：反复增删行列 / 合并 / 撤销的压测（Obsidian 有损坏先例）。

### 批次二：双向链接 + 反链面板（知识层核心，最高杠杆）

* `src/editor/features/wikilink.ts`：**真节点** `wikilink`（`$nodeSchema` 是插件数组，须**逐个 `use()`**）+ InputRule（`[[` 触发）+ to-markdown handler 输出 `[[target]]`。
* `[[` 自动补全：列出 vault 内 md（文件名 / 一级标题），回车插入。
* 点击跳转：IPC 打开目标 md；目标不存在则提示「创建该笔记」（一键新建）。
* **索引消费**：批次零的索引已含 `outLinks` / `backLinks` / `tags`，本批次直接消费增量结果，不再自建索引。
* `src/components/BacklinksPanel.vue`：玻璃面板列「哪些笔记链接到当前笔记」+ **上下文片段** + 点击跳转；风格与断链面板一致（规格见 `docs/PHASE3-UI-DESIGN.md` §4.1）。
* **未链接提及（unlinked mentions）**：扫 vault 内出现当前笔记标题/别名但**未加 `[[ ]]`** 的位置，在反链面板单列一组，支持一键包裹成双链。
* 断链检查（`checkLinks`）接入索引：wikilink 目标不存在时提供「一键创建」入口。

**本批次已落地（2026-09-02）**：

* `src/editor/features/wikilink.ts`：真节点 `wiki_link`（$nodeSchema + $remark 改写正文 `[[...]]` → mdast 节点 + $inputRule 敲 `]]` 即转节点）+ to-markdown handler 原样输出 `[[target]]` / `[[target|alias]]`，**往返保真**（红线 4/6）。
* 点击跳转：`MilkdownEditor` 派发 `wikilink` 事件 → `EditorHost` 透传 → `App` 经 `resolveWikiTarget` 解析；目标存在则打开，不存在则 `createDoc` 一键创建并打开。
* 反链面板 `src/components/BacklinksPanel.vue`：玻璃面板，消费索引 `backLinks` 经 `getBacklinksWithContext` 抽取「来源笔记 + 引用行 + 上下文片段」，点击跳转（`onOpenResult` 复用）；切文档 / 重命名后随索引自动刷新；风格与断链面板一致。标题栏「更多」新增「反链」入口（`Icon` 新增 `backlink`）。
* i18n（zh-CN / en-US）新增 `backlinks*` / `wikilinkCreated` / `wikilinkOpenFail`；编辑器内芯片 `.yj-wikilink__label` 玉质药丸样式见 `src/styles/editor.css`。
* **批次二三项收尾（2026-09-02 同日补齐）**：
  - `[[` 自动补全浮层：`src/editor/features/wikilinkSuggest.ts`（`$prose` 触发检测插件，仅报坐标/拦按键，零 DOM 依赖）+ `src/components/WikiSuggest.vue`（玻璃浮层，挂 body 下 `position:fixed` 避 overflow 裁切）；`MilkdownEditor` 消费索引 `listNotes` 拉候选、前缀命中优先、↑↓/Enter/Tab/Esc 手势、选中即把 `[[查询词` 替换成 wikilink 真节点。
  - 未链接提及一键包裹：`vaultIndex.getUnlinkedMentions`（回读正文扫词，跳过代码块/行内代码/已链 `[[ ]]`，软上限 200）+ `wrapUnlinkedMention`（按 `start/end` 回验原文再写回，绝不静默覆盖）+ 反链面板「未链接提及」分组 + 每条「包裹成链接」按钮，包裹后两分组自洽刷新。
  - 断链面板「一键创建」：`LinkCheckPanel` 断链条目新增创建按钮 → `App.onCreateBrokenLink` 按目标写法落位（带路径建在对应子目录、裸名建在来源目录内聚）→ `createDoc` 创建并打开、刷新列表。
* 重命名不自动更新 `[[引用]]`（沿用原决策；见下方待决策）。

**双链「看得见、点得到」入口 + 浮块中文化（接续批次二）**：

* 此前双链能力（节点 / 补全 / 反链）已齐备，但**入口隐蔽**——只能手敲 `[[`。现补两条显式入口：
  - **A. 编辑器悬浮工具条（Crepe Toolbar / 选中文字浮块）**：`featureConfigs[Crepe.Feature.Toolbar].buildToolbar` 在 `function` 分组注入「插入双链」项（图标 `WIKI_LINK_ICON`），`onRun` 调 `insertWikiLinkTrigger()`。该方法用 `tr.insertText('[[')` 在光标处插入**字面** `[[` 并定位光标其后——刻意不走 `insertMarkdownAtCursor`（会把 `[[` 解析成节点、不触发联想），由 `wikilinkSuggest` 插件在事务 update 时自动弹出候选浮层，与手敲 `[[` 完全一致。
  - **B. 标题栏「更多」菜单**：`TitleBar` 新增 `insert-wikilink` 项 + emit；`App.onInsertWikiLink` → `EditorHost.insertWikiLink()`（WYSIWYG 端调 trigger 唤起浮层，源码端退化为插入字面 `[[` 文本）。
* **i18n 缺陷修复（选中浮块此前只有英文）**：Crepe Toolbar 特性默认英文标签，且 `i18n/index.ts` 的 `setLocale` 漏覆盖 `toolbar` 键。修复：zh-CN / en-US 各新增 `toolbar` 键（bold/italic/strikethrough/code/link/latex/ai/insertWikilink 中文与英文标签）；`featureConfigs[Toolbar]` 注入对应 `*Label`；`setLocale` 补 `Object.assign(t.toolbar, next.toolbar)`。切语言时 `EditorHost` 靠 `:key="langKey"` 重挂编辑器实例，构造读新标签即生效。
* 列表标记「皎洁月光」亮度（前文 `0a8796c`）：`tokens.css` 新增 `--hue-list-marker`（`color-mix(#fff 70% + tint)` + 柔光晕）并接入 `editor.css` 有序/无序/任务列表标记，暗色近白带玉调、亮色深玉保证可读——该视觉风格已确认用户满意。

> ⚠️ **待决策（重要）**：**重命名 / 移动笔记时是否自动更新所有 `[[引用]]`？**
> * 做：体验好，但会**批量改写其他文件原文**（触碰红线 1 精神）；若做须先展示将被改写的清单并经用户确认。
> * 不做：符合「不擅改用户文件」，重命名后会出现一批断链，但断链面板已能报出，可手动修。
> * **默认建议：先不做自动改写**，只把受影响引用列进断链面板供手动处理；需要时再作为批次二收尾的可选项加。
> * 另：`[[ ]]` 需支持**别名 / 标题消歧**（`[[路径|显示名]]`、同名笔记消歧），否则大库会指错目标——建议批次二预留。

### 批次三：标签 + MOC + 关系图谱

> **进度（2026-09-03）**：`#标签` 内联真节点 + frontmatter 双轨采集 + 标签聚合面板（浏览/钻取）已落地（见 `docs/ARCHITECTURE.md` §5.16）；内容地图 MOC（frontmatter `moc: true` + 三组聚合面板）已落地（见 §5.17）；关系图谱见下，尚未动工。

* `#标签` 内联语法：同为「真节点 + handler」，与 frontmatter `tags` 双轨（属性面板写 frontmatter，正文里 `#标签` 走内联节点），索引同时采集两处。
  * ⚠️ 歧义：须区分行首 `# 标题` 与正文 `#标签`——标签要求 `#` 后非空格紧跟且不在标题位；靠真节点 InputRule 界定，别靠正则硬扫。
* 标签聚合面板 / 侧栏：标签 + 计数 + 点击筛选笔记列表（规格见 UI 文档 §4.2）。
* **MOC**（✅ 已落地，见 §5.17）：允许把任意笔记标为 MOC（frontmatter `moc: true`），打开时按标签 / 双链自动聚合下级笔记（可折叠），作为主题入口。
* **关系图谱** `src/components/GraphView.vue`：力导布局。
  * 依赖：先翻仓库现有依赖能做什么，其次再考虑 `d3-force`（纯 JS，无 node-gyp）——**别上来就加新包**。
  * 视图：**本地子图**（当前笔记 N 跳邻居，默认 1–2 跳）+ **全局图**切换；节点点击跳转、悬停高亮。
  * 性能：限节点（默认 ≤300）+ 采样 + 渲染节流；节点多时用 **Canvas 而非 SVG**（SVG 节点多会卡）。Phase 2 §8 已警示「易成坑，放最后」。
  * 图数据**由索引派生，不存原始图**。

### 批次四：中文排版与写作体验（差异化护城河）

* **中文排版（渲染层，零红线风险）**：
  * 中英混排**自动 ¼ em 视觉间距**（ProseMirror Decoration 或 CSS），**源文件一字不改**——这正是 W3C《中文排版需求》§3.2.2 说「应由排版引擎自动加入」而同行都没做的。
  * **中文斜体改用颜色 / 着重号**（中文斜体公认难看，规范亦建议）。
  * 标点挤压、避头尾规则、中英文字体 fallback 搭配、中文行高 / 段间距优化。
  * ⚠️ **绝不能**在保存时自动改写源文件补空格（违反红线 1）。改写只能做成用户显式触发的「排版规范化」命令或 lint 提示（归入批次五）。
  * 规格见 `docs/PHASE3-UI-DESIGN.md` §5。
* **大文档性能**：10 万字以上文档的虚拟滚动 / 分块渲染，保证输入延迟不随文档长度退化。
* **复杂元素临时编辑界面**（学 Typora）：表格可视化调列宽 / 增删行列、代码块专注编辑区、公式编辑器浮层。规格见 UI 文档 §4.4。
* **中文分词**：双击选词按中文词边界（现双击可能整段选中）；顺带提升中文搜索质量。
* **命令面板 + 快捷键自定义**：面板增多后的统一入口与键位可配；⚠️ 键位现状与规划见 UI 文档 §3.4。

### 批次五：技术写作与发布闭环

* **参考文献 / 引文管理**：BibTeX 导入、引用样式（GB/T 7714 / APA）、可选 Zotero 联动；编辑器内引用节点 + 导出时生成参考文献表（Zettlr 已在学术场景验证）。
* **文档 lint 扩展**：在既有断链检查之上扩展——中英混排检查、术语一致性、标题层级跳跃、重复标题；结果并入统一 lint 面板，点击定位。
* **静态站点导出**：vault → 静态博客 / 文档站（复用现有 HTML 导出管线 + 索引生成目录与标签页）。
* **用户 CSS 片段**：`~/.config/yujian/snippets/*.css` 或 vault 内 `.mdeditor/snippets/`，外观面板内可勾选启停、即时生效（不重启、不重建编辑器）。

***

## 4. 技术方案要点（既往踩坑，务必遵守）

* **真节点三件套**：`$nodeSchema` 是插件数组须逐个 `use()`；`$inputRule` 一次只收一条；真节点必须配 InputRule 否则无反应；序列化 handler 必须经 `this.data('toMarkdownExtensions').push({ handlers })` **自注册**（缺失则 remark-stringify 抛 `Cannot handle unknown node`，含该节点文档保存即崩）。
* **纯 remark 扩展文件不要 import Milkdown**，便于 esbuild → mjs 后在 Node 跑往返测试。
* **索引必须增量**：vault 大时全量重建会卡；接 watcher 只重解析变动文件，用 `mtime` 校验一致性。
* **索引可丢**：`.mdeditor/` 是可删缓存，索引缺失必须静默重建，不能弹错。
* **图谱性能**：`d3-force` 的 tick 持续重排，大库务必限节点 + 采样，必要时放 Web Worker。
* **第三方组件（Crepe / Milkdown）样式定制前，先查真实 DOM 与着色选择器，勿对伪元素想当然**：列表标记是 Crepe `listItemBlock` 渲染的**真实元素** `li.list-item > .label-wrapper > Icon.label`（⦿ / 序号 / 复选框），**既非原生 `::marker` 也不存在 `li::before`**；着色链是 Crepe 自带的 `.label-wrapper { color: var(--crepe-color-outline) }` + `.label-wrapper svg { fill: … }`。曾误改 `ol > li::before` / `ul:not(.milkdown-list-item-block) > li::before`（且后者因 ul 本身带该 class 而**永不命中**），等于在改一个不渲染的东西，白改三轮表现为「亮度怎么调看起来都一样」。另注意 class 长在自身还是父级：`.checked` 就长在 svg **自身**上 → 须写 `svg.checked`，写成 `.checked svg`（找 `.checked` 的后代 svg）匹配不到任何元素、勾选态**静默失效**。细化见 `docs/ARCHITECTURE.md` §5.7.1。
* **改样式后 preview 实测无效，先 clean rebuild 排除构建缓存**：`npm run dev` = `electron-vite preview`，服务静态产物 `out/`、**无 HMR**（改 `src/` 后必须重建 `out/` 并重启应用）。vite 构建缓存还可能复用旧 `tokens.css`（即便源码已改）造成产物陈旧，同样表现为「改了跟没改一样」。故先 `rm -rf out node_modules/.vite` 再 `npm run build` 验证，**确认产物里已是新值**后，再去怀疑选择器 / 特异性。

***

## 5. 风险与应对

| # | 风险                       | 应对                                    |
| - | ------------------------ | ------------------------------------- |
| 1 | wikilink 往返丢定界符 / 保存即崩   | 真节点 + handler 自注册；写 Node 往返测试（esbuild→mjs） |
| 2 | 索引与磁盘不一致（外部改动/删除）       | 接 watcher 增量；`mtime` 校验；缺失全量重建        |
| 3 | 图谱大库卡顿                   | 限节点 + 采样 + Canvas；默认本地子图              |
| 4 | 自动改写引用触碰红线 1             | 默认不自动改写，仅报告供手动；若做须先列清单 + 确认           |
| 5 | 新增依赖撑大包体 / node-gyp      | 图谱优先复用现有依赖，其次纯 JS；禁编译型                |
| 6 | `#标签` 与 `# 标题` 歧义         | 靠真节点 InputRule 界定，不用正则硬扫              |
| 7 | 同名笔记 `[[ ]]` 指错目标         | 支持 `[[路径\|显示名]]` 与消歧，批次二预留            |
| 8 | 面板过多入口混乱                 | 命令面板统一收纳 + 侧栏分组；入口集中标题栏（见 UI 文档 §3）   |
| 9 | 索引层重蹈 Obsidian 规模化覆辙     | 严格增量 + 性能预算 + 大样本实测（见 PRODUCT-POLISH-IDEAS §2） |
| 10 | 外部修改冲突导致数据丢失             | 绝不静默覆盖，提供三选一对照；冲突前先自动留快照              |
| 11 | 中文排版改写源文件触碰红线 1          | 自动行为只在渲染层；改写必须是用户显式命令或 lint 提示         |
| 12 | 大文档虚拟滚动与 Crepe 选区/装饰冲突   | 先做小范围验证（≥10 万字样本），确认 Decoration 与滚动保持不破 |
| 13 | CSS 片段破坏界面或导出            | 片段只作用于框架层/浮层，**绝不注入编辑区 DOM**（守导出一致性，UI-DESIGN §10.3） |

***

## 5.5 文件移动 + 刷新一致性（批次二收尾，已实现并修正）

**需求**：在目录树中把文件/文件夹移动到其他文件夹，支持拖拽与右键菜单两条入口；并修复刷新逻辑的重复刷新 / 竞态，且**文档、历史记录、附件等一切关联数据必须随文档一起挪动**。

**主进程 `vault.ts`**
- 新增 `moveItem(oldPath, destDir, newName?)`：校验目标须为已存在目录、禁自身/子孙、同名冲突追加序号（绝不覆盖）；同目录降级 `renameItem`；跨卷 `EXDEV` 回退「递归复制 + 删源」；Windows 只读属性先 `chmod(destDir,0o777)` 再试。
- **关联数据随文档迁移/清理（核心修正：原实现只搬了 .md）**：
  - 历史记录 `.yujian-history/<sha1(文档绝对路径)>`：`renameItem`/`moveItem`/`deleteItem` 在文档（或文件夹内每篇文档）绝对路径变化后，调用 `snapshots.moveHistory`/`deleteHistory` 把对应历史桶一并迁移/清走（走系统回收站，符合数据安全红线）。
  - 附件 `.assets`：单文件移动/重命名时同步搬运同名 `.assets`；文件夹移动/重命名时整棵子树（含内部各 `.assets`）整体搬迁，无需逐文件处理。
  - 统一索引层：文件精确「移除旧路径 + 登记新路径」；目录触发防抖 reconcile，避免依赖 watcher 的 1s 延迟窗口读到陈旧路径。
- IPC：`VAULT_MOVE` → preload `window.api.moveItem`。

**渲染层**
- `FileTree.vue`：行 `draggable` + `dragstart/over/drop/end`；拖到目录 = 进该目录，拖到树背景 = 移入库根；校验自身/子孙并高亮 `row--drop`。
- `MoveDialog.vue`：右键「移动到…」库内文件夹选择弹窗（禁用自身/子孙/原父目录，含「库根目录」项）。
- `Sidebar.vue`：`doMove` 收口拖拽与菜单两条入口；删除统一 `emit('delete-node', node)` 交给 App 编排（不再自行删磁盘）。
- `App.vue`：
  - `onMoved` / `onRenamed`：经 `remapTabPaths` **前缀批量重映射所有受影响标签**——文件夹移动/重命名让内部每篇文档绝对路径都变化，必须连嵌套的活动文档标签一起更新，否则旧路径标签会被编辑器自动保存「复活」。
  - `onDeleteNode`（树驱动删除）：先关闭节点本身及其内部**全部**已开标签（含活动文档，且 `cancelPendingSave` 取消待保存以免自动保存重建已删文件/目录），再 `deleteItem`，最后单一刷新。
  - `onDeleted`（外部删除）：同样按路径前缀批量关闭受影响标签并取消活动文档待保存。

**刷新一致性修复（`src/refreshGuard.ts` + `App.onVaultChange`）**
- 程序化改动后，「路径集合 + 时间窗」标定同源事件，watcher 回声直接忽略 → **消除一次改动两次全量扫描的重复刷新**。
- 关键竞态：移动/重命名正在编辑的文档时，`unlink(旧路径)` 不再被误判「外部删除」而关标签（`onRenamed`/`onMoved` 同步路径前先登记 immune）。
- 真正的外部改动路径不在免疫集合内，照常刷新/冲突检测，无遗漏。

**创建文件夹慢（已修）**：每次程序化改动（含 `createFolder`/`createDoc`）置 `progSuppressUntil`，让 `scheduleReconcile` 跳过昂贵的全量 `reconcileIndex`——索引已由每文件 `add`/`unlink` 事件增量维护，全量 reconcile 纯属冗余且在大库极重；外部结构改动仍照常 reconcile，不丢一致性。

***

## 5.6 删除 EPERM 复修 + 拖拽自动展开（补充）

**删除 `vault:delete` 仍报 `EPERM: scandir`**：根因是 `deleteItem` 用裸 `rm(force)` 且**无 try/catch**，递归删外部盘/同步锁目录时 `scandir` 抛 EPERM 直冒 handler；且 `rm(force)` 是永久删除，违反「删除走回收站」红线。
- 修复：主进程 `vault.ts` `import { shell } from 'electron'`，新增 `trashOrRemove()`（优先 `shell.trashItem` 进系统回收站，失败回退 `rm`、且回退前 `clearReadOnlyRecursive()` 递归清目标树只读属性）+ `clearReadOnlyRecursive()`；`deleteItem` 主目标与 `.assets` 均改调 `trashOrRemove`。删除现进回收站（可恢复、且 Explorer 删除路径更能规避 Windows 只读/外部盘 EPERM）。

**跨层级（上上层）移动：逻辑本已支持，补拖拽可达性**
- 核查：`moveItem`/`MoveDialog.flatDirs`/`FileTree.canDrop` 均只拦「自身/子孙/原父」、**不拦祖先** → 菜单「移动到…」与拖到任意可见上层目录行均支持上上层。体感「挪不上去」真因是拖拽目标目录须在侧栏展开可见。
- 补强：拖拽悬停合法目录 300ms **自动展开**（`FileTree` 新增 `hover-expand` emit + 防抖 `requestHoverExpand`/`cancelHoverExpand`；`Sidebar` 接 `onHoverExpand`→`expand`，幂等），让深层/上上层目录在拖拽过程中直达。

***

## 6. 验收标准

* **批次零**：重载含 `\eqref` 的文档稳定显示 `(1)`（非 `???`）；手动重输仍正常；图片加载无回归；`minisearch` 已移除且文档表述修正；索引层建成——5000 文件库下输入无感知退化、索引内存 < 100MB、搜索不再受 80 文件上限限制；删掉索引后静默重建无报错。
* **批次一**：自检能报出索引/磁盘不一致、孤儿快照、缺失附件并可一键修复；整库备份与恢复往返无损；外部修改冲突时提供三选一而非静默覆盖；表格增删行列/撤销压测无损坏。
* **批次二**：正文 `[[笔记名]]` 渲染为可点击链接；`[[` 触发补全；点击跳转目标笔记，不存在可一键创建；**保存后原文仍为 `[[笔记名]]`（往返保真）**；反链面板正确列出来源笔记与上下文；未链接提及可一键包裹成双链；新增 / 删除 / 重命名笔记后反链随之更新。
* **批次三**：`#标签` 与 frontmatter tags 均被索引；标签面板聚合与计数正确、点击可筛选；MOC 聚合下级列表；图谱正确渲染双链关系，本地 / 全局切换正常，大库（≥500 笔记）不卡死。
* **批次四**：中英混排自动视觉间距生效且**源文件一字未改**；中文强调不再用斜体；10 万字文档输入延迟不退化；表格/代码块/公式临时编辑界面可用；双击中文按词选中；命令面板可搜到全部功能且键位可自定义。
* **批次五**：BibTeX 导入与 GB/T 7714 引用生成正确；lint 能报出混排/术语/层级问题并点击定位；静态站导出可直接在浏览器打开且目录标签页完整；CSS 片段勾选即时生效、不注入编辑区、可随时关闭。

***

## 7. 明确不在 Phase 3 范围

一键发布公众号 / 知乎（各平台适配，建议 Phase 4 评估）· 云同步 / 团队协作（需后端，另立项目）· 实时多人协作 · 插件市场 · 移动端 · AI 辅助写作（无 API，Crepe 接口保留）。

***

## 8. 后续动作（新会话照此开工）

1. **批次零先行**（缺陷 + 死依赖 + 索引地基）。改前**先浏览器实跑抓 DOM 验证 `\eqref` 假设**，勿凭推测动手。
2. 批次二动手前，先确认「重命名是否自动更新引用」的决策。
3. **UI 先行**：每批动手前先读 `docs/PHASE3-UI-DESIGN.md` 对应章节，按既定规格实现（令牌、材质层、组件状态、无障碍），避免各自发明界面。
4. 每批遵循「**先更文档再提交**」纪律；批次完成走 `npm run typecheck` + `npm run lint` 门禁；涉及索引/性能的批次**必须用大样本库实测**，不能只看类型检查。
5. Phase 3 完成打 `v1.2.0`，推 `v*` tag 走三平台 CI。
6. 新会话必读：本文件 + `docs/PHASE3-UI-DESIGN.md`（UI 规格）+ `.workbuddy/memory/MEMORY.md`（硬约束与踩坑）+ `docs/PRODUCT-POLISH-IDEAS.md`（同行案例与防坑准则）。
