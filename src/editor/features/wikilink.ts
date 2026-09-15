import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $nodeSchema, $remark, $inputRule } from '@milkdown/kit/utils'
import { wikiLinkRegex, wikiLinkInputRegex, parseWikiLink } from '../../../electron/shared/wikilink-syntax'

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

/**
 * mdast 最小节点形状：只声明本插件真正读写的字段。
 * 用具体形状取代 `any`，能在打错字段名（如 `node.childs`）时立刻报错，而不是静默什么都不发生。
 * 其余字段一律可选，故任意 mdast 节点都能满足该形状，调用处无需强转。
 */
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  target?: string
  alias?: string | null
  anchor?: string | null
  position?: { start?: { offset?: number }; end?: { offset?: number } }
}

/** 解析 `[[` 与 `]]` 之间的原始内容：拆分别名与锚点 */
function parseInner(inner: string): WikiLinkAttrs {
  // 走共享语法模块：索引层与编辑器层必须对「什么算链接、怎么分段」完全一致
  const { target, alias, anchor } = parseWikiLink(inner)
  return { target, alias, anchor }
}

/** 芯片显示文字：优先别名，回落到目标本身 */
function displayText(a: WikiLinkAttrs): string {
  return a.alias || a.target
}

/**
 * 序列化 handler：`wikiLink` mdast 节点 → 原样输出 `[[target]]` / `[[target#anchor|alias]]`。
 *
 * **这一步不可省**。若退化成普通 text 节点输出，remark-stringify 会把 `[` 当作链接语法字符
 * 转义——实测段落内 `参见 [[中文排版]]` 会被写成 `参见 \[\[中文排版]]`，存盘后双链全废。
 * 这正是「编辑保存后 `[[双链]]` 变成 `\[\[双链]]`」的根因（test-core `[D]` 只测了纯逻辑、
 * 用的是 stubs，跑不到 remark-stringify，所以一直没暴露）。
 * 走 `data('toMarkdownExtensions')` 是 remark 官方扩展通道（同 remarkInlineMarks）。
 */
function wikiLinkToMarkdownHandlers(): Record<string, (node: unknown) => string> {
  return {
    wikiLink: (raw: unknown): string => {
      const node = (raw ?? {}) as { target?: unknown; alias?: unknown; anchor?: unknown }
      const target = String(node.target ?? '')
      const hash = node.anchor ? `#${node.anchor}` : ''
      return node.alias ? `[[${target}${hash}|${node.alias}]]` : `[[${target}${hash}]]`
    },
  }
}

/**
 * remark 插件（attacher）：注册序列化 handler + 把正文文本里的 `[[...]]` 改写为 `wikiLink` mdast 节点。
 *
 * 刻意用 `function` 而非箭头函数：需要 processor 的 `this.data()` 才能挂 toMarkdownExtensions。
 * 逐节点递归；只对 text 节点做切片替换，其余节点原地保留并继续向下走。
 */
export const remarkWikilink = $remark('remarkWikilink', () => function (this: unknown) {
  // this 是 remark processor（由 unified 调用时绑定）。单测直接调用 attacher 时为 undefined，
  // 故做防御：拿不到 data 就跳过注册，_transformer 本身仍照常工作，绝不抛错。
  const holder = this as { data?: () => Record<string, unknown> } | undefined
  const data = holder?.data?.() ?? {}
  const tm = (data.toMarkdownExtensions as unknown[]) ?? (data.toMarkdownExtensions = [])
  tm.push({ handlers: wikiLinkToMarkdownHandlers() })

  return (tree: MdNode): void => {
    const WIKILINK_RE = wikiLinkRegex()

    const walk = (node: MdNode): void => {
      if (!node || typeof node !== 'object') return
      if (!Array.isArray(node.children)) return

      const out: MdNode[] = []
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
  }
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
      const { target, alias, anchor } = node.attrs
      // 锚点必须写回，否则 `[[目标#小节]]` 一存盘就退化成 `[[目标]]`（往返保真红线）
      //
      // 输出**自定义 mdast 节点** `wikiLink`（而非 text）：text 节点会被 remark-stringify
      // 当成普通文本做转义，`[[` 变成 `\[\[`；自定义节点则由 remarkWikilink 注册的
      // toMarkdownExtensions handler 原样输出，定界符零转义。
      // addNode(type, children, value, props) —— props 会被展开成 mdast 节点字段。
      state.addNode('wikiLink', undefined, undefined, {
        target,
        alias: alias ?? null,
        anchor: anchor ?? null,
      })
    }
  }
}))

/** 输入规则：敲完 `]]` 即刻把 `[[目标]]` / `[[目标|别名]]` 转成节点 */
export const wikiLinkInputRule = $inputRule(() =>
  new InputRule(wikiLinkInputRegex(), (state, match, start, end) => {
    const attrs = parseInner(match[1])
    if (!attrs.target) return null
    const node = state.schema.nodes[wikiLinkId].create(attrs)
    return state.tr.replaceWith(start, end, node)
  })
)
