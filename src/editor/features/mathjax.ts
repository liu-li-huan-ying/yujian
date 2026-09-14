import { Plugin } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import {
  extractRefs,
  hasRef,
  onLabelsChanged,
  renderLatexContent,
  renderMathWithRef,
  refUnresolved,
  trackToken,
} from '../../render/mathjax'

/**
 * MathJax 在编辑器内的接线 —— 只负责「把渲染能力挂到 ProseMirror 上」。
 *
 * 渲染能力本身在 `src/render/mathjax.ts`（与编辑器无关、导出层也用）。
 * 本模块是**编辑器侧的数学入口**：NodeView、块级预览钩子，并把下层渲染 API 一并透出，
 * 使编辑器侧调用方（`MilkdownEditor.vue`、`verify-markdown.mjs`）只需认这一个模块。
 *
 * 为什么保留 Crepe 的 Latex 特性（schema / 解析 / 编辑浮层），只替换渲染：
 *   KaTeX 不认 `\\require`、`\\ce` 需额外扩展、整篇 LaTeX 文档级语法支持弱；
 *   而 MathJax（AllPackages + mhchem）原生支持 `\\label`/`\\eqref`/`\\ce`/`\\require`。
 *   保留 Crepe 的数学节点 schema 与 remark-math 解析，可让「Markdown 往返保真」
 *   这条红线继续由已被验证的实现承担，我们只接管「显示」这一层，风险最小。
 *
 * 两条渲染路径：
 * 1) 行内 `$…$` —— math_inline 原子节点，Crepe 未给它注册 nodeView（渲染写在 toDOM 里
 *    直接调 katex.render）。这里补一个 nodeViews.math_inline 插件接管显示。
 * 2) 块级 `$$…$$` —— 是 language='latex' 的代码块，走 codeBlockConfig.renderPreview；
 *    Crepe 的 Latex Feature 会在 create() 期间用 katex 覆盖该配置，故我们在 MilkdownEditor.vue
 *    里用 .use() 特性（排到内部特性之后）再覆盖一次，让 MathJax 最终胜出（见 renderMathBlockPreview）。
 */


/* ── 行内数学 nodeView ─────────────────────────── */

class MathInlineView {
  dom: HTMLElement
  private node: PMNode
  /** 自增令牌：只认最后一次请求结果，杜绝慢渲染覆盖新渲染 */
  private token = 0
  /** 令牌追踪（供 renderMathWithRef 判断有效性） */
  private untrackToken: (() => void) | null = null
  /**
   * 晚到 label 监听的取消函数。
   *
   * 1200ms 兜底后，引用任务已经交出 (???)，但 nodeView 仍可能存在；监听器
   * 让它能在 label 后续登记时恢复，同时必须在 destroy() 中解除，避免旧 nodeView
   * 被模块级监听器长期持有。
   */
  private offLabels: (() => void) | null = null

  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('span')
    this.dom.classList.add('math-inline')
    this.dom.setAttribute('data-type', 'math_inline')
    this.dom.setAttribute('contenteditable', 'false')
    // 监听器在首次 render 前注册：这样首次渲染与晚到 label 的通知共享同一套
    // nodeView 生命周期；真正是否需要重渲染由当前源码和 DOM 状态共同决定。
    this.offLabels = onLabelsChanged((labels) => {
      const value = String(this.node.attrs.value ?? '')
      // 只处理当前仍是引用公式、且已经显示 unresolved SVG 的节点。
      // 这两个守卫同时避免无关 label 触发重渲染，也避免覆盖用户刚编辑出的新内容。
      if (!hasRef(value) || !refUnresolved(this.dom.innerHTML)) return
      const refs = extractRefs(value)
      if (!refs.some((ref) => labels.includes(ref))) return
      this.render()
    })
    this.render()
  }

  private render(): void {
    const value = String(this.node.attrs.value ?? '')
    this.dom.setAttribute('data-value', value)
    if (!value.trim()) {
      this.dom.textContent = ''
      return
    }
    // 先占位显示源码，MathJax 就绪后替换为渲染结果
    this.dom.textContent = '$' + value + '$'
    const mine = ++this.token
    // 注册令牌追踪（让 renderMathWithRef 能判断我们是否还活着）
    this.untrackToken?.()
    this.untrackToken = trackToken(mine)

    // renderMathWithRef：含 \ref/\eqref 且标签未登记时自动挂起排队，
    // 等别处 \label 渲染完成（flushPendingRefs）后再补渲染并 resolve。
    void renderMathWithRef(value, false, mine).then((svg) => {
      if (mine !== this.token) return
      this.dom.innerHTML = svg
    })
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'math_inline') return false
    const prev = String(this.node.attrs.value ?? '')
    const next = String(node.attrs.value ?? '')
    this.node = node
    this.dom.setAttribute('data-value', next)
    if (prev !== next) this.render()
    return true
  }

  /** 内容由本视图独占渲染，忽略 ProseMirror 的 DOM 变更观察 */
  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    // label 监听与在途渲染令牌必须一起清理：前者阻止晚到通知继续触碰旧 DOM，
    // 后者阻止已经发出的异步结果覆盖销毁 / 重建后的 nodeView。
    this.offLabels?.()
    this.offLabels = null
    this.token++
    this.untrackToken?.()
    this.untrackToken = null
  }
}

/** 接管 math_inline 节点显示（Crepe 未给该节点注册 nodeView，故此覆盖无冲突） */
export function mathInlineNodeViewPlugin(): Plugin {
  return new Plugin({
    props: {
      nodeViews: {
        math_inline: (node: PMNode) => new MathInlineView(node)
      }
    }
  })
}

/* ── 块级数学预览（language='latex' 代码块）────── */

const latexBlockToken = new WeakMap<(v: string | null) => void, number>()

/**
 * 供 renderPreview 调用：语言为 latex 时渲染。
 * - 纯数学 → 直接 MathJax 行间公式；
 * - 完整 LaTeX 文档（\documentclass…\begin{document}…\end{document}）→
 *   抽取正文，数学走 MathJax、叙述文字保留。若不拆分，MathJax 会把整篇文档当成一个
 *   巨型公式，渲染出一条超宽退化的 SVG（用户在界面上看到「一条加粗实线」），
 *   且 \require 等会因报错而回退显示源码。
 * 返回 undefined 进入异步模式，待渲染完成后回调 applyPreview。
 */
export function renderMathBlockPreview(
  content: string,
  applyPreview: (value: string | null) => void
): undefined {
  if (!content.trim()) {
    applyPreview(null)
    return undefined
  }
  // 与 mermaid 同理：每个代码块的 applyPreview 闭包独立，用它作键维护各自的结果令牌，
  // 避免多个 latex 块并存时，新块的 ++token 使旧块的结果被判失效被丢弃
  // （即「多个公式块放在一起只有最后一个能渲染」）。
  const mine = (latexBlockToken.get(applyPreview) ?? 0) + 1
  latexBlockToken.set(applyPreview, mine)

  const run = (): void => {
    void renderLatexContent(content).then((html) => {
      if (latexBlockToken.get(applyPreview) !== mine) return
      applyPreview(html)
    })
  }
  run()
  return undefined
}

/* ── 透出下层渲染 API ────────────────────────────────
   编辑器侧（含回归测试）只需认本模块这一个入口，不必同时记住两个模块路径。
   注意：这些函数与上面的 NodeView 必须来自**同一份** `src/render/mathjax.ts` 实例，
   否则标签编号与晚到恢复监听会分处两套状态，`\\eqref` 恢复链失效。 */
export { renderMathToSvg, renderMathWithRef, renderLatexContent, resetMathNumbering, trackToken } from '../../render/mathjax'
