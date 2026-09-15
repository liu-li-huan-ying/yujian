/**
 * 元数据解析（frontmatter / 标题层级 / 出链 / 内联标签）。**只产出元数据，不缓存正文。**
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { basename } from 'node:path'
import { wikiLinkRegex } from '../../shared/wikilink-syntax'
import { parseFrontmatter, stripBom } from '../../shared/frontmatter'
import type { IndexEntry } from './types'

/**
 * frontmatter 解析统一走 @shared/frontmatter（gray-matter）。索引层与渲染层共用同一套解析，
 * 避免「手写正则 vs gray-matter」双解析器分歧导致 moc/tags 互相矛盾。本文件只负责
 * 标题层级 / 出链 / 内联标签的采集。
 */

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
  const re = wikiLinkRegex()
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
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/[/-]+$/, '')
}

/** 把 wikilink 原始目标归一化为查表 key（去 `./` 前缀、去扩展名）——目标解析的唯一入口，勿另起实现 */
export function targetKey(target: string): string {
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
  // 统一在入口剥离 BOM：BOM 会让 frontmatter 判定与内联标签扫描失效
  const text = stripBom(content)
  const fm = parseFrontmatter(text)
  const inlineTags = extractInlineTags(text)
  const outRaw = extractWikiTargets(text)
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
    title: fm.title || firstH1(text),
    headings: collectHeadings(text),
    outLinks: deduped,
    tags,
    moc: fm.moc
  }
}

/* ── 映射构建（与 checkLinks 同源逻辑） ── */
