import { Plugin } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

/**
 * MathJax 数学渲染 —— 替代 Crepe 内置的 KaTeX 渲染层。
 *
 * 为什么保留 Crepe 的 Latex 特性（schema / 解析 / 编辑浮层），只替换渲染：
 *   KaTeX 不认 `\require`、`\ce` 需额外扩展、整篇 LaTeX 文档级语法支持弱；
 *   而 MathJax（AllPackages + mhchem）原生支持 `\label`/`\eqref`/`\ce`/`\require`。
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

interface MathJaxApi {
  /** 把 TeX 转成自包含 SVG 字符串；display=true 为行间公式 */
  convert: (tex: string, display: boolean) => string
}

let mjPromise: Promise<MathJaxApi> | null = null

/** MathJax 体积很大，动态引入且不阻塞首屏；liteAdaptor 不依赖真实 DOM，适配沙箱渲染进程 */
function loadMathJax(): Promise<MathJaxApi> {
  mjPromise ??= (async () => {
    const [mathjaxMod, texMod, svgMod, adaptorMod, handlerMod, packagesMod] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js')
    ])

    const adaptor = adaptorMod.liteAdaptor()
    handlerMod.RegisterHTMLHandler(adaptor)
    const tex = new texMod.TeX({ packages: packagesMod.AllPackages })
    // fontCache: 'none' → 每个 SVG 自包含（不依赖全局 <defs>），便于独立插入与导出
    const svg = new svgMod.SVG({ fontCache: 'none' })
    const doc = mathjaxMod.mathjax.document('', { InputJax: tex, OutputJax: svg })

    return {
      convert: (source: string, display: boolean) => {
        const node = doc.convert(source, { display })
        return adaptor.innerHTML(node)
      }
    }
  })()
  return mjPromise
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 出错时的降级展示：只给一个错误徽标，完整原因放 title（悬停可见）。
 *
 * 为什么不回显源码：早期版本会把被截断的源码直接渲染进结果，于是整篇 LaTeX 的
 * `\require{amscd}` / `\documentclass` 等控制指令以红色字面量出现在正文里
 * （用户反馈"显示红色的 \require"）。回显源码对读者毫无价值，还会污染导出，
 * 故改为只显示徽标 + 悬停看原因。
 */
function errorHtml(err: unknown, _source: string): string {
  const message = err instanceof Error ? err.message : String(err)
  return `<span class="math-error" title="${escapeHtml(message)}">⚠ 公式无法渲染</span>`
}

/* ── \label / \eqref 交叉引用 ────────────────────
   MathJax 的标签表挂在共享 document 上、跨 convert 保留，所以 `\eqref` 能否解析
   取决于「\label 是否已经渲染过」。而渲染是异步且顺序不定的（行内 nodeView 立即渲染、
   块级走防抖预览），`\eqref` 经常先于 `\label` 渲染 → 显示 ???。
   故这里做一处通知：任何含 \label 的公式渲染完成后，触发所有含引用的公式重渲染。 */

const labelListeners = new Set<() => void>()

/** 注册「标签表变化」回调，返回取消函数 */
export function onLabelsChanged(fn: () => void): () => void {
  labelListeners.add(fn)
  return () => {
    labelListeners.delete(fn)
  }
}

/** 源码是否定义标签 / 引用标签 */
function hasLabel(src: string): boolean {
  return /\\label\s*\{/.test(src)
}
function hasRef(src: string): boolean {
  return /\\(?:eq)?ref\s*\{/.test(src)
}

/** 渲染 TeX → SVG；失败或语法有误时降级为错误徽标（不抛错、不中断编辑） */
export async function renderMathToSvg(
  source: string,
  display: boolean
): Promise<string> {
  if (!source.trim()) return ''
  try {
    const mj = await loadMathJax()
    const svg = mj.convert(source, display)
    if (hasLabel(source)) {
      for (const fn of labelListeners) fn()
    }
    return svg
  } catch (err: unknown) {
    return errorHtml(err, source)
  }
}

/* ── 行内数学 nodeView ─────────────────────────── */

class MathInlineView {
  dom: HTMLElement
  private node: PMNode
  /** 自增令牌：只认最后一次请求结果，杜绝慢渲染覆盖新渲染 */
  private token = 0
  /** 交叉引用的重渲染订阅（仅含 \ref/\eqref 时挂载） */
  private offLabels: (() => void) | null = null

  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('span')
    this.dom.classList.add('math-inline')
    this.dom.setAttribute('data-type', 'math_inline')
    this.dom.setAttribute('contenteditable', 'false')
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
    void renderMathToSvg(value, false).then((svg) => {
      if (mine !== this.token) return
      this.dom.innerHTML = svg
    })

    // 交叉引用：\eqref 可能先于 \label 渲染出来（顺序不定），订阅标签表变化后重渲染
    this.offLabels?.()
    this.offLabels = null
    if (hasRef(value)) {
      this.offLabels = onLabelsChanged(() => {
        if (this.token !== mine) {
          this.offLabels?.()
          this.offLabels = null
          return
        }
        void renderMathToSvg(value, false).then((svg) => {
          if (mine === this.token) this.dom.innerHTML = svg
        })
      })
    }
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
    // 让在途渲染失效，避免回调写入已销毁的 DOM
    this.token++
    this.offLabels?.()
    this.offLabels = null
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

const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'flalign', 'flalign*', 'eqnarray',
  'displaymath', 'math', 'matrix', 'pmatrix', 'bmatrix',
  'Bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'aligned', 'gathered', 'split', 'array'
])

/** 整段是否为「完整 LaTeX 文档」（含导言区 + document 环境） */
function isFullLatexDoc(content: string): boolean {
  return /\\begin\s*\{document\}/.test(content) || /^\s*\\documentclass/.test(content)
}

/** 从完整 LaTeX 文档抽取正文（document 环境内；没有则取整段） */
function extractBody(content: string): string {
  const m = /\\begin\s*\{document\}([\s\S]*?)\\end\s*\{document\}/.exec(content)
  return m ? m[1] : content
}

/** 正则：依次匹配 $$…$$ / \[…\] / \(…\) / \begin{env}…\end{env} / $…$ */
const SEG_RE =
  /(\$\$[\s\S]*?\$\$)|(\\\[[\s\S]*?\\\])|(\\\([\s\S]*?\\\))|(\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\5\})|(\$(?!\$)[^\n]*?\$)/g

/** 把 LaTeX 正文切成「数学段 / 文本段」 */
function splitLatexSegments(
  src: string
): Array<{ type: 'math' | 'text'; value: string; display: boolean }> {
  const segs: Array<{ type: 'math' | 'text'; value: string; display: boolean }> = []
  let last = 0
  let m: RegExpExecArray | null
  SEG_RE.lastIndex = 0
  while ((m = SEG_RE.exec(src))) {
    if (m.index > last) segs.push({ type: 'text', value: src.slice(last, m.index), display: false })
    if (m[1]) {
      segs.push({ type: 'math', value: m[1].slice(2, -2), display: true })
    } else if (m[2]) {
      segs.push({ type: 'math', value: m[2].slice(2, -2), display: true })
    } else if (m[3]) {
      segs.push({ type: 'math', value: m[3].slice(2, -2), display: false })
    } else if (m[4]) {
      const env = m[5]
      const inner = m[6]
      if (MATH_ENVS.has(env)) {
        segs.push({ type: 'math', value: inner, display: true })
      } else {
        // 非数学环境（itemize/center…）整体当文本处理
        segs.push({ type: 'text', value: inner, display: false })
      }
    } else if (m[7]) {
      segs.push({ type: 'math', value: m[7].slice(1, -1), display: false })
    }
    last = SEG_RE.lastIndex
  }
  if (last < src.length) segs.push({ type: 'text', value: src.slice(last), display: false })
  return segs
}

/** 剥离 LaTeX 控制指令，仅保留可读文本（用于文档正文里的叙述文字） */
function stripLatex(text: string): string {
  let s = text.replace(
    /\\(?:[a-zA-Z]+)\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g,
    (_mm, b) => (b ? b : '')
  )
  s = s.replace(/[{}]/g, ' ')
  s = s.replace(/\s+/g, ' ')
  return s
}

/** 完整 LaTeX 文档 → 抽取正文，数学段交 MathJax 渲染、文本段剥离指令后保留 */
async function renderLatexDoc(content: string): Promise<string> {
  const body = extractBody(content)
  const segs = splitLatexSegments(body)
  const parts: string[] = []
  for (const seg of segs) {
    if (seg.type === 'math') {
      try {
        const svg = await renderMathToSvg(seg.value, seg.display)
        parts.push(`<span class="latex-math">${svg}</span>`)
      } catch {
        parts.push(`<span class="math-error">${escapeHtml(seg.value.slice(0, 120))}</span>`)
      }
    } else {
      const text = stripLatex(seg.value).trim()
      if (text) parts.push(`<p class="latex-text">${escapeHtml(text)}</p>`)
    }
  }
  return `<div class="latex-doc">${parts.join('')}</div>`
}

/**
 * 把一段 latex 代码块内容渲染为 HTML 字符串（SVG 或降级文本）。
 * 供编辑器预览（renderMathBlockPreview）与导出（renderLatexBlocksInExport）共用。
 */
/**
 * 去掉可能残留的 `$$…$$` / `\[…\]` 定界符。
 * remark-math 通常会先剥离，但粘贴等来源不保证；带着 `$$` 喂给 MathJax 不会报错，
 * 却会多渲染出两个 `$$` 字形（实测 SVG 宽度从 27.6ex 涨到 32.1ex），看着像公式坏了。
 */
function stripMathDelims(src: string): string {
  const s = src.trim()
  const dollar = /^\$\$([\s\S]*)\$\$$/.exec(s)
  if (dollar) return dollar[1].trim()
  const bracket = /^\\\[([\s\S]*)\\\]$/.exec(s)
  if (bracket) return bracket[1].trim()
  return src
}

export async function renderLatexContent(content: string): Promise<string> {
  if (!content.trim()) return ''
  try {
    if (isFullLatexDoc(content)) return await renderLatexDoc(content)
    return await renderMathToSvg(stripMathDelims(content), true)
  } catch (err: unknown) {
    return errorHtml(err, content)
  }
}

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
      if (latexBlockToken.get(applyPreview) === mine) applyPreview(html)
    })
  }
  run()

  // 块里的 \eqref 同样可能早于别处的 \label 渲染，订阅后重跑
  if (hasRef(content)) {
    const off = onLabelsChanged(() => {
      if (latexBlockToken.get(applyPreview) !== mine) {
        off()
        return
      }
      run()
    })
  }
  return undefined
}
