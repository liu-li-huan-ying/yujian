import { access, mkdir, readFile, readdir, rename, stat, writeFile, rm } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { SearchOptions } from '../shared/ipc-channels'

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
 * 本文件不依赖 Electron / app / session，纯 Node fs —— 便于 esbuild→mjs 后在 Node 跑往返单测。
 */

const MD_EXT = new Set(['.md', '.markdown'])
export const INDEX_VERSION = 1

/** 索引内的单个文件记录（轻量元数据） */
export interface IndexEntry {
  /** 文档修改时间（ms epoch），用于增量 reconcile */
  mtime: number
  /** 标题：frontmatter title > 首个 H1；为空串表示未知 */
  title: string
  /** 标题层级（heading），最多 50 条，供批次三图谱/大纲复用，不存正文 */
  headings: { level: number; text: string }[]
  /** 解析后的出链（已是 vault 内绝对路径，仅含解析成功的目标） */
  outLinks: string[]
  /** frontmatter tags（归一化为字符串数组） */
  tags: string[]
}

export interface VaultIndex {
  version: number
  /** key = 文档绝对路径 */
  files: Record<string, IndexEntry>
  /** key = 被链接的文档绝对路径；value = 链接到它的文档绝对路径集合 */
  backLinks: Record<string, string[]>
}

/* ── 文件判定（与 listTree / checkLinks 同源，收拢到此避免重复实现） ── */

/** 不应进入笔记库树的目录：点开头（.git/.mdeditor/.vscode 等）、node_modules、同名 .assets */
export function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith('.assets')
}

/** 是否为笔记 Markdown 文件（点开头的文件一律不算） */
export function isMarkdown(name: string): boolean {
  if (name.startsWith('.')) return false
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot > 0 && MD_EXT.has(lower.slice(dot))
}

/* ── 元数据解析（不缓存正文） ── */

/** 极简 frontmatter 解析：只取 `title` 与 `tags` 两字段，覆盖绝大多数笔记场景 */
function parseFrontmatter(
  content: string
): { title: string; tags: string[] } {
  const fm = { title: '', tags: [] as string[] }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!m) return fm
  const block = m[1]
  const lines = block.split(/\r?\n/)
  let inTagsBlock = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (inTagsBlock) {
      // YAML 块列表项：`- foo`
      const item = /^\s*-\s+(.+)$/.exec(line)
      if (item) {
        fm.tags.push(item[1].trim().replace(/^["']|["']$/g, ''))
        continue
      }
      // 块列表结束（遇到下一个 key）
      if (/^\w[\w-]*\s*:/.test(line)) inTagsBlock = false
      else continue
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const val = kv[2].trim()
    if (key === 'title') {
      fm.title = val.replace(/^["']|["']$/g, '')
    } else if (key === 'tags') {
      if (val.startsWith('[')) {
        // 行内数组：[a, b, "c"]
        const inner = val.slice(1, val.lastIndexOf(']'))
        if (inner !== undefined) {
          fm.tags = inner
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean)
        }
      } else if (val.length > 0) {
        // 逗号/空格分隔：a, b, c 或 a b c
        fm.tags = val
          .split(/[,\s]+/)
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      } else {
        // 空值意味着接下来是块列表
        inTagsBlock = true
      }
    }
  }
  return fm
}

/** 取首个 H1 作为标题兜底 */
function firstH1(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const h = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) return h[1].trim()
  }
  return ''
}

/** 收集标题层级（# ~ ######），上限 50 条 */
function collectHeadings(content: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = []
  const re = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (out.length >= 50) break
    out.push({ level: m[1].length, text: m[2].trim() })
  }
  return out
}

/** 提取 wikilink 出链原始目标（去别名、去锚点、去扩展名） */
function extractWikiTargets(content: string): string[] {
  const targets: string[] = []
  const re = /\[\[([^\]\n]+?)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const target = m[1].trim().split('|')[0].split('#')[0].trim()
    if (target) targets.push(target)
  }
  return targets
}

/** 把 wikilink 原始目标归一化为用于查表的 key（去 ./ 前缀、去扩展名） */
function normalizeTarget(target: string): string {
  return target.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '')
}

/**
 * 解析单个文件为 IndexEntry。
 * @param byBase / byRel 由调用方提供（当前库全部 md 的「基名/相对路径 → 绝对路径」映射），用于解析 wikilink 目标。
 */
export function parseFile(
  _absPath: string,
  content: string,
  mtime: number,
  byBase: Map<string, string>,
  byRel: Map<string, string>
): IndexEntry {
  const fm = parseFrontmatter(content)
  const outRaw = extractWikiTargets(content)
  const outLinks: string[] = []
  for (const raw of outRaw) {
    const key = normalizeTarget(raw)
    const resolved = key.includes('/')
      ? byRel.get(key.toLowerCase())
      : byBase.get(basename(key).toLowerCase())
    if (resolved) outLinks.push(resolved)
  }
  // 去重
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const p of outLinks) {
    const norm = p.toLowerCase()
    if (!seen.has(norm)) {
      seen.add(norm)
      deduped.push(p)
    }
  }
  return {
    mtime,
    title: fm.title || firstH1(content),
    headings: collectHeadings(content),
    outLinks: deduped,
    tags: fm.tags
  }
}

/* ── 映射构建（与 checkLinks 同源逻辑） ── */

export function buildPathMaps(filePaths: string[], root: string): {
  byBase: Map<string, string>
  byRel: Map<string, string>
} {
  const byBase = new Map<string, string>()
  const byRel = new Map<string, string>()
  for (const full of filePaths) {
    const base = basename(full, extname(full)).toLowerCase()
    if (!byBase.has(base)) byBase.set(base, full)
    const rel = relative(root, full)
      .replace(/\.(md|markdown)$/i, '')
      .split(/[\\/]/)
      .join('/')
      .toLowerCase()
    if (!byRel.has(rel)) byRel.set(rel, full)
  }
  return { byBase, byRel }
}

/* ── 索引构建 / 增量 / 持久化 ── */

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
  } catch {
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
    } catch {
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

/* ── 持久化（原子写，沿用项目 temp+rename 优势，避免多文件非原子写） ── */

function indexDir(root: string): string {
  return join(root, '.mdeditor')
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
  await mkdir(indexDir(root), { recursive: true })
  const tmp = join(indexDir(root), `.vault-index-${Date.now()}.tmp`)
  try {
    await writeFile(tmp, JSON.stringify(index), 'utf-8')
    await rename(tmp, indexPath(root))
  } catch {
    // 索引是缓存，写失败绝不应中断主流程
    try {
      await rm(tmp, { force: true })
    } catch {
      /* ignore */
    }
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

/* ── 检索辅助（供 searchVault 消费，解除 80 文件 / 20 命中上限） ── */

export interface MetadataHit {
  path: string
  /** 命中字段：filename / title / tag / heading */
  field: 'filename' | 'title' | 'tag' | 'heading'
}

/**
 * 在索引的轻量元数据上做匹配（瞬时，不读正文）。
 * 返回命中文件及命中的字段；用于搜索的「快路径」。
 */
export function matchMetadata(
  index: VaultIndex,
  query: string,
  opts?: SearchOptions
): MetadataHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: MetadataHit[] = []
  const seen = new Set<string>()
  const push = (path: string, field: MetadataHit['field']) => {
    const key = `${path}#${field}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ path, field })
  }
  const matchText = (text: string): boolean => {
    if (!text) return false
    const t = text.toLowerCase()
    if (opts?.wholeWord) {
      // 全词匹配：标题/标签/文件名按词边界
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(q)}([^\\p{L}\\p{N}]|$)`, 'u').test(t)
    }
    return t.includes(q)
  }
  for (const [path, entry] of Object.entries(index.files)) {
    if (matchText(basename(path))) push(path, 'filename')
    if (matchText(entry.title)) push(path, 'title')
    for (const tag of entry.tags) if (matchText(tag)) push(path, 'tag')
    for (const h of entry.headings) if (matchText(h.text)) push(path, 'heading')
  }
  return hits
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
