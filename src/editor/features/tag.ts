import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $nodeSchema, $remark, $inputRule } from '@milkdown/kit/utils'

/**
 * 标签 `#标签` 真节点支持（Phase 3 批次三核心）。
 *
 * 为什么必须是真节点 + InputRule + to-markdown handler（同 wikilink，见 PHASE3-PLAN 红线 6）：
 *   - `#标签` 不是 Markdown 标准语法，micromark 会把它当普通文本；
 *   - 若只用「装饰显示 + 导出后处理」，`#` 定界符在往返中必然丢失/被转义；
 *   - 故做成 ProseMirror 行内原子节点，序列化时由 handler 原样输出 `#标签`。
 *
 * 与 wikilink.ts 同样的三处协同：
 *   1) remarkTag —— 把正文文本里的 `#标签` 改写成自定义 mdast 节点 `tag`；
 *   2) tagSchema —— 映射成行内原子节点，toDOM 渲染成芯片，toMarkdown 写回原语法；
 *   3) tagInputRule —— 敲完标签后的空白（空格）即刻把 `#标签` 转成节点（否则当下敲了没反应）。
 *
 * 语法：`#标签` / `#父/子`（嵌套）。
 * 与标题的区分（PHASE3-PLAN §2.2 的歧义要求）：`#` 后必须紧跟「非空白、非 #」的字符，
 *   故 `# 标题` / `## 标题` 不会被误判为标签；语义由本真节点的 InputRule / remark 界定，
 *   而非靠上层正则硬扫。
 *
 * ⚠️ 已知边界（与 Obsidian 同）：标签延伸到「空白 / 标点 / 行尾」为止。
 *   中文没有词边界，故 `这是#重要的概念` 会得到标签 `重要的概念`（而非 `重要`）。
 *   推荐写法是加空格：`这是 #重要 的概念`。彻底解决需中文分词，属批次四。
 *   边界用例已实测，见 `tmp/tag-re-test.mjs`（22/22 通过）。
 */

export const tagId = 'tag'

export interface TagAttrs {
  /** 标签名（不含前导 `#`，可含 `/` 表示嵌套，如 `父/子`） */
  name: string
}

/**
 * 标签名合法字符：以字母 / 数字 / 下划线开头，后续可含 `-` `/` 与下划线。
 * 以 `\p{L}` 而非 `[A-Za-z]` 书写，故中文标签（`#重要`）天然支持。
 */
const TAG_BODY = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_\\-/]*'

/** 去掉尾部的 `/`、`-`（`#父/` 这类不成形的写法不该产生空层级） */
function trimTag(raw: string): string {
  return raw.replace(/[/-]+$/, '')
}

/** 构造标签匹配正则。前导 `(?<![\w#])` 排除 `##标题` 与 `abc#tag` 这类误命中 */
function buildTagRe(flags: string): RegExp {
  return new RegExp(`(?<![\\w#])#(${TAG_BODY})`, flags)
}

/**
 * remark 插件：行内文本里的 `#标签` 改写为 `tag` mdast 节点。
 * 逐节点递归；只对 text 节点做切片替换，其余节点原地保留并继续向下走
 * （故行内代码 / 代码块的 value 不会被波及——它们没有 text 子节点）。
 */
export const remarkTag = $remark('remarkTag', () => () => (tree: any) => {
  const TAG_RE = buildTagRe('gu')

  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (!Array.isArray(node.children)) return

    const out: any[] = []
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const value = child.value
        let last = 0
        let m: RegExpExecArray | null
        TAG_RE.lastIndex = 0
        while ((m = TAG_RE.exec(value)) !== null) {
          const name = trimTag(m[1])
          if (!name) continue
          const pre = value.slice(last, m.index)
          if (pre) out.push({ type: 'text', value: pre })
          out.push({ type: 'tag', name })
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

export const tagSchema = $nodeSchema(tagId, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    name: { default: '' }
  },
  parseDOM: [
    {
      tag: `span[data-type="${tagId}"]`,
      getAttrs: (dom: any) => ({
        name: dom.dataset.name ?? ''
      })
    }
  ],
  toDOM: (node: any) => {
    const dom = document.createElement('span')
    dom.dataset.type = tagId
    dom.dataset.name = node.attrs.name
    dom.className = 'yj-tag'
    // `#` 与标签名分色（# 走 --hue-text-3，标签名走 --hue-text-1），见 editor.css
    const hash = document.createElement('span')
    hash.className = 'yj-tag__hash'
    hash.textContent = '#'
    const label = document.createElement('span')
    label.className = 'yj-tag__label'
    label.setAttribute('contenteditable', 'false')
    label.textContent = node.attrs.name
    dom.appendChild(hash)
    dom.appendChild(label)
    return dom
  },
  parseMarkdown: {
    match: (node: any) => node.type === 'tag',
    runner: (state: any, node: any, type: any) => {
      state.addNode(type, { name: node.name ?? '' })
    }
  },
  toMarkdown: {
    match: (node: any) => node.type.name === tagId,
    runner: (state: any, node: any) => {
      // 以纯文本节点写回，保证 `#` 定界符原样保留，Markdown 往返保真
      state.addNode('text', undefined, `#${node.attrs.name}`)
    }
  }
}))

/**
 * 输入规则：敲完标签后的空白即刻把 `#标签` 转成节点。
 * 标签没有闭合定界符（不像 `[[…]]` 有 `]]`），故以「标签后的空白」作为结束信号；
 * 空白本身保留——匹配区间含 1 个空白字符，故 end 回退一格再替换节点。
 */
export const tagInputRule = $inputRule(() =>
  new InputRule(new RegExp(`#(${TAG_BODY})\\s$`, 'u'), (state, match, start, end) => {
    const name = trimTag(match[1])
    if (!name) return null
    const node = state.schema.nodes[tagId].create({ name })
    return state.tr.replaceWith(start, end - 1, node)
  }),
)
