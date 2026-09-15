# 结构分析（只读诊断）

扫描 160 个文件 · 内部依赖边 417 条

## 1. 循环依赖（Tarjan 强连通分量）

✅ 无循环依赖

## 2. 分层越界

✅ 无越界

## 3. 上帝模块 / Hub 排行

### 行数 Top 20
| 行数 | 文件 | 导出 / 扇入 / 扇出 |
| --- | --- | --- |
| 1459 | `src/App.vue` | 0 / 1 / 49 |
| 1435 | `src/components/Sidebar.vue` | 0 / 1 / 12 |
| 915 | `src/components/SnapshotPanel.vue` | 0 / 1 / 8 |
| 895 | `src/editor/MilkdownEditor.vue` | 0 / 1 / 19 |
| 852 | `src/components/GraphView.vue` | 0 / 1 / 3 |
| 729 | `src/i18n/locales/en-US.ts` | 0 / 1 / 0 |
| 723 | `src/i18n/locales/zh-CN.ts` | 1 / 2 / 0 |
| 692 | `src/editor/EditorHost.vue` | 1 / 2 / 9 |
| 656 | `src/components/TagPanel.vue` | 0 / 1 / 5 |
| 651 | `src/components/IntegrityPanel.vue` | 0 / 1 / 5 |
| 645 | `electron/shared/ipc-channels.ts` | 59 / 48 / 0 |
| 615 | `src/components/ShortcutsSettings.vue` | 0 / 1 / 4 |
| 592 | `src/components/MocPanel.vue` | 0 / 1 / 5 |
| 562 | `src/components/TitleBar.vue` | 0 / 1 / 4 |
| 561 | `src/components/CompilePanel.vue` | 0 / 1 / 5 |
| 554 | `src/components/TabBar.vue` | 0 / 1 / 6 |
| 523 | `src/render/mathjax.ts` | 9 / 3 / 3 |
| 513 | `src/components/LinkCheckPanel.vue` | 0 / 1 / 4 |
| 480 | `src/export/docx.ts` | 1 / 1 / 3 |
| 459 | `src/components/SnapshotDiffView.vue` | 0 / 1 / 3 |

### 扇入 Top 12（被依赖最多 = 真实核心）
| 扇入 | 文件 | 行数 |
| --- | --- | --- |
| 48 | `electron/shared/ipc-channels.ts` | 645 |
| 45 | `src/i18n/index.ts` | 75 |
| 23 | `src/components/Icon.vue` | 102 |
| 19 | `electron/main/softError.ts` | 145 |
| 19 | `electron/shared/error.ts` | 23 |
| 9 | `electron/main/vaultIndex/index.ts` | 25 |
| 8 | `src/export/types.ts` | 108 |
| 8 | `electron/main/vaultIndex/types.ts` | 61 |
| 7 | `src/export/domUtils.ts` | 201 |
| 7 | `src/utils/html.ts` | 11 |
| 5 | `src/appearance.ts` | 120 |
| 5 | `src/editor/zen.ts` | 220 |

### 扇出 Top 12（依赖最多 = 最易受牵连）
| 扇出 | 文件 | 行数 |
| --- | --- | --- |
| 49 | `src/App.vue` | 1459 |
| 19 | `src/editor/MilkdownEditor.vue` | 895 |
| 12 | `src/components/Sidebar.vue` | 1435 |
| 10 | `src/export/buildExport.ts` | 306 |
| 9 | `src/editor/EditorHost.vue` | 692 |
| 8 | `src/components/SnapshotPanel.vue` | 915 |
| 8 | `electron/main/ipc/index.ts` | 25 |
| 8 | `electron/main/vault/treeOps.ts` | 431 |
| 8 | `electron/main/vaultIndex/index.ts` | 25 |
| 7 | `src/composables/useExport.ts` | 268 |
| 7 | `electron/main/ipc/vault.ts` | 112 |
| 7 | `electron/main/vaultIndex/links.ts` | 80 |

### 单文件导出符号 Top 12（接口面过宽 = 未分层）
| 导出数 | 文件 | 行数 |
| --- | --- | --- |
| 59 | `electron/shared/ipc-channels.ts` | 645 |
| 22 | `src/shortcuts.ts` | 308 |
| 11 | `electron/main/snapshots.ts` | 418 |
| 11 | `electron/main/vaultIndex/store.ts` | 221 |
| 10 | `electron/main/softError.ts` | 145 |
| 9 | `src/appearance.ts` | 120 |
| 9 | `src/editor/zen.ts` | 220 |
| 9 | `src/export/buildExport.ts` | 306 |
| 9 | `src/render/mathjax.ts` | 523 |
| 9 | `src/typography.ts` | 107 |
| 9 | `src/utils/keymap.ts` | 169 |
| 9 | `src/utils/snapshotDiff.ts` | 140 |

### 文件数 ≥ 8 的目录（是否已分层）
- `src/components/`：41 文件 / 15702 行 / 最大 1435 行
- `src/export/`：13 文件 / 2441 行 / 最大 480 行
- `src/utils/`：13 文件 / 942 行 / 最大 169 行
- `src/editor/`：12 文件 / 2735 行 / 最大 895 行
- `electron/main/`：12 文件 / 1572 行 / 最大 418 行
- `electron/main/ipc/`：10 文件 / 543 行 / 最大 112 行
- `src/composables/`：9 文件 / 1176 行 / 最大 268 行
- `src/editor/features/`：9 文件 / 1201 行 / 最大 191 行
- `electron/main/vault/`：9 文件 / 1219 行 / 最大 431 行
- `electron/main/vaultIndex/`：9 文件 / 1125 行 / 最大 272 行

## 4. 胖文件分布（≥600 行）

共 12 个（占 160 文件的 8%）

| 行数 | 文件 |
| --- | --- |
| 1459 | `src/App.vue` |
| 1435 | `src/components/Sidebar.vue` |
| 915 | `src/components/SnapshotPanel.vue` |
| 895 | `src/editor/MilkdownEditor.vue` |
| 852 | `src/components/GraphView.vue` |
| 729 | `src/i18n/locales/en-US.ts` |
| 723 | `src/i18n/locales/zh-CN.ts` |
| 692 | `src/editor/EditorHost.vue` |
| 656 | `src/components/TagPanel.vue` |
| 651 | `src/components/IntegrityPanel.vue` |
| 645 | `electron/shared/ipc-channels.ts` |
| 615 | `src/components/ShortcutsSettings.vue` |
