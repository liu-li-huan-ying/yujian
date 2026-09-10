import { access, readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { atomicWrite } from './atomicWrite'
import type {
  BacklinkItem,
  NoteTitleItem,
  UnlinkedMention,
  TagItem,
  TagNoteItem,
  MocItem,
  MocGroup
} from '../shared/ipc-channels'

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
/**
 * 索引结构版本。**改变 IndexEntry 的字段或语义时必须 +1**，否则磁盘上的旧缓存
 * （`.mdeditor/vault-index.json`）会被直接复用，未修改的文件永远拿不到新字段。
 * v2：tags 纳入正文内联 `#标签`（此前只有 frontmatter），并新增 moc 标记。
 */
export const INDEX_VERSION = 2

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
  /** 标签：frontmatter tags 与正文内联 `#标签` 合并去重后的小写 key */
  tags: string[]
  /** 是否为内容地图（MOC）：frontmatter `moc: true` */
  moc: boolean
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

/** 极简 frontmatter 解析：只取 `title` / `tags` / `moc` 三字段，覆盖绝大多数笔记场景 */
function parseFrontmatter(
  content: string
): { title: string; tags: string[]; moc: boolean } {
  const fm = { title: '', tags: [] as string[], moc: false }
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
    } else if (key === 'moc') {
      // YAML 真值的常见写法都认（true/yes/on/1），其余（含缺省）为假
      const v = val.replace(/^["']|["']$/g, '').toLowerCase()
      fm.moc = v === 'true' || v === 'yes' || v === 'on' || v === '1'
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

/**
 * 标签名合法字符：与 src/editor/features/tag.ts 的 TAG_BODY 完全一致，
 * 保证「索引采集到的标签」与「编辑器里渲染的标签」一一对应。
 */
const TAG_BODY_RE = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_\\-/]*'

/**
 * 从正文扫描内联标签 #标签（与 features/tag.ts 的 remark 语义保持一致）。
 * ⚠️ 索引层是裸文本扫描，必须先把代码块 / 行内代码剥掉——`#` 在代码里极常见
 * （CSS `#id`、Python `# 注释`），否则会污染标签；而 remark 层天然不会把代码块内容
 * 解析成 text 节点，故剥除后两边采集结果一致。frontmatter 亦剥除（其中的 tags: 由
 * parseFrontmatter 单独提取，本函数不负责）。
 */
function extractInlineTags(content: string): string[] {
  let text = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  // 1) 剥围栏代码块 ```…``` / ~~~…~~~
  text = text.replace(/^ {0,3}(?:```|~~~)[\s\S]*?^ {0,3}(?:```|~~~)\s*$/gm, ' ')
  // 2) 剥行内代码 `code`
  text = text.replace(/`[^`\n]*`/g, ' ')
  // 3) 与 tag.ts 的 buildTagRe 完全一致的正则（含负向后顾排除 ## 标题 / abc#x）
  const re = new RegExp(`(?<![\\w#])#(${TAG_BODY_RE})`, 'gu')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1].replace(/[/-]+$/, '')
    if (name) out.push(name)
  }
  return out
}

/** 标签归一：去前导 #、去尾部 / 或 -（#父/ 这类不成形写法不产生空层级） */
function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/[/-]+$/, '')
}

/** 把 wikilink 原始目标归一化为查表 key（去 `./` 前缀、去扩展名）——目标解析的唯一入口，勿另起实现 */
function targetKey(target: string): string {
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
  const inlineTags = extractInlineTags(content)
  const outRaw = extractWikiTargets(content)
  const outLinks: string[] = []
  for (const raw of outRaw) {
    const key = targetKey(raw)
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
  // 标签：frontmatter tags 与正文内联 #标签 合并去重（统一转小写 key，保留原始英文名）
  const tagSet = new Set<string>()
  for (const t of fm.tags) {
    const n = normalizeTag(t)
    if (n) tagSet.add(n.toLowerCase())
  }
  for (const t of inlineTags) {
    if (t) tagSet.add(t.toLowerCase())
  }
  const tags = [...tagSet]
  return {
    mtime,
    title: fm.title || firstH1(content),
    headings: collectHeadings(content),
    outLinks: deduped,
    tags,
    moc: fm.moc
  }
}

/* ── 映射构建（与 checkLinks 同源逻辑） ── */

/** 「基名 / 相对库路径 → 绝对路径」映射（wikilink 目标解析的唯一依据） */
export interface PathMaps {
  byBase: Map<string, string>
  byRel: Map<string, string>
}

export function buildPathMaps(filePaths: string[], root: string): PathMaps {
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

/* ── 双链查询（批次二） ── */

/**
 * 用现成映射解析 wikilink 目标为 vault 内绝对路径；找不到返回 null。
 * 与 `resolveTarget` 同语义，但**不重建映射**——供批量解析的热路径复用（避免每次 O(n) 重建）。
 */
export function resolveTargetWithMaps(maps: PathMaps, target: string): string | null {
  const key = targetKey(target)
  if (!key) return null
  if (key.includes('/')) return maps.byRel.get(key.toLowerCase()) ?? null
  return maps.byBase.get(basename(key).toLowerCase()) ?? null
}

/** 把 wikilink 原始目标解析为 vault 内绝对路径；找不到返回 null */
export function resolveTarget(index: VaultIndex, root: string, target: string): string | null {
  // 复用 buildPathMaps（与 parseFile / checkLinks 同源），不再自建一份映射
  return resolveTargetWithMaps(buildPathMaps(Object.keys(index.files), root), target)
}

/** 加载索引；缺失或损坏则静默全量重建（索引是缓存，绝不应因此弹错） */
async function ensureIndex(root: string): Promise<VaultIndex> {
  const idx = await loadIndex(root)
  if (idx) return idx
  const built = await buildIndex(root)
  await saveIndex(root, built)
  return built
}

/** 解析 wikilink 目标为绝对路径（供编辑器点击跳转 / 一键创建目标笔记） */
export async function resolveWikiTarget(root: string, target: string): Promise<string | null> {
  const index = await ensureIndex(root)
  return resolveTarget(index, root, target)
}

/**
 * 反链面板数据：哪些笔记链接到 `absPath`，并附引用所在行的上下文片段。
 * 直接消费索引已派生的 `backLinks`（目标已是绝对路径），再回读来源文件抽取引用行。
 */
export async function getBacklinksWithContext(
  root: string,
  absPath: string
): Promise<BacklinkItem[]> {
  const index = await ensureIndex(root)
  const sources = index.backLinks[absPath] ?? []
  const out: BacklinkItem[] = []
  const re = /\[\[([^\]\n]+?)\]\]/g
  for (const src of sources) {
    let content: string
    try {
      content = await readFile(src, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      let hit = false
      while ((m = re.exec(line)) !== null) {
        const t = m[1].trim().split('|')[0].split('#')[0].trim()
        if (resolveTarget(index, root, t) === absPath) {
          hit = true
          break
        }
      }
      if (hit) {
        out.push({ path: src, line: i + 1, snippet: line.trim().slice(0, 200) })
        break
      }
    }
  }
  return out
}

/**
 * `[[` 自动补全候选：只取索引里的轻量元数据（路径 / 标题 / 基名），**不读正文**。
 * 由渲染进程在浮层首次弹出时按需拉取并缓存，故大库也不会拖慢编辑器启动。
 */
export async function listNoteTitles(root: string): Promise<NoteTitleItem[]> {
  const index = await ensureIndex(root)
  const out: NoteTitleItem[] = []
  for (const full of Object.keys(index.files)) {
    out.push(toNoteItem(full, index.files[full]))
  }
  return out
}

/**
 * 标签聚合：从索引里收集全部标签（小写 name），统计每枚标签命中的文件数，
 * 并按 `/` 拆分推导出父级与层级深度，供标签面板渲染嵌套树。
 * 数据完全由索引的 tags 元数据派生，不读正文、不存原始图。
 */
export async function listTags(root: string, liveIndex?: VaultIndex): Promise<TagItem[]> {
  const idx = liveIndex ?? (await ensureIndex(root))
  const count = new Map<string, number>()
  for (const full of Object.keys(idx.files)) {
    for (const t of idx.files[full].tags) {
      count.set(t, (count.get(t) ?? 0) + 1)
    }
  }
  const out: TagItem[] = []
  for (const [name, c] of count) {
    const parts = name.split('/')
    const depth = parts.length - 1
    const parent = depth > 0 ? parts.slice(0, -1).join('/') : null
    out.push({ name, count: c, parent, depth })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * 按标签列出旗下笔记（点击标签面板条目时拉取）。支持「父标签含全部子标签」语义：
 * `#项目` 同时命中 `项目`、`项目/进行中`、`项目/完成` 等所有后代。
 * 纯索引元数据，不读正文。
 */
export async function getNotesByTag(
  root: string,
  tag: string,
  liveIndex?: VaultIndex,
): Promise<TagNoteItem[]> {
  const idx = liveIndex ?? (await ensureIndex(root))
  const key = normalizeTag(tag).toLowerCase()
  if (!key) return []
  const out: TagNoteItem[] = []
  for (const full of Object.keys(idx.files)) {
    const entry = idx.files[full]
    if (entry.tags.some((t) => t === key || t.startsWith(key + '/'))) {
      out.push(toNoteItem(full, entry))
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title))
  return out
}

/** 索引条目 → 笔记条目（标题兜底为基名），供标签 / MOC 等聚合复用 */
function toNoteItem(full: string, entry: IndexEntry): TagNoteItem {
  const base = basename(full, extname(full))
  return { path: full, title: entry.title || base, base }
}

/**
 * 列出全库内容地图（frontmatter `moc: true`）。作为主题入口清单，
 * 当前文档不是 MOC 时面板用它给出可跳转的 MOC 列表。纯索引元数据。
 */
export async function listMocs(root: string, liveIndex?: VaultIndex): Promise<MocItem[]> {
  const idx = liveIndex ?? (await ensureIndex(root))
  const out: MocItem[] = []
  for (const full of Object.keys(idx.files)) {
    const entry = idx.files[full]
    if (!entry.moc) continue
    const item = toNoteItem(full, entry)
    out.push({ ...item, tags: [...entry.tags].sort() })
  }
  out.sort((a, b) => a.title.localeCompare(b.title))
  return out
}

/** 单个 MOC 分组的软上限：大库里一枚宽泛标签可能命中上千篇，防面板被刷爆 */
const MAX_MOC_GROUP = 200

/**
 * MOC 下级聚合：把「该 MOC 自身的每一枚标签」「它的出链」「指向它的反链」
 * 各自聚成一组，作为主题入口的下级清单。
 *
 * 语义要点：
 *  - 标签组沿用 getNotesByTag 的「父标签含全部后代」语义（`#项目` 命中 `项目/进行中`）；
 *  - 三类组彼此独立、不跨组去重——同一篇笔记既被标签命中又反链过来是有意义的双重信息；
 *  - 组内去重并排除 MOC 自身（否则每个 MOC 都会把自己列进去）；
 *  - 全程只读索引元数据，不读正文（铁律 2）。
 */
export async function getMocOutline(
  root: string,
  path: string,
  liveIndex?: VaultIndex,
): Promise<MocGroup[]> {
  const idx = liveIndex ?? (await ensureIndex(root))
  const self = idx.files[path]
  if (!self) return []

  const groups: MocGroup[] = []
  /** 把绝对路径集合转成组（排除自身、去重、按标题排序、软上限截断） */
  const buildGroup = (kind: MocGroup['kind'], tag: string, paths: Iterable<string>): void => {
    const seen = new Set<string>()
    const notes: TagNoteItem[] = []
    let truncated = false
    for (const full of paths) {
      if (full === path) continue
      const entry = idx.files[full]
      if (!entry || seen.has(full)) continue
      seen.add(full)
      if (notes.length >= MAX_MOC_GROUP) {
        truncated = true
        break
      }
      notes.push(toNoteItem(full, entry))
    }
    if (notes.length === 0) return
    notes.sort((a, b) => a.title.localeCompare(b.title))
    groups.push({ kind, tag, notes, truncated })
  }

  // 1. 按该 MOC 自身的每一枚标签聚合（含后代标签）
  for (const tag of [...self.tags].sort()) {
    const key = tag.toLowerCase()
    const hit: string[] = []
    for (const full of Object.keys(idx.files)) {
      const entry = idx.files[full]
      if (entry.tags.some((t) => t === key || t.startsWith(key + '/'))) hit.push(full)
    }
    buildGroup('tag', tag, hit)
  }
  // 2. 它链出去的笔记（MOC 里手写的 [[...]] 目录）
  buildGroup('outlinks', '', self.outLinks)
  // 3. 指向它的笔记（把自己挂到该 MOC 的笔记）
  buildGroup('backlinks', '', idx.backLinks[path] ?? [])
  return groups
}

/**
 * 行内「不可提及区」掩码：反引号代码段与已成链的 `[[...]]` 内部都不算未链接提及，
 * 否则会把 `[[笔记名]]` 本身报成未链接（自指循环），也会误伤代码示例。
 */
function maskedPositions(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false)
  const mark = (re: RegExp): void => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true
    }
  }
  mark(/`[^`]*`/g)
  mark(/\[\[[^\]\n]*\]\]/g)
  return mask
}

/** 未链接提及的软上限（与 checkLinks 的 MAX_ITEMS 同源策略，防止面板被高频词刷爆） */
const MAX_MENTIONS = 200

/** 在一篇笔记正文里找出「提到但没加链接」的笔记名片段（跳过围栏代码块与行内代码） */
function findPlainMentions(src: string, content: string, name: string): UnlinkedMention[] {
  const out: UnlinkedMention[] = []
  const hay = name.toLowerCase()
  const lines = content.split(/\r?\n/)
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const low = line.toLowerCase()
    if (!low.includes(hay)) continue
    const mask = maskedPositions(line)
    for (let s = low.indexOf(hay); s !== -1; s = low.indexOf(hay, s + 1)) {
      const e = s + hay.length
      let blocked = false
      for (let k = s; k < e; k++) {
        if (mask[k]) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      out.push({
        path: src,
        line: i + 1,
        snippet: line.trim().slice(0, 200),
        start: s,
        end: e,
        name
      })
    }
  }
  return out
}

/**
 * 未链接提及查询：哪些笔记以**纯文本**提到 `absPath` 的笔记名，却没写成 `[[ ]]`。
 * 与反链同源、同样消费索引；但反链有 `backLinks` 可直接命中，这里必须回读正文扫词，
 * 因此是 O(库内笔记数) 次读文件——仅在面板打开/切文档时按需触发，不做任何周期任务。
 * 排除自身（笔记提到自己的名字不构成有价值的未链接提及）。
 */
export async function getUnlinkedMentions(
  root: string,
  absPath: string
): Promise<UnlinkedMention[]> {
  const index = await ensureIndex(root)
  const name = basename(absPath, extname(absPath))
  if (!name) return []
  const out: UnlinkedMention[] = []
  for (const src of Object.keys(index.files)) {
    if (src === absPath) continue
    let content: string
    try {
      content = await readFile(src, 'utf-8')
    } catch {
      continue
    }
    out.push(...findPlainMentions(src, content, name))
    // 与 checkLinks 同款软上限：极端情况下（笔记名是「的」这类高频词）不让面板被刷爆
    if (out.length >= MAX_MENTIONS) break
  }
  return out
}

/** 单文件原子写（temp + rename），与主进程其它落盘路径同源，避免半截内容 */
async function writeAtomic(path: string, data: string): Promise<void> {
  await atomicWrite(path, data)
}

/**
 * 把一条未链接提及包裹成 `[[笔记名]]` 并写回磁盘。
 * 落笔前按 start/end 回验该处文本仍等于原词——文件在「查询」到「点击」之间若已被改动
 * （外部编辑、别的替换），宁可失败也不写坏内容，绝不静默覆盖。
 * 保留原换行符（CRLF 不退化成 LF），避免整篇在 Git 里变成全量 diff。
 */
export async function wrapUnlinkedMention(root: string, item: UnlinkedMention): Promise<boolean> {
  void root
  const raw = await readFile(item.path, 'utf-8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const idx = item.line - 1
  if (idx < 0 || idx >= lines.length) return false
  const line = lines[idx]
  if (line.slice(item.start, item.end) !== item.name) return false
  lines[idx] = line.slice(0, item.start) + `[[${item.name}]]` + line.slice(item.end)
  await writeAtomic(item.path, lines.join(eol))
  return true
}

/* ── 引用维护：重命名 / 移动时自动改写 [[wikilink]]（需求确认 2026-09-10） ── */

/** 一次移动的「旧绝对路径 → 新绝对路径」；目录移动由调用方展开为「逐篇文档」 */
export interface MovePair {
  from: string
  to: string
}

export interface LinkRewriteSummary {
  /** 被改写的源文件绝对路径（已按新位置计算），供调用方立即刷新索引 */
  sources: string[]
  /** 被改写的来源文件数 */
  files: number
  /** 被改写的链接条数 */
  links: number
}

/**
 * 纯函数：把正文里所有「解析结果属于被移动集合」的 `[[wikilink]]` 目标改写为新写法。
 *
 * 设计要点：
 *  - 逐链接拆分 `target` / `#锚点` / `|别名`，**只替换 target 片段**，锚点与别名原样保留；
 *  - 新写法沿用原链接「形态」：原目标含 `/` 视为路径式 → 用新相对路径；否则用新基名；
 *  - 保留原目标的 `./` 前缀与 `.md` / `.markdown` 扩展名写法，尊重用户书写习惯；
 *  - 新写法与旧写法相同时不计入 changed、也不改动（避免无谓写盘与 Git 全量 diff）；
 *  - 断链（resolve 返回 null）一律不动——改名不该把断掉的链接「猜」到别处；
 *  - 非链接文本逐字节保留（含 CRLF），改写后除目标片段外原文不变。
 *
 * @param content 正文
 * @param resolve 目标 → 绝对路径（**必须用重命名前的映射**，否则解析不到旧目标）
 * @param newTargetOf (解析出的旧绝对路径, 原目标写法) → 新目标写法；返回 null 表示不属于本次移动
 */
export function rewriteWikiLinksInText(
  content: string,
  resolve: (target: string) => string | null,
  newTargetOf: (resolvedAbs: string, originalTarget: string) => string | null
): { text: string; changed: number } {
  let changed = 0
  const text = content.replace(/\[\[([^\]\n]+?)\]\]/g, (full: string, inner: string) => {
    const pipe = inner.indexOf('|')
    const targetPart = pipe === -1 ? inner : inner.slice(0, pipe)
    const rest = pipe === -1 ? '' : inner.slice(pipe) // 含 '|别名'
    const hash = targetPart.indexOf('#')
    const rawTarget = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim()
    const anchor = hash === -1 ? '' : targetPart.slice(hash) // 含 '#锚点'
    if (!rawTarget) return full
    const resolved = resolve(rawTarget)
    if (!resolved) return full
    const next = newTargetOf(resolved, rawTarget)
    if (!next || next === rawTarget) return full
    changed++
    return `[[${next}${anchor}${rest}]]`
  })
  return { text, changed }
}

/** 依据移动清单生成「新目标写法」推导器：沿用原链接形态，保留 `./` 前缀与扩展名写法 */
function makeNewTargetOf(
  root: string,
  toNew: Map<string, string>
): (resolvedAbs: string, originalTarget: string) => string | null {
  return (resolvedAbs, originalTarget) => {
    const to = toNew.get(resolvedAbs.toLowerCase())
    if (!to) return null
    const raw = originalTarget.trim()
    const extMatch = /\.(md|markdown)$/i.exec(raw)
    const ext = extMatch ? raw.slice(-extMatch[0].length) : ''
    const body = raw.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '')
    const next = body.includes('/')
      ? relative(root, to)
          .replace(/\.(md|markdown)$/i, '')
          .split(/[\\/]/)
          .join('/')
      : basename(to, extname(to))
    return (raw.startsWith('./') ? './' : '') + next + ext
  }
}

/**
 * 重命名 / 移动后，改写全库指向旧路径的 `[[wikilink]]`（fs 层编排）。
 *
 * ⚠️ 调用时机不可换：必须在「文件系统已迁移完成、但 `index` 仍是旧路径」的窗口内调用。
 * 此时索引里还留着旧条目，才能把 `[[旧基名]]` 解析回旧绝对路径；一旦索引同步过，
 * 旧条目消失，解析就无从下手。本函数**不修改索引**，索引刷新由调用方接着做。
 *
 * 受影响来源直接取索引已派生的 `backLinks`（零额外全库扫描，只读命中文件）；
 * 只改写「能解析到被移动文档」的链接，断链不动。单文件写失败不影响其余（与 replaceInVault 同款容错）。
 */
export async function rewriteLinksForMoves(
  root: string,
  index: VaultIndex,
  moves: MovePair[]
): Promise<LinkRewriteSummary> {
  const summary: LinkRewriteSummary = { sources: [], files: 0, links: 0 }
  if (moves.length === 0) return summary

  const toNew = new Map<string, string>()
  for (const m of moves) toNew.set(m.from.toLowerCase(), m.to)
  /** 来源文件自身可能也在移动之列（目录移动）→ 落到新位置；否则原地不动 */
  const newPathOf = (p: string): string => toNew.get(p.toLowerCase()) ?? p

  // 反链键大小写可能与路径不一致（Windows 大小写不敏感文件系统的常见坑），统一小写建表再查
  const backLower = new Map<string, string[]>()
  for (const [k, v] of Object.entries(index.backLinks)) backLower.set(k.toLowerCase(), v)
  const sources = new Set<string>()
  for (const m of moves) {
    for (const src of backLower.get(m.from.toLowerCase()) ?? []) sources.add(src)
  }
  if (sources.size === 0) return summary

  // 用「重命名前」的映射解析，才能把链接目标指回旧绝对路径
  const maps = buildPathMaps(Object.keys(index.files), root)
  const resolve = (t: string): string | null => resolveTargetWithMaps(maps, t)
  const newTargetOf = makeNewTargetOf(root, toNew)

  for (const src of sources) {
    const target = newPathOf(src)
    let raw: string
    try {
      raw = await readFile(target, 'utf-8')
    } catch {
      continue
    }
    const { text, changed } = rewriteWikiLinksInText(raw, resolve, newTargetOf)
    if (changed === 0) continue
    try {
      await writeAtomic(target, text)
      summary.files++
      summary.links += changed
      summary.sources.push(target)
    } catch {
      // 单文件写失败不影响其余文件（如只读文件）
    }
  }
  return summary
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
  // 原子写（对 Windows 只读 / 同步锁 EPERM 做兜底）；索引是缓存，写失败绝不应中断主流程
  try {
    await atomicWrite(indexPath(root), JSON.stringify(index))
  } catch {
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

