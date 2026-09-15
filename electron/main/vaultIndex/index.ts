/**
 * 统一 vault 索引层 —— 整个 Phase 3 的地基。
 *
 * 设计铁律（见 docs/PRODUCT-POLISH-IDEAS.md §2 / PHASE3-PLAN.md 批次零）：
 *  1. 严格增量：只在 watcher 事件里重解析变动文件，禁止任何遍历全库重算的周期任务；
 *  2. 只存轻量元数据（路径 / mtime / 标题 / 标题层级 / 出链 / 标签），**不缓存正文、不索引全文**；
 *  3. 索引是「可重建缓存」，落在 `.mdeditor/`（与快照 `.yujian-history/` 严格分离）；
 *     丢失必须静默自动重建，不得弹错；
 *  4. 反向链接由出链派生，写入/删除文件时只修正受影响的少数条目。
 *
 * 本包不依赖 Electron / app / session，纯 Node fs —— 便于 esbuild→mjs 后在 Node 跑单测。
 *
 * 公开门面：外部（主进程 / IPC / 测试）只从此处导入，内部子模块可继续细分而不惊动调用方。
 */

export type { IndexEntry, VaultIndex, PathMaps, MovePair, LinkRewriteSummary } from './types'
export { INDEX_VERSION } from './types'
export { parseFile } from './metadata'
export { shouldSkipDir, isMarkdown, buildPathMaps } from './paths'
export { collectMarkdown, buildIndex, reconcileIndex, deriveBackLinks, indexFile, removeFileFromIndex, INDEX_DIR_NAME, loadIndex, saveIndex, indexExists } from './store'
export { resolveTargetWithMaps, resolveTarget, resolveWikiTarget, getBacklinksWithContext } from './links'
export { listNoteTitles, listTags, getNotesByTag, listMocs, getMocOutline, getUnlinkedMentions, wrapUnlinkedMention } from './pkm'
export { rewriteWikiLinksInText, rewriteLinksForMoves } from './rewrites'
export { GRAPH_MAX_NODES, buildGraph } from './graph'
