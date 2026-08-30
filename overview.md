# 本轮交付概览（2026-08-30）

针对用户反馈的三处问题，完成修复与打磨（Phase 2 批次三 §3.7 链接检查 + 快照时区）。

## 1. 快照时区修复（根因在存储端）
- **根因**：`snapshots.ts` 的 `nowIso()` 用 `toISOString()` 取 UTC 墙钟存文件名，`isoToDate()` 又按本地解析 → 东八区整差 8 小时。
- **修复**：`nowIso()` 改用本机时区 `getFullYear/getHours/...`；新增 `src/utils/time.ts`（`formatDateTime` 走本机时区 + `localTimeZone()` 经 `Intl.DateTimeFormat` 自动取电脑时区）；`SnapshotPanel` 时间戳加「本机时区：{IANA}」tooltip。
- **注意**：此前已落盘的旧快照文件名仍是 UTC 数字，读回偏 8h；新快照已正确。

## 2. 链接检查跳转到具体行（之前只跳页面）
- `BrokenLinkItem` 新增 `context`（断链所在行原文）。
- 点击行 emit 整个 item → `App.onOpenBrokenLink`：打开文档（已是当前文档则跳过早返回）→ 切源码模式 → `revealLine(line)` 精确定位（与全文搜索结果定位同一套逻辑）。

## 3. 面板细节打磨
- 行内展示**所在行原文预览**（等宽、左侧竖线、截断）。
- 顶部「全部 / Wiki / 链接 / 图片」类型筛选（带计数、零项禁用）。
- 汇总按类型拆分计数（Wiki a · 链接 b · 图片 c）。
- 入场动画 + `Esc` 关闭；加载态旋转图标；空/错状态图标（对勾 / 断链）。
- `Icon.vue` 新增 `loader` 旋转图标。

## 验证
- `npm run typecheck` ✅（首轮因 zh/en 漏逗号报 TS1005，已补）；`npm run build` ✅。
- 产物已含 `本机时区`/`Intl.DateTimeFormat`/`linkCheckBreakdown`/`row__ctx`/`context:`，main 包 `toISOString` 计数为 0（UTC 路径已清除）。
- 文档同步：README 功能项、ARCHITECTURE §5.10/§5.12、PHASE2-PLAN §3.7。
- 运行期验收待做：开含断链 vault 实测跳行；GitHub 当前不可达，本地已提交待推送。
