import DOMPurify from 'dompurify'
import { $nodeSchema, $remark } from '@milkdown/kit/utils'

/**
 * 内联原始 HTML 支持（<kbd>Ctrl</kbd>、<sub>、<sup>、<mark>、<abbr> …）。
 *
 * 为什么需要它：Milkdown 默认没有 HTML 节点，markdown 里的 `<kbd>Ctrl</kbd>` 会被
 * micromark 解析成 `html` 节点，又因为 schema 里没有对应节点而被直接丢弃 —— 这正是
 * 「键盘键适配未实现 / html 还是不支持」的根因。
 *
 * 做法：
 * 1) remark 插件把「行内」的 `html` 节点改写为自定义的 `htmlInline` mdast 节点；
 * 2) schema 把它映射成 ProseMirror 行内原子节点，原样保存原始 HTML 字符串；
 * 3) toDOM 用 innerHTML 渲染（标签不显示、只显示渲染结果），并随皮肤/明暗自动着色；
 * 4) toMarkdown 把原始 HTML 原样写回，保证 Markdown 往返保真。
 *
 * 块级 HTML（独立成行的 <div> 等）暂不接管，沿用 Milkdown 默认行为，避免引入复杂 schema。
 */

export const htmlInlineId = 'html_inline'

/** 行内 HTML 的合法父节点：只有出现在这些行内容器里的 <tag>…</tag> 才转成节点 */
const INLINE_PARENTS = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'tableCell',
  'emphasis',
  'strong',
  'link',
  'delete'
])

/**
 * 自闭合 / 无内容标签：它们没有配对闭合标签，单独成节点即可。
 * 缺少这张表，`<br>` 会被当成未闭合标签而原样丢弃。
 */
const VOID_TAGS = new Set([
  'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'area',
  'base', 'col', 'embed', 'param', 'track', 'wbr'
])

const OPEN_RE = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>'"])*?)(\/)?\s*>$/
const CLOSE_RE = /^<\s*\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>$/

/** 是开标签则返回标签名；是自闭合 / 空标签则返回 null */
function openingTag(raw: string): string | null {
  const m = OPEN_RE.exec(raw.trim())
  if (!m) return null
  if (m[3]) return null // <br/> 自闭合
  const tag = m[1].toLowerCase()
  return VOID_TAGS.has(tag) ? null : tag
}

/** 是闭合标签则返回标签名 */
function closingTag(raw: string): string | null {
  const m = CLOSE_RE.exec(raw.trim())
  return m ? m[1].toLowerCase() : null
}

/**
 * 把「开标签 + 中间内容 + 闭合标签」合并成**一个** htmlInline 节点。
 *
 * 为什么必须合并（血泪）：CommonMark 的行内 HTML 是**逐个标签**解析的，
 * `按 <kbd>Ctrl</kbd> 键` 会被切成三个 mdast 节点：
 *   html("<kbd>") → text("Ctrl") → html("</kbd>")
 * 若照旧把它们各自转成一个 htmlInline 原子节点，渲染结果就是
 *   <kbd></kbd> Ctrl        ← 一个**空键帽**，文字被甩到外面
 * 正是用户痛斥的「左边一小块空白的格式，右边是文字」。
 * 合并后才是 `<kbd>Ctrl</kbd>` 整体，格式真正包裹住文字。
 *
 * 取原文用 position.offset 切片而不是拼接 children：嵌套标签、属性、内部行内标记
 * 都能原样保留，往返保真最稳。拿不到 position 时退化为拼接。
 */
function mergeInlineHtml(children: any[], source: string): any[] {
  const out: any[] = []
  let i = 0
  while (i < children.length) {
    const node = children[i]
    const raw = typeof node?.value === 'string' ? node.value : ''
    const tag = node?.type === 'html' ? openingTag(raw) : null

    if (!tag) {
      // 不是开标签：空标签（<br>/<img>）或孤立闭合标签，单独成节点
      if (node?.type === 'html') {
        out.push({ type: 'htmlInline', value: raw })
      } else {
        out.push(node)
      }
      i += 1
      continue
    }

    // 向后找配对的闭合标签（同层、支持嵌套计数）
    let depth = 1
    let end = -1
    for (let j = i + 1; j < children.length; j++) {
      const c = children[j]
      if (c?.type !== 'html') continue
      const v = typeof c.value === 'string' ? c.value : ''
      if (openingTag(v) === tag) depth += 1
      else if (closingTag(v) === tag) {
        depth -= 1
        if (depth === 0) {
          end = j
          break
        }
      }
    }

    if (end === -1) {
      // 未闭合：退化成单独节点，至少不丢内容
      out.push({ type: 'htmlInline', value: raw })
      i += 1
      continue
    }

    const startOffset = children[i]?.position?.start?.offset
    const endOffset = children[end]?.position?.end?.offset
    const value =
      source && typeof startOffset === 'number' && typeof endOffset === 'number'
        ? source.slice(startOffset, endOffset)
        : children.slice(i, end + 1).map((c) => c.value ?? c.text ?? '').join('')
    out.push({ type: 'htmlInline', value })
    i = end + 1
  }
  return out
}

export const remarkHtmlInline = $remark('remarkHtmlInline', () => () => (tree: any, file: any) => {
  // 合并时要按原文切片，故把源码取出来（remark 的第二个参数就是 VFile）
  const source: string = typeof file?.value === 'string' ? file.value : ''

  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (!Array.isArray(node.children)) return
    // 只有行内容器里的 HTML 才接管；块级 HTML 保持原样
    if (INLINE_PARENTS.has(node.type)) {
      node.children = mergeInlineHtml(node.children, source)
    }
    for (const child of node.children) walk(child)
  }
  walk(tree)
})

export const htmlInlineSchema = $nodeSchema(htmlInlineId, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    value: {
      default: ''
    }
  },
  parseDOM: [
    {
      tag: `span[data-type="${htmlInlineId}"]`,
      getAttrs: (dom: any) => ({
        value: dom.dataset.value ?? ''
      })
    }
  ],
  toDOM: (node: any) => {
    const dom = document.createElement('span')
    dom.dataset.type = htmlInlineId
    dom.dataset.value = node.attrs.value
    dom.className = 'yj-html-inline'
    const inner = document.createElement('span')
    inner.contentEditable = 'false'
    // 只消毒「渲染」路径：文档原始 HTML 可能含 <img onerror> / <svg onload> 等，
    // 必须清洗后再注入 DOM；序列化（toMarkdown）仍写原始值，往返保真不受影响。
    inner.innerHTML = DOMPurify.sanitize(node.attrs.value)
    dom.appendChild(inner)
    return dom
  },
  parseMarkdown: {
    match: (node: any) => node.type === 'htmlInline',
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, { value: node.value })
    }
  },
  toMarkdown: {
    match: (node: any) => node.type.name === htmlInlineId,
    runner: (state: any, node: any) => {
      // 'html' 是 mdast 的「原始 HTML」节点，序列化器会原样输出，保证往返保真
      state.addNode('html', undefined, node.attrs.value)
    }
  }
}))
