# 玉笺 · 文档索引

本目录是**唯一**的项目文档所在地。本文件说明每份文档的性质与权威性 ——
「哪句话说了算」写在这里，避免同一件事在几份文档里各说一套。

> ⚠️ **不要随意改名或搬迁 `docs/` 下的文件**：它们的路径被源码注释引用
> （`src/`、`electron/`、`scripts/` 内共 20 余处）。新增文档请在本文件登记。

## 一、权威现状（唯一事实源）

| 文档 | 性质 | 权威性 |
| --- | --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 架构与实现现状；§5.x 按特性分批记录「为什么这么做」 | **架构唯一事实源**。与代码冲突时以代码为准，并立即改本文档 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 面向用户的变更记录（仓库根） | **变更唯一事实源** |
| [`../README.md`](../README.md) / [`../README_EN.md`](../README_EN.md) | 面向使用者的介绍与上手 | 不描述内部实现 |

## 二、已知问题归档

| 文档 | 性质 |
| --- | --- |
| [`EQREF-KNOWN-ISSUE.md`](EQREF-KNOWN-ISSUE.md) | MathJax 块级 `\eqref` 渲染为 `???` 的**取证归档**（已根治）。含现象、**已被证伪的两版旧结论**、事故回放与接线铁律。排查同类问题前必读 —— 免得照着旧结论白走一遍 |

## 三、审计 / 评审报告（写于当时的快照）

| 文档 | 范围 |
| --- | --- |
| [`review/AUDIT-STRUCTURE-2026-09-15.md`](review/AUDIT-STRUCTURE-2026-09-15.md) | **最新**。结构治理审计：架构缺陷 / 上帝模块 / DRY / 建议清单 / 验收标准；**§六 落实结果**逐条对照进度 |
| [`AUDIT-2026-09-14.md`](AUDIT-2026-09-14.md) | 结构与 `any` 逃逸审计（`check:structure` 门禁即由此诞生） |
| [`AUDIT-2026-09-12.md`](AUDIT-2026-09-12.md) | 第二批审计 |
| [`CODE-REVIEW.md`](CODE-REVIEW.md) | 代码评审（P0~P2 分级问题清单） |
| [`CODE-REVIEW-2026-09-10.md`](CODE-REVIEW-2026-09-10.md) | 代码评审（带日期快照） |
| [`REVIEW-OPTIONAL-2026-09-11.md`](REVIEW-OPTIONAL-2026-09-11.md) | 可选优化评审 |

审计/评审报告是**当时状态的快照**，`ARCHITECTURE.md` 不追述其过程。
想看「某条建议到底做了没有」，只看最新一份的落实结果节。

## 四、设计与计划（开工前文档）

| 文档 | 主题 |
| --- | --- |
| [`PHASE2-PLAN.md`](PHASE2-PLAN.md) · [`PHASE2-BATCH1-UI-PLAN.md`](PHASE2-BATCH1-UI-PLAN.md) · [`PHASE2-BATCH2-UI-PLAN.md`](PHASE2-BATCH2-UI-PLAN.md) | Phase 2 规划 |
| [`PHASE3-PLAN.md`](PHASE3-PLAN.md) | Phase 3（PKM）总体规划 —— **六批次决策锁**的出处 |
| [`PHASE3-UI-DESIGN.md`](PHASE3-UI-DESIGN.md) · [`PHASE3-LAYOUT-REDESIGN.md`](PHASE3-LAYOUT-REDESIGN.md) · [`PHASE3-UI-MOCKUP.html`](PHASE3-UI-MOCKUP.html) | Phase 3 界面设计与布局改造（HTML 为可交互设计稿） |
| [`SNAPSHOT-GIT-DESIGN.md`](SNAPSHOT-GIT-DESIGN.md) | 快照 × Git 结合方案 |
| [`FOCUS-MODE-2.0-DESIGN.md`](FOCUS-MODE-2.0-DESIGN.md) | 凝神模式 2.0 |
| [`UI-DESIGN.md`](UI-DESIGN.md) | 早期视觉规范（玉质/玻璃语言、`--hue-*` 色板由来） |
| [`PRODUCT-POLISH-IDEAS.md`](PRODUCT-POLISH-IDEAS.md) | 产品打磨点子池（未排期） |

**计划文档在特性落地后不再更新**，落地后的实际行为一律看 `ARCHITECTURE.md`。

## 五、生成物与资源

| 路径 | 性质 |
| --- | --- |
| [`_structure-analysis.md`](_structure-analysis.md) | `node scripts/analyze-structure.mjs` 的**生成物**（下划线前缀 = 勿手改，会被覆盖） |
| [`preview/`](preview/) | 可交互 HTML 效果预览（中文排版 / 双击选词 / 列宽 / 凝神模式 / 公式编辑 …），改完前端用它自查 |
| [`assets/`](assets/) | README 用 SVG 图形 |

## 六、冲突时的优先级

1. **代码与测试是事实**。文档与之冲突 → 改文档，不改事实。
2. `ARCHITECTURE.md` 管架构、`CHANGELOG.md` 管变更，两者不重复表述同一件事。
3. 审计 / 评审报告只对「当时」负责，不追改；进度看最新一份的落实结果节。
4. 设计 / 计划文档在实现后即冻结，仅作决策留痕。
