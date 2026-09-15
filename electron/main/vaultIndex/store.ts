/**
 * 索引的构建 / 增量 reconcile / 持久化。索引是**可重建缓存**，丢失必须静默重建、绝不弹错。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../atomicWrite'
import { reportSoftError } from '../softError'
import { parseFile } from './metadata'
import { buildPathMaps, shouldSkipDir, isMarkdown } from './paths'
import type { IndexEntry, VaultIndex } from './types'
import { INDEX_VERSION } from './types'

/** 递归收集全部 md 绝对路径（与 listTree 同跳过规则） */
export async function collectMarkdown(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        await walk(full)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out
}

async function fileMtime(p: string): Promise<number> {
  try {
    const s = await stat(p)
    return s.mtimeMs
  } catch (e) {
    reportSoftError('index.mtime', e, 'debug')
    return 0
  }
}

/** 全量构建索引（仅用于初次 / 重建 / 索引损坏时一次性调用，非周期任务） */
export async function buildIndex(root: string): Promise<VaultIndex> {
  const paths = await collectMarkdown(root)
  const { byBase, byRel } = buildPathMaps(paths, root)
  const files: Record<string, IndexEntry> = {}
  for (const p of paths) {
    let content: string
    try {
      content = await readFile(p, 'utf-8')
    } catch (e) {
      reportSoftError('index.parseFile', e, 'warn')
      continue
    }
    files[p] = parseFile(p, content, await fileMtime(p), byBase, byRel)
  }
  const backLinks = deriveBackLinks(files)
  return { version: INDEX_VERSION, files, backLinks }
}

/**
 * 增量 reconcile：仅对「磁盘 mtime 与索引不一致」或「索引中存在但磁盘已删」的文件重解析，
 * 其余直接复用。用于 vault 打开时一次性对齐（非周期任务）。
 */
export async function reconcileIndex(root: string, index: VaultIndex): Promise<VaultIndex> {
  const paths = await collectMarkdown(root)
  const { byBase, byRel } = buildPathMaps(paths, root)
  const current = new Set(paths)

  // 删除磁盘已不存在的条目
  for (const p of Object.keys(index.files)) {
    if (!current.has(p)) delete index.files[p]
  }

  // 仅重解析 mtime 变化的文件
  for (const p of paths) {
    const mt = await fileMtime(p)
    const existing = index.files[p]
    if (existing && existing.mtime === mt) continue
    let content: string
    try {
      content = await readFile(p, 'utf-8')
    } catch {
      delete index.files[p]
      continue
    }
    index.files[p] = parseFile(p, content, mt, byBase, byRel)
  }

  index.backLinks = deriveBackLinks(index.files)
  index.version = INDEX_VERSION
  return index
}

/** 由 files 重新派生反向链接（O(总出链数)） */
export function deriveBackLinks(files: Record<string, IndexEntry>): Record<string, string[]> {
  const back: Record<string, string[]> = {}
  for (const [from, entry] of Object.entries(files)) {
    for (const to of entry.outLinks) {
      ;(back[to] ??= []).push(from)
    }
  }
  // 去重 + 排序，保证稳定
  for (const k of Object.keys(back)) {
    back[k] = Array.from(new Set(back[k])).sort()
  }
  return back
}

/** 索引单文件（增量）。会同时修正反向链接中受影响的条目。
 *  @param maps 可选：预先构建的「基名/相对路径 → 绝对路径」映射，传入可避免每次编辑 O(n) 重建；
 *              不传则临时由当前索引文件列表重建（全量构建 / reconcile 路径使用）。 */
export function indexFile(
  index: VaultIndex,
  root: string,
  absPath: string,
  content: string,
  mtime: number,
  maps?: { byBase: Map<string, string>; byRel: Map<string, string> }
): void {
  const { byBase, byRel } = maps ?? buildPathMaps(Object.keys(index.files), root)
  const old = index.files[absPath]
  const oldOut = old?.outLinks ?? []
  const entry = parseFile(absPath, content, mtime, byBase, byRel)
  index.files[absPath] = entry

  // 修正反向链接：移除旧、加入新
  const newOut = new Set(entry.outLinks.map((p) => p.toLowerCase()))
  for (const prev of oldOut) {
    if (!newOut.has(prev.toLowerCase())) {
      const arr = index.backLinks[prev]
      if (arr) {
        index.backLinks[prev] = arr.filter((f) => f !== absPath)
        if (index.backLinks[prev].length === 0) delete index.backLinks[prev]
      }
    }
  }
  for (const next of entry.outLinks) {
    const arr = (index.backLinks[next] ??= [])
    if (!arr.includes(absPath)) arr.push(absPath)
  }
}

/** 移除单文件（增量），清理其反向链接 */
export function removeFileFromIndex(index: VaultIndex, absPath: string): void {
  const oldOut = index.files[absPath]?.outLinks ?? []
  delete index.files[absPath]
  for (const prev of oldOut) {
    const arr = index.backLinks[prev]
    if (arr) {
      index.backLinks[prev] = arr.filter((f) => f !== absPath)
      if (index.backLinks[prev].length === 0) delete index.backLinks[prev]
    }
  }
}

/* ── 双链查询（批次二） ── */

/** 加载索引；缺失或损坏则静默全量重建（索引是缓存，绝不应因此弹错） */
export async function ensureIndex(root: string): Promise<VaultIndex> {
  const idx = await loadIndex(root)
  if (idx) return idx
  const built = await buildIndex(root)
  await saveIndex(root, built)
  return built
}

/** 索引缓存目录名：同时是「库根」标记之一（与 .yujian-history 一起用于向上定位库根） */
export const INDEX_DIR_NAME = '.mdeditor'

function indexDir(root: string): string {
  return join(root, INDEX_DIR_NAME)
}

function indexPath(root: string): string {
  return join(indexDir(root), 'vault-index.json')
}

export async function loadIndex(root: string): Promise<VaultIndex | null> {
  try {
    const raw = await readFile(indexPath(root), 'utf-8')
    const data = JSON.parse(raw) as VaultIndex
    if (typeof data !== 'object' || !data.files || !data.backLinks) return null
    if (data.version !== INDEX_VERSION) return null
    return data
  } catch {
    return null
  }
}

export async function saveIndex(root: string, index: VaultIndex): Promise<void> {
  // 原子写（对 Windows 只读 / 同步锁 EPERM 做兜底）；索引是缓存，写失败绝不应中断主流程
  try {
    await atomicWrite(indexPath(root), JSON.stringify(index))
  } catch (e) {
    reportSoftError('index.save', e)
    // 索引是缓存，写失败绝不应中断主流程
  }
}

export async function indexExists(root: string): Promise<boolean> {
  try {
    await access(indexPath(root))
    return true
  } catch {
    return false
  }
}

/* ── 关系图谱（批次三之三）────────────────────────────
 * 图数据完全由索引派生：节点=文件，边=出链（索引里已解析为 vault 内绝对路径）。
 * 纯函数、零 Electron 依赖，便于在 Node 里单测（test-core [L] 段）。
 */
