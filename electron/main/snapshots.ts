import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { shell } from 'electron'
import type { SnapshotInfo } from '../shared/ipc-channels'

/**
 * 版本快照存储 —— 本地唯一真源之外的安全网（git 化 Phase A）。
 *
 * 布局：`<vault>/.yujian-history/<path-hash>/`
 *   - `<ISO>__<note>.md`：快照正文（人类可读，向后兼容旧全量快照）
 *   - `index.json`：元数据清单（git reflog 思想）—— 记录 tags / contentHash / parent / file
 *
 * 设计取舍（见 docs/SNAPSHOT-GIT-DESIGN.md）：只借 git 的「内容寻址 + 索引」思想，
 * 不引入 packfile/delta（Markdown 太小，收益为负）。
 *   - 内容哈希去重：相同正文只存一份 .md，多个提交共享（引用计数）。
 *   - tags：命名里程碑（git tag 思想）。
 *   - parent：线性血缘链（**同分支内**）。
 *   - branch：轻量草稿分支（git 分支思想的轻量版，不合并不解决冲突）。
 * 删除走系统回收站（shell.trashItem），绝不 `rm`，符合项目数据安全规定。
 */

const INDEX_FILE = 'index.json'

/** 主线分支名（写作者的主时间轴） */
export const MAIN_BRANCH = 'main'

/** 一条快照的元数据（落盘于 index.json） */
interface SnapshotMeta {
  /** 快照唯一标识 = 文件名去扩展名（含 ISO 时间戳，可排序） */
  id: string
  /** 实际 .md 文件名（内容去重时多个 id 可指向同一 file） */
  file: string
  /** 创建时间（epoch ms） */
  createdAt: number
  /** 可选备注（如「发布前」） */
  note?: string
  /** 命名标签（git tag 思想）：终稿/投稿版/v1.0 等 */
  tags: string[]
  /** 内容 sha1，用于去重与血缘展示 */
  contentHash: string
  /** 所在分支：主线 'main' 或用户命名草稿分支 */
  branch: string
  /** 父快照 id（血缘链，**同分支内**线性）；分支首份为 null */
  parent: string | null
  /** 字符数 */
  charCount: number
  /** 磁盘字节数 */
  size: number
}

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

/** 内容 → sha1（内容寻址去重的键） */
function contentSha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/** 标签清洗：去空、去重、限长 24、限最多 8 个 */
function sanitizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = String(raw ?? '')
      .trim()
      .slice(0, 24)
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
    if (out.length >= 8) break
  }
  return out
}

/**
 * 分支名清洗：去空、限长 32、去掉会干扰展示的标点。
 * 空 / 非法 → 回落主线 'main'（保证 UI 永远有分支可归）。
 */
function sanitizeBranch(name?: string): string {
  const b = String(name ?? '')
    .replace(/[^\w一-龥\s\-_.]/g, '')
    .trim()
    .slice(0, 32)
  return b || MAIN_BRANCH
}

function toInfo(m: SnapshotMeta): SnapshotInfo {
  return {
    id: m.id,
    createdAt: m.createdAt,
    note: m.note,
    tags: m.tags,
    contentHash: m.contentHash,
    branch: m.branch,
    parent: m.parent,
    charCount: m.charCount,
    size: m.size
  }
}

/** 读 index.json；不存在/解析失败则把目录内现有 .md 迁移成 index 并返回 */
async function readIndex(dir: string): Promise<SnapshotMeta[]> {
  let metas: SnapshotMeta[] | null = null
  try {
    const raw = await readFile(join(dir, INDEX_FILE), 'utf-8')
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) metas = arr as SnapshotMeta[]
  } catch {
    // 无 index 或解析损坏 → 走迁移
  }
  // 向后兼容：Phase A 落盘的 index 没有 branch / tags 字段，补齐默认值（不破坏已有数据）
  if (metas) {
    metas = metas.map((m) => ({
      ...m,
      tags: Array.isArray(m.tags) ? m.tags : [],
      branch: sanitizeBranch(m.branch),
      parent: m.parent ?? null
    }))
  }
  if (!metas) metas = await migrate(dir)
  // 校验 file 实际存在，剔除脏条目（手动删 .md 后的残留）
  let files: Set<string>
  try {
    files = new Set((await readdir(dir)).filter((f) => f.endsWith('.md')))
  } catch {
    files = new Set()
  }
  const clean = metas.filter((m) => files.has(m.file))
  if (clean.length !== metas.length) await writeIndex(dir, clean)
  return clean
}

/** 旧版「每文档全量 .md」快照 → 扫描生成 index.json（向后兼容，不丢任何数据） */
async function migrate(dir: string): Promise<SnapshotMeta[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  const metas: SnapshotMeta[] = []
  for (const f of files.sort()) {
    const meta = parseFileName(f)
    const content = await readFile(join(dir, f), 'utf-8').catch(() => '')
    metas.push({
      id: meta.id,
      file: f,
      createdAt: isoToTime(meta.iso),
      note: meta.note,
      tags: [],
      contentHash: contentSha1(content),
      branch: MAIN_BRANCH,
      parent: null,
      charCount: content.length,
      size: content.length
    })
  }
  metas.sort((a, b) => a.createdAt - b.createdAt)
  for (let i = 1; i < metas.length; i++) metas[i].parent = metas[i - 1].id
  await writeIndex(dir, metas)
  return metas
}

async function writeIndex(dir: string, metas: SnapshotMeta[]): Promise<void> {
  await writeFile(join(dir, INDEX_FILE), JSON.stringify(metas, null, 2), 'utf-8')
}

/** 列出某文档的全部快照（按时间倒序） */
export async function listSnapshots(vaultPath: string, filePath: string): Promise<SnapshotInfo[]> {
  const dir = historyDir(vaultPath, filePath)
  const metas = await readIndex(dir)
  return metas
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => toInfo(m))
}

/**
 * 创建快照。
 * - 内容与「任意已有快照」哈希相同 → 不写新 .md，仅新增一条 index 记录指向同一文件（内容寻址去重）。
 * - 否则写一份新 .md。
 * - tags 记入元数据；parent 链向上一份快照。
 */
export async function createSnapshot(
  vaultPath: string,
  filePath: string,
  content: string,
  note?: string,
  tags?: string[],
  branch?: string
): Promise<SnapshotInfo> {
  const dir = historyDir(vaultPath, filePath)
  await mkdir(dir, { recursive: true })

  const metas = await readIndex(dir)
  const hash = contentSha1(content)
  const iso = nowIso()
  const baseName = makeFileName(iso, note).replace(/\.md$/, '')
  const br = sanitizeBranch(branch)

  // 内容去重：blob 跨分支共享（相同正文只存一份 .md，多分支的提交可指向同一 file）
  const dup = metas.find((m) => m.contentHash === hash)
  // 防 id / file 冲突（极端同毫秒或同备注）
  let id = baseName
  if (metas.some((m) => m.id === id)) id = `${baseName}__${hash.slice(0, 6)}`

  let realFile = dup ? dup.file : `${baseName}.md`
  if (!dup) {
    if (metas.some((m) => m.file === realFile)) realFile = `${baseName}__${hash.slice(0, 6)}.md`
    await writeFile(join(dir, realFile), content, 'utf-8')
  }

  // parent 只认**同分支**的上一条 → 每条分支是独立的线性时间轴（无 merge / 无 DAG）
  const sameBranch = metas
    .filter((m) => m.branch === br)
    .sort((a, b) => a.createdAt - b.createdAt)

  const meta: SnapshotMeta = {
    id,
    file: realFile,
    createdAt: isoToTime(iso),
    note: sanitizeNote(note) || undefined,
    tags: sanitizeTags(tags),
    contentHash: hash,
    branch: br,
    parent: sameBranch.length ? sameBranch[sameBranch.length - 1].id : null,
    charCount: content.length,
    size: content.length
  }
  metas.push(meta)
  await writeIndex(dir, metas)
  return toInfo(meta)
}

/** 更新某快照的命名标签（git tag 思想） */
export async function setSnapshotTags(
  vaultPath: string,
  filePath: string,
  id: string,
  tags: string[]
): Promise<SnapshotInfo | null> {
  const dir = historyDir(vaultPath, filePath)
  const metas = await readIndex(dir)
  const meta = metas.find((m) => m.id === id)
  if (!meta) return null
  meta.tags = sanitizeTags(tags)
  await writeIndex(dir, metas)
  return toInfo(meta)
}

/** 读取某快照内容（用于回滚预览/恢复） */
export async function restoreSnapshot(
  vaultPath: string,
  filePath: string,
  id: string
): Promise<string> {
  const dir = historyDir(vaultPath, filePath)
  const metas = await readIndex(dir)
  const meta = metas.find((m) => m.id === id)
  const file = meta ? meta.file : `${id}.md`
  return readFile(join(dir, file), 'utf-8').catch(() => '')
}

/** 删除快照：从 index 移除；仅当无任何其它条目引用同一 .md 时才走回收站物理删除 */
export async function deleteSnapshot(
  vaultPath: string,
  filePath: string,
  id: string
): Promise<void> {
  const dir = historyDir(vaultPath, filePath)
  const metas = await readIndex(dir)
  const idx = metas.findIndex((m) => m.id === id)
  if (idx < 0) return
  const [removed] = metas.splice(idx, 1)
  const stillReferenced = metas.some((m) => m.file === removed.file)
  await writeIndex(dir, metas)
  if (stillReferenced) return
  const target = join(dir, removed.file)
  try {
    await shell.trashItem(target)
  } catch {
    const { unlink } = await import('node:fs/promises')
    await unlink(target).catch(() => {})
  }
}
