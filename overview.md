# 本次交付：写作辅助包（Phase 2 批次三 §3.6）

## 做了什么
在「链接健康检查」之后，继续推进批次三，落地**写作辅助包**——一个标题栏「更多 ⌄ · 写作辅助」唤起的玻璃浮层，含两个标签页：

- **属性（frontmatter 表单）**：用项目已依赖的 `gray-matter` 解析文档 YAML 头，提供标题 / 作者 / 描述 / 标签（逗号或空格分隔）/ 日期 五个字段；「应用」只改写顶部 `---` 块、正文逐字保留（严守 Markdown 往返保真），未知字段自动透传；全部清空则直接去块。
- **片段（模板插入）**：内置 8 类常用结构（文档模板 / 代码块 / 表格 / 提示框 / 任务列表 / 脚注 / 流程图 / 公式块），点击即在光标处插入；所见即所得与源码双模式通用。

## 关键技术点
- 新增 `src/editor/frontmatter.ts`（解析 + 回写，正文保真）。
- 新增统一插入入口 `EditorHost.insertText` + `SourceEditor.insertAtCursor`（WYSIWYG 走 ProseMirror `tr.insertText`、源码走 CodeMirror dispatch，替换选区，自动落盘）。
- 新增 `src/components/WritingAidsPanel.vue`（玻璃面板，复用 `.glass` 体系，双标签页，中英文 i18n 完整）。
- 标题栏「更多」菜单加 `writing-aids` 入口；`Icon.vue` 加 `writing` 图标；`App.vue` 接线状态/处理器。
- i18n：zh/en 各加 `ui.writingAids` 21 个键，key 一一对应。

## 验证
- `npm run typecheck` ✅（首轮踩 `Selection.main` 类型坑，改用 `.from`/`.to`）
- `npm run build` ✅（沿用 `npm run build`，不用 `env -u … npx` 静默空转写法）
- 产物 bundle 已含 `写作辅助` / `loadMarkdownExternal` / 新图标路径 `M12 20h9`

## 文档
- README（功能项 + Phase 2 路线图状态更新）
- docs/ARCHITECTURE.md §5.13 写作辅助
- docs/PHASE2-PLAN.md §3.6 标记「已实现」

## 待办 / 建议
- 运行期验收：打开文档点「更多 · 写作辅助」，试填属性并应用（确认正文未变）、插入各类片段。
- 批次三仅余**导出增强**（docx·ePub·LaTeX·PDF + 多文件合订 + Mermaid 转静态图）。
