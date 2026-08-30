import matter from 'gray-matter'

/**
 * 文档属性（frontmatter）解析与回写。
 *
 * 红線：Markdown 往返保真 —— 本模块严禁改动正文。
 * - 解析：用 gray-matter 把 YAML 元数据与正文分离，正文 `content` 一字不改返回。
 * - 回写：只对顶部 `---` 块做增删改，正文原样接回；未知字段（用户手写的其他 key）
 *   经 `data` 透传、由 gray-matter 内置 js-yaml 原样保留。
 * - 若全部已知字段清空且无未知字段 → 直接去掉 frontmatter 块，返回纯正文。
 */

export interface FrontmatterParsed {
  /** 解析出的 YAML 数据（可能含任意未知 key） */
  data: Record<string, unknown>
  /** 正文，原文逐字保留 */
  content: string
  /** 原文档是否以合法的 `---` frontmatter 开头 */
  hasFrontmatter: boolean
}

/** 解析 Markdown 文档为「属性 + 正文」 */
export function parseFrontmatter(text: string): FrontmatterParsed {
  const parsed = matter(text)
  return {
    data: (parsed.data ?? {}) as Record<string, unknown>,
    content: parsed.content ?? '',
    hasFrontmatter: /^\s*---\r?\n/.test(text)
  }
}

/** 去掉「空值」字段：空字符串、空数组、null/undefined 一律剔除 */
function stripEmpty(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

/**
 * 把（可能修改后的）数据写回文档。
 * @param data 最终要写入的字段集合（已含未知字段透传）
 * @param content 正文（须为 parseFrontmatter 返回的 content，保证不被改写）
 * @returns 完整文档文本；若 data 为空则返回去除了 frontmatter 的纯正文
 */
export function serializeFrontmatter(
  data: Record<string, unknown>,
  content: string
): string {
  const clean = stripEmpty(data)
  if (Object.keys(clean).length === 0) {
    // 去掉 frontmatter 后，正文顶部可能残留一个多余的换行，归一化掉
    return content.replace(/^\r?\n/, '')
  }
  return matter.stringify(content, clean)
}
