/**
 * 文档属性（frontmatter）解析 —— 索引层（vaultIndex/metadata.ts）与渲染层
 * （src/markdown/frontmatter.ts）**共用同一套**解析，彻底消除「双解析器分歧」：
 * 之前索引层用手写极简正则，渲染层用 gray-matter，对带 BOM 或复杂 YAML 的文件会各读各的，
 * 导致「属性面板显示 moc:true，但 MOC 面板说不是内容地图」这类互相矛盾的现象。
 *
 * 统一到 gray-matter（js-yaml）后，两层的 title / tags / moc / hasFrontmatter 必然一致。
 * 红線：本模块只解析元数据，不触碰正文（正文由调用方单独处理）。
 */
import matter from 'gray-matter'

export interface ParsedFrontmatter {
  /** 解析出的 YAML 数据（可能含任意未知 key，供写回时透传） */
  data: Record<string, unknown>
  /** 正文，原文逐字保留（已去除 BOM 与 frontmatter 块） */
  content: string
  /** 原文档是否以合法的 `---` frontmatter 开头（BOM 已在判定前剥离） */
  hasFrontmatter: boolean
  /** 标题：frontmatter `title` 字段（已 trim） */
  title: string
  /** 标签：frontmatter `tags` 规整为字符串数组（不论写作行内数组 / 块列表 / 逗号串） */
  tags: string[]
  /** 是否为内容地图（MOC）：frontmatter `moc` 为真（true/yes/on/1，含布尔/数字/字符串） */
  moc: boolean
}

/** 去掉 UTF-8 BOM：BOM 会让任何「以 --- 开头」的判定失效，且会污染正文首字符 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** moc 真值归一：YAML 可能解析成布尔 true、数字 1 或字符串 "true"/"yes"/"on"/"1" */
export function coerceMoc(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'number') return v === 1
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === 'yes' || s === 'on' || s === '1'
  }
  return false
}

/** tags 规整：数组原样取；字符串按逗号 / 空白拆；其余忽略 */
export function coerceTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  return []
}

/** title 归一：仅取字符串并 trim */
export function coerceTitle(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 解析 Markdown 文档为「属性 + 正文」。
 * @param text 文档全文（BOM 会在内部剥离，不影响结果与正文）
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const clean = stripBom(text)
  const parsed = matter(clean)
  const data = (parsed.data ?? {}) as Record<string, unknown>
  return {
    data,
    content: parsed.content ?? '',
    hasFrontmatter: /^\s*---\r?\n/.test(clean),
    title: coerceTitle(data.title),
    tags: coerceTags(data.tags),
    moc: coerceMoc(data.moc),
  }
}
