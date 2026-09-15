/**
 * 统一索引层生命周期：内存索引 + 路径映射缓存 + 防抖落盘 + 目录级防抖对齐 +
 * 迁移后的增量同步（移除旧条目 → 登记新条目 → 重解析被改写来源）。
 *
 * 铁律：严格增量，禁全库周期重算；迁移同步只动受影响条目，不触发全库 reconcile。
 */

import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import * as Idx from '../vaultIndex'
import { isMarkdown } from '../vaultIndex'
import { reportSoftError } from '../softError'
import { isProgrammaticSuppressed } from './context'

/**
 * 「重命名 / 移动」收口：先改写全库 `[[引用]]`，再刷新索引（**顺序不可换**）。
 *
 * 顺序依据：改写必须在索引仍是旧路径时进行，否则 `[[旧基名]]` 已解析不到旧绝对路径。
 * 返回被改写的链接 / 文件数，供渲染层提示「已同步更新 N 处引用」。
 */
export async function rewriteLinksThenRefreshIndex(
  moves: { from: string; to: string }[],
): Promise<{ files: number; links: number }> {
  if (!idx || idxRoot === null || moves.length === 0) return { files: 0, links: 0 }
  const root = idxRoot
  const summary = await Idx.rewriteLinksForMoves(root, idx, moves).catch(() => null)
  await refreshIndexAfterMove(root, moves, summary?.sources ?? [])
  return { files: summary?.files ?? 0, links: summary?.links ?? 0 }
}

/**
 * 迁移后的索引同步：移除旧条目 → 用「含新路径」的映射登记新条目 → 重解析被改写的来源。
 * 只动受影响的少数条目，不触发全库 reconcile（大库无感，延续批次零铁律①）。
 */
export async function refreshIndexAfterMove(
  root: string,
  moves: { from: string; to: string }[],
  rewrittenSources: string[],
): Promise<void> {
  if (!idx || idxRoot !== root) return
  for (const m of moves) Idx.removeFileFromIndex(idx, m.from)
  invalidateMaps()
  // 映射需同时含「新路径」与「未移动的既有文件」，被改写的来源才能解析到新目标
  const maps = Idx.buildPathMaps([...Object.keys(idx.files), ...moves.map((m) => m.to)], root)
  for (const m of moves) {
    try {
      const content = await readFile(m.to, 'utf-8')
      const mtime = (await stat(m.to)).mtimeMs
      Idx.indexFile(idx, root, m.to, content, mtime, maps)
    } catch (e) {
      reportSoftError('index.reparse', e, 'debug')
      // 读不到则交给 watcher 兜底
    }
  }
  for (const src of rewrittenSources) {
    try {
      const content = await readFile(src, 'utf-8')
      const mtime = (await stat(src)).mtimeMs
      Idx.indexFile(idx, root, src, content, mtime, maps)
    } catch (e) {
      reportSoftError('index.reparse', e, 'debug')
      // 忽略：watcher 会兜底
    }
  }
  invalidateMaps()
  scheduleSave(root)
}

/* ── 统一 vault 索引层（批次零地基，供搜索 / 双链 / 标签 / 图谱消费） ── */

let idx: Idx.VaultIndex | null = null
let idxRoot: string | null = null
/** 路径解析映射缓存：增删 / 目录变动时失效，内容变更事件复用，避免每次编辑 O(n) 重建 */
let pathMaps: { byBase: Map<string, string>; byRel: Map<string, string> } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let reconcileTimer: ReturnType<typeof setTimeout> | null = null

export function invalidateMaps(): void {
  pathMaps = null
}

function getMaps(root: string): { byBase: Map<string, string>; byRel: Map<string, string> } {
  if (!pathMaps) {
    pathMaps = Idx.buildPathMaps(idx ? Object.keys(idx.files) : [], root)
  }
  return pathMaps
}

/** 索引变更后防抖落盘（沿用项目 temp+rename 原子写，缓存丢失静默重建） */
export function scheduleSave(root: string): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (idx && idxRoot === root) void Idx.saveIndex(root, idx).catch(() => {})
  }, 800)
}

/** 目录级变动（新建/删除文件夹）后防抖全量对齐：仅重解析 mtime 变化者，禁周期重算 */
export function scheduleReconcile(root: string): void {
  // 程序化改动（create/rename/move/delete）已由每文件 add/unlink 事件增量维护索引，
  // 全量 reconcile 纯属冗余且在大库上极重，跳过它避免「建个空文件夹都要走一遍全库」
  if (isProgrammaticSuppressed()) return
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    if (!idx || idxRoot !== root) return
    void (async () => {
      idx = await Idx.reconcileIndex(root, idx)
      invalidateMaps()
      scheduleSave(root)
    })()
  }, 1000)
}

/**
 * 取得（或惰性构建）当前库索引。磁盘已有且版本匹配直接载入，否则一次性全量构建后落盘。
 * 载入旧缓存后**必须 reconcile**：watcher 是 `ignoreInitial:true`，应用关闭期间外部改动
 * （别的编辑器改了 frontmatter、Git 切分支、资源管理器增删文件）在重开库时不会触发任何
 * 事件，若不 reconcile，磁盘已变的元数据会永远停在旧缓存值——典型表现：在外部把 frontmatter
 * 的 `moc:true` 改好后重开库，内容地图仍显示「不是内容地图」。reconcileIndex 仅重解析 mtime
 * 变化的文件（大库无感），且会在无变化时原样返回，不会做多余 IO。
 * 绝不抛错中断主流程。
 */
export async function ensureIndex(root: string): Promise<Idx.VaultIndex> {
  if (idx && idxRoot === root && idx.version === Idx.INDEX_VERSION) return idx
  const loaded = await Idx.loadIndex(root)
  if (loaded) {
    idx = loaded
    // 打开库时一次性对齐：仅重解析磁盘已变动者，禁周期重算（铁律①）
    idx = await Idx.reconcileIndex(root, idx)
    scheduleSave(root)
  } else {
    idx = await Idx.buildIndex(root)
    void Idx.saveIndex(root, idx).catch(() => {})
  }
  idxRoot = root
  invalidateMaps()
  return idx
}

/**
 * 暴露给标签 / 内容地图等聚合面板的「实时索引」：直接返回 watcher 维护的内存索引，
 * 避免每次回读磁盘快照（后者有 800ms 防抖落盘延迟，会导致面板读到陈旧数据、看似不刷新）。
 * 该索引由 watchVault 的增量维护保持最新，与双链 / 搜索同源。
 */
export async function getLiveIndex(root: string): Promise<Idx.VaultIndex> {
  return ensureIndex(root)
}

/** 单文件内容变动（add / change）：读正文 + mtime，增量重解析并修正反向链接 */
export async function reindexFile(root: string, absPath: string): Promise<void> {
  if (!idx || idxRoot !== root || !isMarkdown(basename(absPath))) return
  let content: string
  let mtime: number
  try {
    content = await readFile(absPath, 'utf-8')
    mtime = (await stat(absPath)).mtimeMs
  } catch (e) {
    reportSoftError('index.reindex', e, 'debug')
    return
  }
  Idx.indexFile(idx, root, absPath, content, mtime, getMaps(root))
  scheduleSave(root)
}

/** 单文件删除（unlink）：增量移除并清理反向链接 */
export function deindexFile(root: string, absPath: string): void {
  if (!idx || idxRoot !== root || !isMarkdown(basename(absPath))) return
  Idx.removeFileFromIndex(idx, absPath)
  scheduleSave(root)
}
