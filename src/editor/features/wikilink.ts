import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $nodeSchema, $remark, $inputRule } from '@milkdown/kit/utils'

/**
 * 双向链接 `[[wikilink]]` 真节点支持（Phase 3 批次二核心）。
 *
 * 为什么必须是真节点 + InputRule + to-markdown handler（见 PHASE3-PLAN 红线 6）：
 *   - `[[` 不是 Markdown 标准语法，micromark 会把它当普通文本；
 *   - 若只用「装饰显示 + 导出后处理」，`[[`/`]]` 定界符在往返中必然丢失/被转义；
 *   - 故做成 ProseMirror 原子节点，序列化时由 handler 原样输出 `[[target]]` / `[[target|alias]]`。
 *
 * 与 htmlInline 同理的三处协同：
 *   1) remarkWikilink —— 把正文文本里的 `[[...]]` 改写成自定义 mdast 节点 `wikiLink`；
 *   2) wikiLinkSchema —— 映射成行内原子节点，toDOM 渲染成可点击的芯片，toMarkdown 写回原语法；
 *   3) wikiLinkInputRule —— 敲完 `]]` 即刻把 `[[target]]` 转成节点（否则当下敲了没反应）。
 *
 * 语法：`[[目标]]` / `[[目标|别名]]` / `[[目标#锚点]]`，目标可为文件名或相对路径。
 */

export const wikiLinkId = 'wiki_link'

export interface WikiLinkAttrs {
  target: string
  alias?: string | null
  anchor?: string | null
}

/** 解析 `[[` 与 `]]` 之间的原始内容：拆分别名与锚点 */
function parseInner(inner: string): WikiLinkAttrs {
  const [targetPart, alias] = inner.split('|')
  const [target, anchor] = targetPart.split('#')
  return {
    target: target.trim(),
    alias: (alias ?? '').trim() || null,
    anchor: (anchor ?? '').trim() || null
  }
}

/** 芯片显示文字：优先别名，回落到目标本身 */
function displayText(a: WikiLinkAttrs): string {
  return a.alias || a.target
}

/**
 * remark 插件：行内文本里的 `[[...]]` 改写为 `wikiLink` mdast 节点。
 * 逐节点递归；只对 text 节点做切片替换，其余节点原地保留并继续向下走。
 */
export const remarkWikilink = $remark('remarkWikilink', () => () => (tree: any) => {
  const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g

  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (!Array.isArray(node.children)) return

    const out: any[] = []
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const value = child.value
        let last = 0
        let m: RegExpExecArray | null
        WIKILINK_RE.lastIndex = 0
        while ((m = WIKILINK_RE.exec(value)) !== null) {
          const pre = value.slice(last, m.index)
          if (pre) out.push({ type: 'text', value: pre })
          out.push({ type: 'wikiLink', ...parseInner(m[1]) })
          last = m.index + m[0].length
        }
        const tail = value.slice(last)
        if (tail) out.push({ type: 'text', value: tail })
      } else {
        out.push(child)
        walk(child)
      }
    }
    node.children = out
  }

  walk(tree)
})

export const wikiLinkSchema = $nodeSchema(wikiLinkId, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    target: { default: '' },
    alias: { default: null },
    anchor: { default: null }
  },
  parseDOM: [
    {
      tag: `span[data-type="${wikiLinkId}"]`,
      getAttrs: (dom: any) => ({
        target: dom.dataset.target ?? '',
        alias: dom.dataset.alias || null,
        anchor: dom.dataset.anchor || null
      })
    }
  ],
  toDOM: (node: any) => {
    const dom = document.createElement('span')
    dom.dataset.type = wikiLinkId
    dom.dataset.target = node.attrs.target
    if (node.attrs.alias) dom.dataset.alias = node.attrs.alias
    if (node.attrs.anchor) dom.dataset.anchor = node.attrs.anchor
    dom.className = 'yj-wikilink'
    const label = document.createElement('span')
    label.className = 'yj-wikilink__label'
    label.setAttribute('contenteditable', 'false')
    label.textContent = displayText(node.attrs)
    dom.appendChild(label)
    return dom
  },
  parseMarkdown: {
    match: (node: any) => node.type === 'wikiLink',
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, {
        target: node.target ?? '',
        alias: node.alias ?? null,
        anchor: node.anchor ?? null
      })
    }
  },
  toMarkdown: {
    match: (node: any) => node.type.name === wikiLinkId,
    runner: (state: any, node: any) => {
      const { target, alias } = node.attrs
      const text = alias ? `[[${target}|${alias}]]` : `[[${target}]]`
      // 以纯文本节点写回，保证 `[[`/`]]` 定界符原样保留，Markdown 往返保真
      state.addNode('text', undefined, text)
    }
  }
}))

/** 输入规则：敲完 `]]` 即刻把 `[[目标]]` / `[[目标|别名]]` 转成节点 */
export const wikiLinkInputRule = $inputRule(() =>
  new InputRule(/\[\[([^\]\n]+?)\]\]$/, (state, match, start, end) => {
    const attrs = parseInner(match[1])
    if (!attrs.target) return null
    const node = state.schema.nodes[wikiLinkId].create(attrs)
    return state.tr.replaceWith(start, end, node)
  })
)
