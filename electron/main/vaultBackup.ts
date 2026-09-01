import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import JSZip from 'jszip'
import type { BackupResult, RestoreResult } from '../shared/ipc-channels'

/**
 * 整库备份与恢复 —— Phase 3 批次一（数据安全）。
 *
 * 与单文件快照（`.yujian-history/`）互补：快照是单文件时间轴，本模块是「整个 vault 的时间点副本」。
 *
 * 实现要点：
 *  - 纯 JS（jszip，无 node-gyp / 编译依赖），符合硬约束。
 *  - 备份排除 `.mdeditor/`（统一 vault 索引，可重建缓存，见 PHASE3-PLAN.md 约束 7），
 *    其余（含 `.yujian-history` 快照、`.assets` 资源、图片等）全部打包。
 *  - 恢复时做「zip slip」路径逃逸防护：任何解包路径一旦逃出目标根即跳过，避免被恶意/损坏归档改写系统文件。
 */

const CACHE_DIR = '.mdeditor'

/** 递归收集需备份的文件（绝对路径），跳过 `.mdeditor` 缓存目录 */
async function collectBackupPaths(root: string): Promise<string[]> {
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
        if (entry.name === CACHE_DIR) continue
        await walk(full)
      } else if (entry.isFile()) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out
}

/** 整库打包为 zip 写入 destZip（用户经保存对话框选定的目标路径） */
export async function backupVault(root: string, destZip: string): Promise<BackupResult> {
  const paths = await collectBackupPaths(root)
  const zip = new JSZip()
  let bytes = 0
  for (const full of paths) {
    const rel = relative(root, full).split('\\').join('/')
    if (!rel) continue
    const buf = await readFile(full)
    zip.file(rel, buf)
    bytes += buf.length
  }
  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(destZip, content)
  return { files: paths.length, bytes }
}

/** 解包 zip 恢复到 targetRoot（覆盖同名文件）。targetRoot 默认为 vault 根，亦支持恢复到新文件夹 */
export async function restoreVault(zipPath: string, targetRoot: string): Promise<RestoreResult> {
  const data = await readFile(zipPath)
  const zip = await JSZip.loadAsync(data)
  await mkdir(targetRoot, { recursive: true })

  let files = 0
  let bytes = 0
  const skipped: string[] = []

  const entries = Object.keys(zip.files)
  for (const name of entries) {
    const entry = zip.files[name]
    if (entry.dir) continue
    // 归一化 + 逃逸防护
    const normalized = name.split('\\').join('/')
    if (normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('../')) {
      skipped.push(name)
      continue
    }
    const dest = resolve(targetRoot, normalized)
    // 二次校验：解析后必须仍落在目标根内
    const rel = relative(targetRoot, dest)
    if (rel.startsWith('..') || resolve(targetRoot, rel) !== dest) {
      skipped.push(name)
      continue
    }
    try {
      const buf = await entry.async('nodebuffer')
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, buf)
      files++
      bytes += buf.length
    } catch {
      skipped.push(name)
    }
  }

  // 触发一次 stat 以确认目标可写（早失败优于静默空恢复）
  await stat(targetRoot).catch(() => {})
  return { files, bytes, skipped }
}
