/**
 * Markdown → LaTeX（.tex）转换，纯 TS 零依赖（不引入 pandoc 等二进制）。
 *
 * 关键取舍：
 * - **转义与「公式 / 代码 / 链接」互斥**：先把这些片段抽成占位符，对剩余文本做 LaTeX
 *   特殊字符转义，最后回填。否则 URL 里的 `_`、公式里的 `\`、宏名里的 `#` 都会被破坏。
 * - 公式（$...$ / $$...$$）与代码块原样保留，产出可直接编译。
 * - 中文默认用 `ctexart` 文档类（需 XeLaTeX 编译），可通过 documentClass 覆盖。
 * - 只覆盖常用 Markdown 语法；不认识的行按普通段落处理，宁可保守也不产出坏 TeX。
 */

export interface LatexMeta {
  title?: string
  author?: string
  date?: string
}

export interface LatexOptions {
  /** 元信息：通常由属性面板的 frontmatter 供给 */
  meta?: LatexMeta
  /** 文档类，默认 ctexart（中文友好，需 XeLaTeX 编译） */
  documentClass?: string
}

/** 占位符分隔：用不可见控制字符，几乎不可能与正文冲突 */
const SLOT = '\u0000'

function makeStash() {
  const slots: string[] = []
  return {
    push(text: string): string {
      slots.push(text)
      return `${SLOT}${slots.length - 1}${SLOT}`
    },
    restore(s: string): string {
      return s.replace(
        new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'),
        (_full: string, i: string) => slots[Number(i)] ?? _full
      )
    }
  }
}
type Stash = ReturnType<typeof makeStash>

/** LaTeX 特殊字符转义（占位符已保护的内容不会被误伤） */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

/** 图片转 figure 环境；只取文件名，避免路径中的特殊字符破坏 TeX */
function figureFor(alt: string, src: string): string {
  const name = src.split(/[\\/]/).pop() ?? src
  const caption = alt.trim() ? `\\caption{${escapeLatex(alt.trim())}}\n` : ''
  return `\n\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\textwidth]{${name}}\n${caption}\\end{figure}\n`
}

/** 行内标记：先抽片段 → 再转义 → 最后处理强调 */
function inlineMd(text: string, stash: Stash): string {
  let s = text
  // 行内代码：内容不做任何进一步处理
  s = s.replace(/`([^`]+)`/g, (_full: string, code: string) =>
    stash.push(`\\texttt{${escapeLatex(code)}}`)
  )
  // 显示公式 / 行内公式：原样保留
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_full: string, tex: string) =>
    stash.push(`\\[\n${tex}\n\\]`)
  )
  s = s.replace(/(^|[^\\$])\$([^$\n]+)\$/g, (_full: string, pre: string, tex: string) =>
    `${pre}${stash.push(`$${tex}$`)}`
  )
  // 图片 / 链接 / 脚注
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_full: string, alt: string, src: string) =>
    stash.push(figureFor(alt, src.trim()))
  )
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_full: string, txt: string, url: string) =>
    stash.push(`\\href{${url.trim()}}{\\underline{${escapeLatex(txt)}}}`)
  )
  s = s.replace(/\[\^([^\]]+)\]/g, (_full: string, id: string) =>
    stash.push(`\\footnote{${escapeLatex(id)}}`)
  )

  s = escapeLatex(s)
  // 强调：下划线形式已被转义，故只处理 * / ~~
  s = s.replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1\\emph{$2}')
  s = s.replace(/~~([^~]+)~~/g, '\\sout{$1}')
  return s
}

/** 剥离开头的 YAML frontmatter（元信息由 opts.meta 单独供给） */
function stripFrontmatter(text: string): string {
  const m = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(text)
  return m ? text.slice(m[0].length) : text
}

/** 表格行切分：去掉首尾竖线后按竖线分列 */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

const HEADING = ['\\section', '\\subsection', '\\subsubsection', '\\paragraph', '\\subparagraph']

/**
 * 把 Markdown 转成完整可编译的 .tex 文档。
 * @param markdown Markdown 原文（可含 frontmatter，会被剥离）
 */
export function markdownToLatex(markdown: string, opts: LatexOptions = {}): string {
  const stash = makeStash()
  const lines = stripFrontmatter(markdown ?? '').split(/\r?\n/)
  const out: string[] = []
  const lists: ('itemize' | 'enumerate')[] = []

  const closeLists = (depth: number): void => {
    while (lists.length > depth) out.push(`\\end{${lists.pop()}}`)
  }
  const openList = (env: 'itemize' | 'enumerate', depth: number): void => {
    closeLists(depth)
    out.push(`\\begin{${env}}`)
    lists.push(env)
  }

  let para: string[] = []
  const flushPara = (): void => {
    if (!para.length) return
    out.push(inlineMd(para.join(' '), stash))
    out.push('')
    para = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 围栏代码块：整体原样塞进 lstlisting
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      flushPara()
      closeLists(0)
      const buf: string[] = []
      i++
      const closer = new RegExp(`^\\s*${fence[1]}\\s*$`)
      while (i < lines.length && !closer.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++
      out.push(`\\begin{lstlisting}${fence[2] ? `[language=${fence[2]}]` : ''}`)
      out.push(...buf)
      out.push('\\end{lstlisting}')
      out.push('')
      continue
    }

    if (!trimmed) {
      flushPara()
      closeLists(0)
      i++
      continue
    }

    // 分隔线（--- / *** / ___）
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushPara()
      closeLists(0)
      out.push('\\par\\noindent\\rule{\\textwidth}{0.4pt}')
      out.push('')
      i++
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (h) {
      flushPara()
      closeLists(0)
      const level = Math.min(h[1].length, 5)
      out.push(`${HEADING[level - 1]}{${inlineMd(h[2], stash)}}`)
      out.push('')
      i++
      continue
    }

    // 表格：当前行是表头且下一行是对齐行
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1]) &&
      lines[i + 1].includes('|')
    ) {
      flushPara()
      closeLists(0)
      const rows: string[] = [splitRow(line).map((c) => inlineMd(c, stash)).join(' & ')]
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]).map((c) => inlineMd(c, stash)).join(' & '))
        i++
      }
      const spec = `|${Array(Math.max(rows[0].split('&').length, 1)).fill('l').join('|')}|`
      out.push('\\begin{table}[htbp]')
      out.push('\\centering')
      out.push(`\\begin{tabular}{${spec}}`)
      out.push('\\toprule')
      rows.forEach((r, idx) => {
        out.push(`${r} \\\\`)
        if (idx === 0) out.push('\\midrule')
      })
      out.push('\\bottomrule')
      out.push('\\end{tabular}')
      out.push('\\end{table}')
      out.push('')
      continue
    }

    // 引用：连续 > 行合并为一个 quote 环境
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      closeLists(0)
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push('\\begin{quote}')
      out.push(inlineMd(buf.join(' '), stash))
      out.push('\\end{quote}')
      out.push('')
      continue
    }

    // 列表（按 2 空格一层支持嵌套，最深 3 层）
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      flushPara()
      const indent = li[1].replace(/\t/g, '  ').length
      const depth = Math.min(Math.floor(indent / 2), 2)
      openList(/\d/.test(li[2]) ? 'enumerate' : 'itemize', depth)
      out.push(`\\item ${inlineMd(li[3], stash)}`)
      i++
      continue
    }

    para.push(trimmed)
    i++
  }
  flushPara()
  closeLists(0)

  const body = stash.restore(out.join('\n'))
  const meta = opts.meta ?? {}
  const cls = opts.documentClass ?? 'ctexart'
  const title = meta.title?.trim() ?? ''
  const author = meta.author?.trim() ?? ''
  const date = meta.date?.trim() ?? ''

  const preamble = [
    '% 由玉笺 Yujian 导出（Markdown → LaTeX）',
    `\\documentclass[11pt]{${cls}}`,
    '\\usepackage{geometry}',
    '\\usepackage{amsmath}',
    '\\usepackage{graphicx}',
    '\\usepackage{booktabs}',
    '\\usepackage{ulem}',
    '\\usepackage{listings}',
    '\\usepackage{xcolor}',
    '\\usepackage{hyperref}',
    '\\geometry{a4paper, margin=1in}',
    '\\lstset{basicstyle=\\ttfamily\\small, breaklines=true, frame=single,',
    '  columns=fullflexible, backgroundcolor=\\color{gray!6}}',
    '\\hypersetup{colorlinks=true, linkcolor=teal, urlcolor=teal}',
    title ? `\\title{${escapeLatex(title)}}` : '\\title{}',
    author ? `\\author{${escapeLatex(author)}}` : '\\author{}',
    date ? `\\date{${escapeLatex(date)}}` : '\\date{}'
  ]

  return `${preamble.join('\n')}\n\n\\begin{document}\n${
    title || author ? '\\maketitle\n' : ''
  }\n${body}\n\\end{document}\n`
}
