/**
 * 元数据解析（frontmatter / 标题层级 / 出链 / 内联标签）。**只产出元数据，不缓存正文。**
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { basename } from 'node:path'
import { wikiLinkRegex } from '../../shared/wikilink-syntax'
import type { IndexEntry } from './types'

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
