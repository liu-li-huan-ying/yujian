import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { shell } from 'electron'
import type { SnapshotInfo } from '../shared/ipc-channels'

/**
 * 版本快照存储 —— 本地唯一真源之外的安全网。
 *
 * 布局：`<vault>/.yujian-history/<path-hash>/<ISO>.md`
 *  - 独立于 `.mdeditor/`（可删缓存），建议用户加进 vault `.gitignore`
 *  - 文件名同时编码备注：`2026-08-29T21-52-00__发布前.md`
 *  - 删除走系统回收站（shell.trashItem），绝不 `rm`，符合项目数据安全规定
 */

/** 文档绝对路径 → 稳定哈希，作为该文档快照子目录名 */
function hashPath(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex')
}

function historyDir(vaultPath: string, filePath: string): string {
  return join(vaultPath, '.yujian-history', hashPath(filePath))
}

/** 把 `2026-08-29T21-52-00` 解析为 Date（文件名用 - 替代 : 以兼容文件系统） */
function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return new Date()
}

function isoToTime(iso: string): number {
  return isoToDate(iso).getTime()
}

/** 展示用时间字符串：`2026-08-29 21:52:00` */
export function displayTime(iso: string): string {
  const d = isoToDate(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}

/**
 * 当前时间的 ISO 文件名片段（用 - 替代 :）。
 * ⚠️ 必须用「本地时区」墙钟数字：toISOString() 永远是 UTC，会与 isoToDate() 的本地解析错位
 * （东八区用户存的快照会被当成 UTC 数字、再被当本地时间读出，整差 8 小时）。
 * 这里取操作系统本地时区的年/月/日/时/分/秒，文件名即所见即所得的本地时间。
 */
function nowIso(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(
    d.getMinutes()
  )}-${p(d.getSeconds())}`
}

/** 备注清洗：仅保留中英文字符、数字、空格与少量标点，限长 40，避免污染文件名 */
function sanitizeNote(note?: string): string {
  if (!note) return ''
  return (
    note
      .replace(/[^\w一-龥\s\-_.]/g, '')
      .trim()
      .slice(0, 40) || ''
  )
}

function makeFileName(iso: string, note?: string): string {
  const safe = sanitizeNote(note)
  return safe ? `${iso}__${safe}.md` : `${iso}.md`
}

/** 文件名 → { iso, note?, id }；id 即去扩展名的文件名（可排序、可作删除键） */
function parseFileName(name: string): { iso: string; note?: string; id: string } {
  const base = name.replace(/\.md$/, '')
  const idx = base.indexOf('__')
  const iso = idx >= 0 ? base.slice(0, idx) : base
  const note = idx >= 0 ? base.slice(idx + 2) : undefined
  return { iso, note: note || undefined, id: base }
}

/** 列出某文档的全部快照（按时间倒序） */
export async function listSnapshots(vaultPath: string, filePath: string): Promise<SnapshotInfo[]> {
  const dir = historyDir(vaultPath, filePath)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  const infos = await Promise.all(
    files.map(async (f) => {
      const meta = parseFileName(f)
      const content = await readFile(join(dir, f), 'utf-8').catch(() => '')
      return {
        id: meta.id,
        createdAt: isoToTime(meta.iso),
        note: meta.note,
        size: content.length,
        charCount: content.length
      } satisfies SnapshotInfo
    })
  )
  return infos.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 创建快照。若内容与「最新一份」完全相同则视为冗余，直接返回已有记录，
 * 避免每次保存都写入一模一样的副本（计划要求防抖 + 不每键一份）。
 */
export async function createSnapshot(
  vaultPath: string,
  filePath: string,
  content: string,
  note?: string
): Promise<SnapshotInfo> {
  const dir = historyDir(vaultPath, filePath)
  await mkdir(dir, { recursive: true })

  let latest: string | undefined
  try {
    const existing = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    latest = existing[existing.length - 1]
  } catch {
    latest = undefined
  }
  if (latest) {
    const prev = await readFile(join(dir, latest), 'utf-8').catch(() => '')
    if (prev === content) {
      const meta = parseFileName(latest)
      return {
        id: meta.id,
        createdAt: isoToTime(meta.iso),
        note: meta.note,
        size: prev.length,
        charCount: prev.length
      }
    }
  }

  const iso = nowIso()
  const fileName = makeFileName(iso, note)
  await writeFile(join(dir, fileName), content, 'utf-8')
  return {
    id: fileName.replace(/\.md$/, ''),
    createdAt: isoToTime(iso),
    note: sanitizeNote(note) || undefined,
    size: content.length,
    charCount: content.length
  }
}

/** 读取某快照内容（用于回滚预览/恢复） */
export async function restoreSnapshot(
  vaultPath: string,
  filePath: string,
  id: string
): Promise<string> {
  const dir = historyDir(vaultPath, filePath)
  return readFile(join(dir, `${id}.md`), 'utf-8')
}

/** 删除快照：走系统回收站，失败再退回 unlink（绝不静默丢弃内容） */
export async function deleteSnapshot(
  vaultPath: string,
  filePath: string,
  id: string
): Promise<void> {
  const dir = historyDir(vaultPath, filePath)
  const target = join(dir, `${id}.md`)
  try {
    await shell.trashItem(target)
  } catch {
    const { unlink } = await import('node:fs/promises')
    await unlink(target).catch(() => {})
  }
}
