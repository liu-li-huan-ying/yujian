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

export const remarkHtmlInline = $remark('remarkHtmlInline', () => () => (tree: any) => {
  const walk = (node: any, parent: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'html' && parent && INLINE_PARENTS.has(parent.type)) {
      node.type = 'htmlInline'
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, node)
    }
  }
  walk(tree, null)
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
    inner.innerHTML = node.attrs.value
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
