import { $nodeSchema } from '@milkdown/kit/utils'
import { InputRule } from '@milkdown/kit/prose/inputrules'

/**
 * `~下标~` / `^上标^` / `==高亮==` 的 Milkdown 落地：真节点 + 输入规则。
 *
 * 与 htmlInline 同一套路：行内原子节点，value 存内容，toDOM 直接渲染语义标签，
 * toMarkdown 由 inlineMarksHandlers 原样输出定界符（详见 inlineMarksSyntax.ts 的缘由）。
 *
 * 输入规则不可省：真节点只在「重新解析」时才会从文本生成，边打字边生效必须靠 InputRule，
 * 否则用户敲完 `~2~` 当下看不到效果、要切一次模式才变，观感等同于坏掉。
 */

interface MarkSpec {
  /** mdast 节点类型（与 inlineMarksSyntax 保持一致） */
  mdast: string
  /** ProseMirror 节点名 */
  pm: string
  /** 渲染/解析用的语义标签 */
  tag: string
  /** 尾部匹配的输入规则正则（$ 锚在光标处） */
  re: RegExp
}

const SPECS: MarkSpec[] = [
  // 下标：单 ~（~~ 留给 GFM 删除线）
  { mdast: 'sub', pm: 'sub', tag: 'sub', re: /~([^~\n]{1,60})~$/ },
  // 上标：^（内部禁 ^ 与换行）
  { mdast: 'sup', pm: 'sup', tag: 'sup', re: /\^([^^\n]{1,60})\^$/ },
  // 高亮：==（pm 名用 highlight，避免与 ProseMirror「mark」概念混淆）
  { mdast: 'mark', pm: 'highlight', tag: 'mark', re: /==([^=\n]{1,200})==$/ }
]

function makeSchema(spec: MarkSpec) {
  return $nodeSchema(spec.pm, () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
      value: { default: '' }
    },
    parseDOM: [
      {
        tag: spec.tag,
        getAttrs: (dom: HTMLElement) => ({ value: dom.textContent ?? '' })
      }
    ],
    toDOM: (node: any) => {
      const dom = document.createElement(spec.tag)
      dom.dataset.type = spec.pm
      dom.textContent = String(node.attrs.value ?? '')
      return dom
    },
    parseMarkdown: {
      match: (node: any) => node.type === spec.mdast,
      runner: (state: any, node: any, type: any) => {
        state.addNode(type, { value: String(node.value ?? '') })
      }
    },
    toMarkdown: {
      match: (node: any) => node.type.name === spec.pm,
      runner: (state: any, node: any) => {
        state.addNode(spec.mdast, undefined, String(node.attrs.value ?? ''))
      }
    }
  }))
}

export const subSchema = makeSchema(SPECS[0])
export const supSchema = makeSchema(SPECS[1])
export const highlightSchema = makeSchema(SPECS[2])

/**
 * 输入规则：敲完定界符立即转成节点。
 * 节点类型从 `state.schema` 取（InputRule 的 state 自带），无需依赖 ctx 时序，最稳。
 */
export const inlineMarkInputRules: InputRule[] = SPECS.map(
  (spec) =>
    new InputRule(spec.re, (state: any, match: RegExpMatchArray, start: number, end: number) => {
      const type = state.schema.nodes[spec.pm]
      if (!type) return null
      const value = match[1]?.trim()
      if (!value) return null
      return state.tr.replaceWith(start, end, type.create({ value }))
    })
)
