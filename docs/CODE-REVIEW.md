# 代码质量审查报告

> 审查日期：2026-09-01
> 范围：`src/` 全量（71 文件 / 约 18.9k 行）+ `package.json` + 构建配置
> 基线：`npm run typecheck` 通过（exit 0）

---

## 零、总体结论

**健康的部分（已验证）**：类型检查干净、零技术债标记、无孤儿文件、i18n key 100% 对齐、资源清理到位、无重复的日期/防抖/文本统计实现。

**短板集中在三处**：① 一处真实的 XSS 面；② `App.vue` 退化成上帝组件；③ 工程化工具链缺失（无 lint、无测试）——这也是②③类问题能长期潜伏的根因。

| 等级 | 数量 | 说明 |
|---|---|---|
| P0 必修 | 2 | XSS 面、用户可见错乱文案 |
| P1 应修 | 3 | 上帝组件、死逻辑、重复实现 |
| P2 建议 | 5 | 工具链、死代码、i18n 收编等 |

---

## 进度追踪（截至 2026-09-01）

全部 P0 / P1 / P2 项均已落地。验证手段：`npm run typecheck`（exit 0）、`npm run lint`（0 error）。

- **P0-1 XSS 面**：`src/editor/features/htmlInline.ts` 的渲染路径经 dompurify 消毒；toMarkdown 仍写原始值以保 Markdown 往返保真。
- **P0-2 用户可见错乱文案**：toast 占位符 `{n}` 改为 i18n 键。
- **P1-1 上帝组件**：导出编排逻辑抽离至 `src/export/buildExport.ts`（纯函数，零 UI 耦合）。
- **P1-2 死逻辑**：Sidebar 死三元分支已删。
- **P1-3 重复实现**：`baseName` / `escapeRegExp+buildRegex` / HTML 转义 统一收敛到既有工具。
- **P2-2 死导出**：`toUint8Array`、`needsSerialization`、en-US 冗余 `export type Locale` 已删。
- **P2-3 i18n 收编**：约 33 处硬编码中文收编进 `ui` 命名空间（zh-CN / en-US 双向 key 数均为 288，一致）；顺带修正一处「键误放进 `help` 命名空间」的结构缺陷。
- **P2-4 TitleBar `as any`**：emit 联合类型收紧，移除 `as any`。
- **P2-5 构建垃圾**：新增 `scripts/clean.mjs` + `npm run clean`，清理 `electron.vite.config.*.mjs` 临时产物。
- **工程化工具链（P2-1）**：引入 eslint + @typescript-eslint + eslint-plugin-vue + prettier；`eslint.config.mjs` 开启 `no-explicit-any`（对 `src/editor/features/**` 按路径豁免，避免 `eslint-disable` 注释）、`vue/no-unused-components`、`@typescript-eslint/no-unused-vars`；新增 `lint` / `lint:fix` / `format` / `format:check` 脚本。最小测试框架未纳入本轮（可选后续）。

---

## 一、P0 · 必修

### 1.1 【安全】内联 HTML 未消毒，存在 XSS 执行面

**位置**：`src/editor/features/htmlInline.ts:170`

```ts
inner.innerHTML = node.attrs.value   // ← 文档里的原始 HTML 原样执行
```

**风险链**：`value` 直接来自被打开 `.md` 文件的原始 HTML。恶意文档中的
`<img src=x onerror=...>` / `<svg onload=...>` 会在渲染进程执行。虽然
`contextIsolation:true + nodeIntegration:false + sandbox:true` 挡住了直接访问 Node，
但渲染进程仍握有 preload 通过 contextBridge 暴露的文件读写 API → 可达「打开一份 md 即被读写本地文件」。

**为什么现在才暴露**：这是「Markdown 往返保真」红线的副作用——为了原样写回，
`toDOM` 把原文整段塞进 `innerHTML`，没有区分「存储」与「渲染」两种用途。

**推荐修法（不破坏往返保真）**：只消毒**渲染**路径，保留**序列化**路径的原始值。
- `toMarkdown` 继续写 `node.attrs.value`（原始 HTML）→ 往返保真不受影响；
- `toDOM` 改为注入**消毒后**的 HTML。

依赖选择：项目**已**在 node_modules 里有 `dompurify`（`@milkdown/components` 的传递依赖），
但**不是直接依赖**，不能直接 import（传递依赖随时可能被提升/移除，属脆弱引用）。
建议显式 `npm i dompurify` 后再用；不要自己手写正则消毒（安全代码不自造）。

### 1.2 【BUG】图床上传成功提示缺 `{n}` 占位符，文案错乱

**位置**：`src/i18n/locales/zh-CN.ts:91`、`src/i18n/locales/en-US.ts:91`、`src/App.vue:531`

```ts
// zh-CN: '已上传 张图片到图床'
// en-US: ' images uploaded to host'   ← 注意开头空格，原设计是「数字+文案」拼接
// App.vue:531
showToast(`${U.toastImgHostPublishOk}${res.uploaded}${failedText}`, 'ok')
```

**实际渲染**：中文「已上传 张图片到图床5」、英文「 images uploaded to host5」。
根因是中英语序不同（中文数字插在中间，英文数字在前），拼接式写法无法两全。

**修法**：改为占位符 + 替换，与项目既有 `snapshotCount: '{n} 份'` 写法统一。
- zh-CN → `'已上传 {n} 张图片到图床'`
- en-US → `'{n} images uploaded to host'`
- App.vue:531 → `.replace('{n}', String(res.uploaded))`

**连带**：`App.vue:530` 复用 `U.statusUnsaved`（未保存 / Unsaved）当失败计数后缀，
渲染成「，2 未保存」，语义错误。应新增独立 key（如 `{n} 张失败` / `{n} failed`）。

---

## 二、P1 · 应修

### 2.1 【架构】`App.vue` 已退化为上帝组件（1437 行 / 16 类职责）

单一组件内同时承载：笔记库、多标签、外部改动同步、打开保存、**导出编排**、
图床上传、外观、偏好、帮助、面板显隐、快照、凝神 2.0、多文件合订、语言切换、
会话持久化、导出提示。

**最该切走的一块是导出编排**（约 360 行，618–975 行区间）：
`buildExportContent` / `writeExport` / `doExport` / `confirmExport` / `onCompile`
全是**与 UI 无关**的纯编排逻辑，而项目**已经有 `src/export/` 模块**（内含
docx/epub/rtf/odt/markdownToLatex/docTemplate 等 11 个文件）却唯独把编排留在组件里。

**建议**：在 `src/export/` 下新增 `buildExport.ts`，把这 5 个函数连同 `BuiltExport`
类型整体迁入；`App.vue` 只保留「弹对话框 + 调编排 + toast」三件事。
这是本次审查中**收益最大的一次重构**，且为纯搬迁、行为不变，风险可控。

同类项：`SnapshotPanel.vue`(1493)、`Sidebar.vue`(1241) 体量也偏大，但职责相对内聚，优先级次于 App.vue。

### 2.2 【BUG】死三元

**位置**：`src/components/Sidebar.vue:320`

```ts
{ action: 'rename', label: node.type === 'dir' ? '重命名' : '重命名' }
```

两个分支完全相同，判定无意义（多半是「文件/文件夹用不同措辞」的残留）。
顺带：整个 `buildMenuItems`（317–321）的 label 全是硬编码中文。

### 2.3 【重复实现】三处拷贝

| 重复项 | 位置 | 建议 |
|---|---|---|
| `baseName()` ×3 | `App.vue:535`、`TabBar.vue:21`（逐字符相同，兜底 `'document'`）、`CompilePanel.vue:79`（兜底 `'vault'`） | 提到 `src/utils/`，加 fallback 参数 |
| `escapeRegExp()`+`buildRegex()` ×2 | `find-source.ts:15,19` 与 `find-wysiwyg.ts:49,53`（逐字符相同） | 合并进 `src/utils/` |
| HTML/XML 转义 ×6 | `docTemplate.ts:197`、`mathjax.ts:86`、`mermaid.ts:46`、`odt.ts:9`、`SearchResults.vue:25`、`domUtils.ts:128`(`escapeXml`) | 收敛为「文本转义 + 属性转义」两个函数 |

> 注：`escapeXml`（`domUtils.ts:128`）是事实上的公共实现，`epub.ts` / `odt.ts` 已在复用，可作为收敛基准。
> `SearchResults.vue:25` 只转义 `& < >` 而漏了 `"` —— 当前用法是拼进 HTML 文本而非属性，暂安全，但很脆弱。

---

## 三、P2 · 建议

1. **补工程化工具链**（本轮缺失，是 P1 类问题长期潜伏的根因）
   - `package.json` 的 devDependencies 里**没有任何 lint/format 工具**，也没有测试框架。
   - 建议引入 `eslint` + `@typescript-eslint` + `eslint-plugin-vue` + `prettier`，
     先把 `no-explicit-any`、`vue/no-unused-components` 等规则开起来（当前 `any` 集中在
     micromark 扩展文件，可用局部 disable 精确豁免，避免一刀切）。
   - 已有 `npm run verify:md`（scripts/verify-markdown.mjs）作为唯一的正确性护栏，
     说明项目认可「脚本化校验」这条路，可顺势补最小测试。

2. **清理死导出**
   - `src/export/domUtils.ts:213` `toUint8Array` —— 全仓零调用
   - `src/export/serialize.ts:18` `needsSerialization` —— 全仓零调用
   - `src/i18n/locales/en-US.ts:426` `export type Locale` —— 未被引用（实际引用的是 zh-CN 的同名类型）

3. **硬编码中文收编进 i18n**（约 40 处，按优先级）
   - 界面可见文字：`TitleBar.vue:90,93,97`（导出菜单分组）、`Sidebar.vue:317-321`（右键菜单）、
     `LoadingBar.vue:33`（重试按钮）、`ConfirmDialog.vue:41,49`（默认按钮）、
     `SearchResults.vue:43,44`（命中数）、`App.vue:59,455,457,473`
   - 注入文档 DOM 的错误态：`mathjax.ts:104` `⚠ 公式无法渲染`、`mermaid.ts:56` `图表语法有误`
   - 导出侧：`export/types.ts:53-69` 的 9 个文件类型名（出现在系统保存对话框，
     而 `ui.exportMenuMd/Txt/Html/…` 已有对应译文，直接复用即可）、
     `docTemplate.ts:240,258`、`epub.ts:32,34`
   - aria-label / title：`TitleBar.vue:301-322`（自绘窗口按钮）、`Outline.vue:34,39`、
     `SnapshotPanel.vue:376`、`StatsPopover.vue:51`、`Sidebar.vue:473-733` 等
   - 顺带两处硬编码全角冒号：`LinkCheckPanel.vue:75`、`StatsPopover.vue:113`

4. **`TitleBar.vue:114` 的 `as any`** —— `emit(action as any)` 属偷懒，
   应把 emit 的联合类型收紧，能顺带挡住非法 action 字符串。

5. **构建垃圾与流程**
   - 根目录 `electron.vite.config.1788093926226.mjs`、`electron.vite.config.1788100448005.mjs`
     是 electron-vite 编译 TS 配置产生的临时产物，已被 `.gitignore:10` 覆盖（不污染 git），
     但会随每次构建累积，建议纳入清理脚本。
   - 工作树当前有 2 个**未提交**文件（`MilkdownEditor.vue`、`mathjax.ts`，即上一轮 `\eqref` 改动），
     审查基线基于此状态；建议先决定提交或回退，避免与后续修改混淆。

---

## 四、已验证为「健康」的项（无需处理）

- **资源清理到位**：`App.vue:1040`、`EditorHost.vue:543`、`MilkdownEditor.vue:345`、
  `TabBar.vue:124`（含 `ro?.disconnect()`）、`ReadingProgress.vue:119`、`ContextMenu.vue:64`
  等均在 `onBeforeUnmount` 成对解绑；定时器均有 `clearTimeout` 配对。
- **i18n key 完备**：zh-CN / en-US 各 336 个 key，双向缺失为 0，插值变量集合逐 key 一致。
- **无孤儿文件**：65 个 `.ts/.vue` 全部至少被一处 import。
- **无技术债标记**：全仓 0 处 `TODO` / `FIXME` / `HACK` / `@ts-ignore` / `eslint-disable`。
- **console 使用克制**：仅 7 处，且全在错误路径、均带 `[export]` 前缀（`i18n/index.ts:55` 那处在注释里）。
- **核心能力无重复**：日期格式化、防抖节流、文本统计均为唯一实现并正确复用。
- **`pinia` / `katex` 非死依赖**：pinia 有 `main.ts` 注入 + 两个 store；katex 仅引入 CSS 供 Crepe 的 latex 特性使用。
