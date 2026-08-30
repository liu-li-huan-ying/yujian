# 移除顶部搜索（去重）· 交付概览

## 背景
用户指出：早先要求「删除顶部搜索、只保留左侧列表搜索」，但标题栏顶部 `search` 图标按钮仍在且可点击——它唤起的是 `FindPanel`（文档内查找替换），与左侧文件树全局搜索（`searchVault`）是**重复的两套搜索入口**。

## 本次改动
- **彻底移除顶部搜索入口**：
  - 标题栏 `search` 图标按钮 + `find` emit（`TitleBar.vue`）
  - 隐藏入口 Ctrl+F（`App.vue` onKeydown）与帮助面板 Ctrl+F 快捷键项（`HelpPanel.vue`）
  - `FindPanel.vue` 组件文件（`git rm`）及其在 `App.vue` 的全部接线（import / 绑定 / 模板块 / 查找状态与处理函数 / `openPath` 的 clearFind 重跑 / Esc 状态机里的 `.find` 甄别）
- **保留左侧文件树全局搜索**（`Sidebar.vue` → `searchVault`，含全局替换）——即唯一保留的搜索能力。
- **未破坏其他功能**：`EditorHost` 查找引擎方法（find/findNext/replaceOne/clearFind…）作为可复用能力保留，仅去掉 UI 入口；`SnapshotPanel` / `LinkCheckPanel` / 写作辅助等不受影响。
- 文档同步：`ARCHITECTURE.md §5.9`、Esc 描述、`PHASE2-PLAN.md` 文件树说明均标注「顶部搜索入口已移除，仅留左侧全局搜索」。

## 验证
- `npm run typecheck` ✅
- `npm run build` ✅
- 新主块 `index-CbZSl95c.js` 中 `FindPanel` 计数 = 0；`findOpen` 仅命中第三方解析库内部函数（误报，非本功能残留）。
- 源码 grep 确认无 `FindPanel` / `openFind` / `findOpen` / `@find` 残留。

## 状态
- 已本地提交（待 GitHub 恢复推送）。连同前两轮未推提交：写作辅助 `7f93c87`、时区/链接修复 `75fc116`、本轮去重。

## 后续建议
- 运行期验收：打开软件，确认标题栏已无搜索图标、Ctrl+F 不再弹出查找栏，且左侧文件树「搜索文档内容…」全局搜索正常工作。
- 若日后确需要「文档内查找/替换」能力，引擎已就绪，仅需重新加一个入口（建议复用左侧搜索框的同一交互范式，避免再次造成"两套搜索"的观感）。
