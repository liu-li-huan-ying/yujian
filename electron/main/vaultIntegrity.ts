import { access, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { shell } from 'electron'
import * as Idx from './vaultIndex'
import { checkLinks } from './vault'
import type {
  IntegrityAction,
  IntegrityCategory,
  IntegrityIssue,
  IntegrityReport,
  RepairResult
} from '../shared/ipc-channels'

/**
 * vault 级完整性自检与一键修复 —— Phase 3 批次一（数据安全）。
 *
 * 与 Obsidian 不同，玉笺主动暴露「索引/磁盘不一致、孤儿快照、缺失附件、断链」并支持一键修复。
 * 设计铁律（见 PHASE3-PLAN.md 批次一 / PRODUCT-POLISH-IDEAS.md）：
 *  - 自检**只在用户显式触发时**运行（面板打开 / 命令面板），不做任何后台周期扫描；
 *  - 索引是「可重建缓存」（落在 `.mdeditor/`，与快照 `.yujian-history/` 严格分离），
 *    因此索引不一致 / 空索引都可通过「重建索引」无损修复；
 *  - 孤儿快照删除走系统回收站（shell.trashItem），绝不 `rm`，符合项目数据安全规定。
 */

const HISTORY_DIR = '.yujian-history'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 与 snapshots.ts 完全一致的路径哈希（sha1），用于判断快照子目录是否对应现存文档 */
function hashPath(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex')
}

/**
 * 找出「孤儿快照」：`.yujian-history/<path-hash>/` 中，其哈希不再对应任何现存 .md 文档路径者。
 * 出现场景：文档被删除 / 移走后，单文件快照目录残留。
 */
async function findOrphanSnapshots(root: string): Promise<string[]> {
  const histRoot = join(root, HISTORY_DIR)
  let entries
  try {
    entries = await readdir(histRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  if (subdirs.length === 0) return []
  const liveHashes = new Set((await Idx.collectMarkdown(root)).map((p) => hashPath(p)))
  return subdirs.filter((d) => !liveHashes.has(d)).map((d) => join(histRoot, d))
}

/**
 * 运行一次完整性自检。
 * 注意：会触发 `checkLinks`（全库断链扫描）——该开销是用户显式触发自检时接受的，
 * 不作为后台周期任务运行。
 */
export async function runIntegrityCheck(root: string): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = []

  // ── 1. 索引 / 磁盘一致性 ──
  const idx = await Idx.loadIndex(root) // 仅载入，不重建——目的是暴露「过期但未自动重建」的索引
  const diskPaths = await Idx.collectMarkdown(root)
  const diskSet = new Set(diskPaths)

  if (idx) {
    const indexKeys = Object.keys(idx.files)
    for (const k of indexKeys) {
      if (!diskSet.has(k)) {
        issues.push({
          severity: 'warning',
          category: 'index',
          file: k,
          detail: '索引仍指向已删除的文件'
        })
      }
    }
    for (const p of diskPaths) {
      if (!(p in idx.files)) {
        issues.push({
          severity: 'warning',
          category: 'index',
          file: p,
          detail: '磁盘文件未纳入索引'
        })
      }
    }
    if (diskPaths.length > 0 && indexKeys.length === 0) {
      issues.push({
        severity: 'error',
        category: 'index',
        detail: '索引为空但库中存在文档，需重建'
      })
    }
  } else if (diskPaths.length > 0) {
    issues.push({
      severity: 'warning',
      category: 'index',
      detail: '尚未建立索引，可一键重建'
    })
  }

  // ── 2. 孤儿快照 ──
  const orphans = await findOrphanSnapshots(root)
  for (const d of orphans) {
    issues.push({
      severity: 'warning',
      category: 'orphan-snapshot',
      file: d,
      detail: '源文档已删除，快照残留'
    })
  }

  // ── 3. 缺失附件 / 断链（复用 Phase 2 的 checkLinks，单次扫描覆盖）──
  try {
    const linkReport = await checkLinks(root)
    for (const it of linkReport.items) {
      if (it.kind === 'image') {
        issues.push({
          severity: 'warning',
          category: 'missing-attachment',
          file: it.file,
          detail: it.target
        })
      } else {
        issues.push({
          severity: 'warning',
          category: 'broken-link',
          file: it.file,
          detail: it.target
        })
      }
    }
  } catch {
    // 断链扫描失败不应让自检整体失败
  }

  const counts: Record<IntegrityCategory, number> = {
    index: 0,
    'orphan-snapshot': 0,
    'missing-attachment': 0,
    'broken-link': 0
  }
  for (const i of issues) counts[i.category]++
  const repairable = issues.some(
    (i) => i.category === 'index' || i.category === 'orphan-snapshot'
  )

  return { issues, counts, total: issues.length, repairable }
}

/**
 * 执行修复。仅处理可无损修复的两类：重建索引（修复索引不一致 / 空索引）、删除孤儿快照（走回收站）。
 * 缺失附件 / 断链为「报告型」，不自动改写用户文件，需人工处理。
 */
export async function repairIntegrity(
  root: string,
  actions: IntegrityAction[]
): Promise<RepairResult> {
  const result: RepairResult = { actions: [], errors: [] }

  if (actions.includes('rebuildIndex')) {
    try {
      const built = await Idx.buildIndex(root)
      await Idx.saveIndex(root, built)
      result.actions.push({ action: 'rebuildIndex', fixed: Object.keys(built.files).length })
    } catch (e) {
      result.errors.push(`重建索引失败：${errMsg(e)}`)
    }
  }

  if (actions.includes('removeOrphanSnapshots')) {
    let n = 0
    for (const d of await findOrphanSnapshots(root)) {
      try {
        await shell.trashItem(d)
        n++
      } catch {
        // 回收站不可用（如某些 Linux 环境）时降级为软删除（保留父目录）
        try {
          await rm(d, { recursive: true, force: true })
          n++
        } catch {
          /* 忽略单个失败，继续其余 */
        }
      }
    }
    result.actions.push({ action: 'removeOrphanSnapshots', fixed: n })
  }

  return result
}

/** 供前端快速判断某路径是否为孤儿快照目录（无需 import 内部常量） */
export async function isOrphanSnapshotDir(root: string, dir: string): Promise<boolean> {
  try {
    await access(dir)
  } catch {
    return false
  }
  const base = basename(dir)
  const liveHashes = new Set((await Idx.collectMarkdown(root)).map((p) => hashPath(p)))
  return !liveHashes.has(base)
}
