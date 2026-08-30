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
  /** 标签表查询：该 label 是否已被注册（用于判断 \eqref 能否解析） */
  hasLabel: (label: string) => boolean
  /** 设定下一个自动编号的起始值：传入 n 则下一个编号即为 n */
  primeCounter: (nextNumber: number) => void
  /** 清空标签表与编号计数器（切换文档时调用） */
  resetNumbering: () => void
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
    // tags: 'ams' —— 关键配置，缺了它 \label / \eqref 形同虚设。
    // MathJax v3 默认 tags:'none'（TagsFactory.OPTIONS 里 defaultTags='none'）：
    // 只有显式 \tag{…} 的公式才会拿到编号，\begin{equation}\label{eq:x} 不会自动编号，
    // 于是 \label 只登记了一个 tag 为空的 Label，\eqref 解析时拿到空 tag → 渲染成 (???)。
    // 'ams' 才是 LaTeX/AMS 正统语义：equation/align 等编号，equation*/align* 不编号，行内不编号。
    // ignoreDuplicateLabels —— 同一公式重渲染（编辑时每敲一下就重渲）时，
    // \label 会命中「Label multiply defined」抛错，必须允许重复登记。
    const tex = new texMod.TeX({
      packages: packagesMod.AllPackages,
      tags: 'ams',
      ignoreDuplicateLabels: true
    })
    // fontCache: 'none' → 每个 SVG 自包含（不依赖全局 <defs>），便于独立插入与导出
    const svg = new svgMod.SVG({ fontCache: 'none' })
    const doc = mathjaxMod.mathjax.document('', { InputJax: tex, OutputJax: svg })
    const tags = (): { allLabels: Record<string, unknown>; allCounter: number; reset: (n?: number) => void } =>
      (tex.parseOptions as unknown as { tags: never }).tags as never

    return {
      convert: (source: string, display: boolean) => {
        const node = doc.convert(source, { display })
        return adaptor.innerHTML(node)
      },
      hasLabel: (label: string) => Boolean(tags().allLabels[label]),
      // startEquation() 会把 counter 重置为 allCounter，autoTag() 先自增再取号，
      // 故把 allCounter 设成 n-1，下一个编号就是 n。
      primeCounter: (nextNumber: number) => {
        tags().allCounter = nextNumber - 1
      },
      resetNumbering: () => {
        tags().reset(0)
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

/* ── \label / \ref / \eqref 交叉引用 ──────────────
   三个曾让 \eqref 永远显示 ??? 的坑，逐个说清（都是实测踩出来的）：

   坑一｜不自动编号。MathJax v3 的 TagsFactory.OPTIONS 里 defaultTags='none'，
         
只有显式 \tag{…} 的公式才有编号，\begin{equation}\label{eq:x} 拿不到号，
         \label 登记的是一个 tag 为空的 Label，\eqref 解析时拿到空值 → (???)。
         根治：构造 TeX 时传 tags:'ams'（详见 loadMathJax 内注释）。

   坑二｜??? 检测方式根本不成立。SVG 输出里没有字面文本，字符全编成字形路径，
         '?' 写作 <path data-c="3F">（3F 是码位），所以 `svg.includes('???')`
         恒为 false —— 之前所有「重试 / 排队」逻辑一次都没被触发过。
         根治：解码 data-c 判断（见 refUnresolved）。

   坑三｜编号漂移。MathJax 的 allCounter 跨 convert 累加，同一公式每重渲染一次
         编号就 +1，边打字边看编号往上涨。
         根治：自维护 label→编号 的固定映射，渲染前把计数器「上膛」到该编号。

   最后，渲染是异步且顺序不定的（行内 nodeView 立即渲染、块级走防抖预览），
   \eqref 常常先于 \label 渲染，故保留「引用排队 + 标签注册后刷新」的机制。 */

/** label → 固定编号（首次出现时分配，之后不变，杜绝重渲染漂移） */
const labelNumbers = new Map<string, number>()
/** 下一个待分配的编号 */
let nextLabelNumber = 1

/** 等待中的引用渲染任务 */
const pendingRefs: Array<{
  source: string
  display: boolean
  resolve: (svg: string) => void
  token: number
  attempts: number
}> = []

/**
 * 最多重试几轮。
 *
 * 引用了一个根本不存在的 label（写错名字、label 被删）时，永远等不到注册事件。
 * 若就此无限挂起，节点会一直停在占位源码 `$…$` 上，比显示 (???) 还糟
 * —— ??? 至少告诉用户「引用没解析出来」。故超过轮次就认命，把最后一版 SVG 交出去。
 */
const MAX_REF_ATTEMPTS = 3

/** 取出源码里所有 \label{X} 的 X（保持出现顺序、去重） */
function extractLabels(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\\label\s*\{([^{}]*)\}/g)) {
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 取出源码里所有 \ref{X} / \eqref{X} 的 X */
function extractRefs(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\\(?:eq)?ref\s*\{([^{}]*)\}/g)) {
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 源码是否定义标签 / 引用标签（快速预判，省掉无谓的全量扫描） */
function hasLabel(src: string): boolean {
  return /\\label\s*\{/.test(src)
}

/**
 * 裸 `$$ E=mc^2 \label{eq:e} $$` 的兜底：给它套上编号环境。
 *
 * AMS 语义下只有 equation / align / gather 等环境才自动编号，
 * 光秃秃的 `$$…$$` 即便写了 \label 也拿不到号，\eqref 依旧是 (???)。
 * 这是 LaTeX 的正统行为，但 Markdown 用户写 `$$…\label…$$` 时
 * 心里想的几乎一定是「这公式要能被引」——不懂这层规矩就会一头雾水。
 *
 * 故仅在这种「有 \label、没环境、没手动 \tag」的情形下自动套壳，
 * 有换行/对齐符时套 align（equation 单行环境吃不下 \\ 和 &），否则套 equation。
 */
function ensureNumberedEnv(src: string): string {
  if (!hasLabel(src)) return src
  if (/\\tag\s*\{/.test(src)) return src
  if (/\\begin\s*\{/.test(src)) return src // 已有环境，尊重原样
  const env = /\\\\|&/.test(src) ? 'align' : 'equation'
  return `\\begin{${env}}${src}\\end{${env}}`
}
function hasRef(src: string): boolean {
  return /\\(?:eq)?ref\s*\{/.test(src)
}

/**
 * 为本公式里的 label 分配固定编号，返回「第一个 label 的编号」。
 * 同一公式不管重渲染多少次，拿到的编号都一致。
 */
function assignLabelNumbers(labels: string[]): number {
  let base = labelNumbers.get(labels[0])
  if (base === undefined) {
    base = nextLabelNumber
    labelNumbers.set(labels[0], base)
  }
  // 一个公式里的多个 label（如 align 每行一个）顺序紧随其后
  for (let i = 1; i < labels.length; i++) labelNumbers.set(labels[i], base + i)
  nextLabelNumber = Math.max(nextLabelNumber, base + labels.length)
  return base
}

/**
 * 判断 SVG 里是否存在「未解析的引用」。
 *
 * MathJax 解析不出 \ref / \eqref 时渲染成 (???)，而 SVG 中字符是字形路径，
 * '?' 编码为 <path data-c="3F">。故必须解码 data-c，不能搜字符串 '???'。
 * 只看引用节点（class 含 MathJax_ref）里的 '?'，避免把公式里正常的问号
 * （如 a \stackrel{?}{=} b）误判成未解析。
 */
function refUnresolved(svg: string): boolean {
  if (!svg.includes('MathJax_ref')) return false
  return /data-c="3F"/.test(svg)
}

/**
 * 刷新所有等待中的引用：label 刚注册，之前失败的任务现在应该能解析了。
 * 成功则 resolve，仍失败则放回队列等下一轮。
 */
function flushPendingRefs(): void {
  if (pendingRefs.length === 0) return
  const tasks = pendingRefs.splice(0, pendingRefs.length)
  for (const task of tasks) {
    task.attempts += 1
    void renderMathToSvg(task.source, task.display).then((svg) => {
      // token 检查：调用方已销毁/更新则丢弃结果（token 为 0 表示不检查，块级场景）
      if (task.token > 0 && !isTokenValid(task.token)) return
      // 解析成功、或重试次数用尽（label 多半根本不存在）→ 交出结果
      if (!refUnresolved(svg) || task.attempts >= MAX_REF_ATTEMPTS) {
        task.resolve(svg)
      } else {
        pendingRefs.push(task) // 仍不可解析，等下一轮 label 注册
      }
    })
  }
}

/** 令牌有效性检查（行内 nodeView 用 token 追踪生命周期） */
const activeTokens = new Set<number>()
export function trackToken(token: number): () => void {
  activeTokens.add(token)
  return () => { activeTokens.delete(token) }
}
function isTokenValid(token: number): boolean {
  return activeTokens.has(token)
}

/** 渲染 TeX → SVG；失败或语法有误时降级为错误徽标（不抛错、不中断编辑） */
export async function renderMathToSvg(
  source: string,
  display: boolean
): Promise<string> {
  if (!source.trim()) return ''
  // 行间公式才参与编号；裸 $$…\label…$$ 自动套编号环境（详见 ensureNumberedEnv）
  const tex = display ? ensureNumberedEnv(source) : source
  try {
    const mj = await loadMathJax()
    // 编号上膛：让本公式的 label 拿到它的固定编号，杜绝重渲染时编号漂移
    const labels = hasLabel(tex) ? extractLabels(tex) : []
    if (labels.length > 0) mj.primeCounter(assignLabelNumbers(labels))
    const svg = mj.convert(tex, display)
    if (labels.length > 0) {
      // 有新标签登记 → 唤醒等待中的引用
      flushPendingRefs()
    }
    return svg
  } catch (err: unknown) {
    return errorHtml(err, source)
  }
}

/**
 * 渲染含引用的公式（\ref / \eqref）。
 *
 * 若引用的 label 尚未登记（或渲染结果里仍是 ???），不返回半成品，
 * 而是挂起等待；等别处的 \label 渲染完成、标签登记后自动补渲染并 resolve。
 * 调用方直接 await 即可拿到最终结果，无需自己写重试：
 * ```ts
 * const svg = await renderMathWithRef(value, false)
 * ```
 */
export async function renderMathWithRef(
  source: string,
  display: boolean,
  token?: number
): Promise<string> {
  const svg = await renderMathToSvg(source, display)
  const refs = hasRef(source) ? extractRefs(source) : []
  if (refs.length === 0) return svg

  const mj = await loadMathJax()
  const allRegistered = refs.every((ref) => mj.hasLabel(ref))
  if (allRegistered && !refUnresolved(svg)) return svg

  return new Promise<string>((resolve) => {
    let settled = false
    const task = {
      source,
      display,
      // 注意：这里必须写 `token: token ?? 0`，不能省略键名。
      // TS 解析器把对象字面量里标识符后的 `?` 当作「可选属性标记」(token?:)，
      // 简写形式 `{ token ?? 0 }` 会直接抛 TS1005 语法错误。
      token: token ?? 0,
      attempts: 0,
      resolve: (svg: string): void => {
        if (settled) return
        settled = true
        resolve(svg)
      }
    }
    pendingRefs.push(task)

    // 保险一｜竞态：入队这一下完全可能发生在「标签已注册 → flushPendingRefs()」之后
    // （微任务排队顺序使然，实测必现）。此后不会再有注册事件来唤醒队列，任务将永久挂起。
    // 故入队后立刻复查一次标签表，命中就马上补一轮刷新。
    void loadMathJax().then((m) => {
      if (refs.every((ref) => m.hasLabel(ref))) flushPendingRefs()
    })

    // 保险二｜死等：整篇文档压根没有 \label（引用名写错 / 目标被删）时，
    // 永远不会有注册事件。超时后强制结算，宁可显示 (???) 提示用户「引用没解析出来」，
    // 也不要让节点一直停在占位源码 `$…$` 上装死。
    setTimeout(() => {
      if (settled) return
      const idx = pendingRefs.indexOf(task)
      if (idx < 0) return // 已被 flushPendingRefs 取出、正在渲染中
      pendingRefs.splice(idx, 1)
      task.attempts = MAX_REF_ATTEMPTS // 令本轮结算后不再入队
      pendingRefs.push(task)
      flushPendingRefs()
    }, 1200)
  })
}

/**
 * 切换文档时清空标签表与编号映射。
 * 不清的话上一篇文档的编号会接着往下排，且标签表残留会让新文档的同名 label 直接命中旧值。
 */
export function resetMathNumbering(): void {
  labelNumbers.clear()
  nextLabelNumber = 1
  pendingRefs.length = 0
  // MathJax 侧的复位异步进行即可：本进程的映射已同步清空，
  // 而 MathJax 若尚未加载，加载出来本身就是干净状态。
  void loadMathJax().then((mj) => mj.resetNumbering())
}

/* ── 行内数学 nodeView ─────────────────────────── */

class MathInlineView {
  dom: HTMLElement
  private node: PMNode
  /** 自增令牌：只认最后一次请求结果，杜绝慢渲染覆盖新渲染 */
  private token = 0
  /** 令牌追踪（供 renderMathWithRef 判断有效性） */
  private untrackToken: (() => void) | null = null

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
    // 让在途渲染失效，避免回调写入已销毁的 DOM
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
 * 剥离 LaTeX 源码中的 \require{…} 预加载指令。
 *
 * 为什么需要：我们已通过 AllPackages 加载了全部 MathJax 扩展（含 amscd / mhchem 等），
 * \require 在此环境下是冗余的；且 MathJax 并不总能「静默消费」该指令——
 * 实测发现 \require{amscd} 会以红色错误文本泄漏进 SVG 输出（用户反馈"红色的 \require"）。
 * 故在送入 MathJax 前直接移除，既消除视觉污染又不影响渲染能力。
 */
function stripRequireDirectives(src: string): string {
  return src.replace(/\\require\{[^}]*\}/g, '').trim()
}

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
    // 剥离 \require{…}：AllPackages 已全量加载，该指令冗余且会泄漏为红色错误文本
    const cleaned = stripRequireDirectives(content)
    if (isFullLatexDoc(cleaned)) return await renderLatexDoc(cleaned)
    // 纯数学：用 renderMathWithRef 处理可能的 \ref/\eqref
    return await renderMathWithRef(stripMathDelims(cleaned), true)
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
      if (latexBlockToken.get(applyPreview) !== mine) return
      applyPreview(html)
    })
  }
  run()
  return undefined
}
