import { NodeSelection, Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/** 被整块选中的行内公式（pos = 节点前的位置，可直接用于 setNodeMarkup） */
export interface MathSelectionInfo {
  pos: number
  value: string
  dom: HTMLElement
}

/**
 * 行内公式「整块选中」上报插件（复杂元素临时编辑界面 · 公式）。
 *
 * 触发语义与 Crepe 自带的 `inlineLatexTooltip` 完全一致（NodeSelection 命中 math_inline），
 * 目的却是替换它：Crepe 那个浮层是个**纯文本框、没有预览**，作者改 LaTeX 只能盲改；
 * 而文档里的公式是由 MathJax 渲染的（`mathjax.ts`），两套引擎对 `\require` / `\ce` /
 * `\label` 的支持本就不同，用 KaTeX 预览会与最终效果不符。
 *
 * 故这里把 Crepe 的文本框在 CSS 里隐藏（见 `editor.css` 的 `.milkdown-latex-inline-edit`），
 * 由上层用带 MathJax 实时预览 + 符号工具条的浮层接管——**触发条件不变，只是换了个更好的编辑器**。
 */
export function createMathSelectPlugin(
  onSelect: (info: MathSelectionInfo | null) => void,
): Plugin {
  return new Plugin({
    view() {
      return {
        update(view: EditorView): void {
          const sel = view.state.selection
          if (view.editable && sel instanceof NodeSelection && sel.node.type.name === 'math_inline') {
            const dom = view.nodeDOM(sel.from)
            if (dom instanceof HTMLElement) {
              onSelect({
                pos: sel.from,
                value: String(sel.node.attrs.value ?? ''),
                dom,
              })
              return
            }
          }
          onSelect(null)
        },
      }
    },
  })
}
