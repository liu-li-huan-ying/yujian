/**
 * PKM 聚合查询：标签树 / MOC 大纲 / 未链接提及（全部由索引元数据派生，不读正文）。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { wikiLinkRegex } from '../../shared/wikilink-syntax'
import type { NoteTitleItem, UnlinkedMention, TagItem, TagNoteItem, MocItem, MocGroup } from '../../shared/ipc-channels'
import { atomicWrite } from '../atomicWrite'
import { reportSoftError } from '../softError'
import { normalizeTag } from './metadata'
import { ensureIndex } from './store'
import type { IndexEntry, VaultIndex } from './types'

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
  mark(wikiLinkRegex())
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
    } catch (e) {
      reportSoftError('index.unlinkedMentions', e, 'debug')
      continue
    }
    out.push(...findPlainMentions(src, content, name))
    // 与 checkLinks 同款软上限：极端情况下（笔记名是「的」这类高频词）不让面板被刷爆
    if (out.length >= MAX_MENTIONS) break
  }
  return out
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
  await atomicWrite(item.path, lines.join(eol))
  return true
}

/* ── 引用维护：重命名 / 移动时自动改写 [[wikilink]]（需求确认 2026-09-10） ── */
