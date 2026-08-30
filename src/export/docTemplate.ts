/**
 * 导出文档模板：把渲染模式产出的 HTML 片段，包成一份自包含的完整网页。
 *
 * 设计取舍：
 * - 内联一套干净的「阅读型」prose 样式（玉笺羊脂玉配色），离线直接打开即可读；
 * - 公式 / 图表按需引入 CDN（KaTeX CSS、mermaid JS）：联网时更精美，
 *   离线则优雅降级（数学走 MathML、mermaid 退化为代码块），文档始终有效。
 */

import { enhanceFootnotes, replaceEmojiInHtml, parseHtml } from './domUtils'
import { renderLatexContent } from '../editor/features/mathjax'

export interface ExportOptions {
  /** 引入 KaTeX CSS，让公式排版更精细（默认 true） */
  math?: boolean
  /** 引入 mermaid CDN 把 ```mermaid 代码块渲染成图（默认 true）。
   *  图表已内嵌为 SVG 时应传 false，避免无谓外链与脚本 */
  mermaid?: boolean
  /** 生成自动目录：取正文标题层级并给标题加锚点（HTML 可跳转、PDF 带缩进层级，默认 false） */
  toc?: boolean
  /** 生成封面页（标题 / 作者 / 日期，默认 false） */
  cover?: boolean
  /** 元信息：由属性面板的 frontmatter 供给；缺省时回退到 title 参数 */
  meta?: { title?: string; author?: string; date?: string }
}

const PROSE_CSS = `
/* 打印分页：仅打印 / 导出 PDF 时生效，屏幕渲染无影响 */
@page { size: A4; margin: 20mm 18mm; }
/* 多文件合订：每篇另起一页（仅打印 / 导出 PDF 生效，屏幕预览无影响） */
.yj-compile-page { break-before: page; }
.yj-compile-page:first-child { break-before: auto; }
:root {
  --yj-text: #1c1e1f;
  --yj-text-soft: #5b6266;
  --yj-bg: #fcfcfb;
  --yj-accent: #248077;
  --yj-border: #e7e6e2;
  --yj-code-bg: #f3f2ee;
  --yj-quote: #f6f5f1;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--yj-bg);
  color: var(--yj-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
  font-size: 16px;
  line-height: 1.75;
}
.yujian-doc {
  max-width: 760px;
  margin: 0 auto;
  padding: 56px 24px 80px;
}
.yujian-doc > :first-child { margin-top: 0; }
h1, h2, h3, h4, h5, h6 {
  line-height: 1.3;
  font-weight: 600;
  margin: 1.8em 0 0.6em;
  color: var(--yj-text);
}
h1 { font-size: 1.9em; }
h2 { font-size: 1.55em; }
h3 { font-size: 1.3em; }
h4 { font-size: 1.12em; }
h5, h6 { font-size: 1em; }
p { margin: 0.9em 0; }
a {
  color: var(--yj-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(36, 128, 119, 0.3);
}
a:hover { border-bottom-color: var(--yj-accent); }
img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
  margin: 1em auto;
}
ul, ol { padding-left: 1.6em; margin: 0.9em 0; }
li { margin: 0.3em 0; }
blockquote {
  margin: 1.1em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--yj-accent);
  background: var(--yj-quote);
  color: var(--yj-text-soft);
  border-radius: 0 6px 6px 0;
}
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }
code {
  font-family: "Sarasa Mono SC", "JetBrains Mono", "Fira Code", Consolas,
    "Courier New", monospace;
  font-size: 0.9em;
  background: var(--yj-code-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
pre {
  background: var(--yj-code-bg);
  border: 1px solid var(--yj-border);
  border-radius: 8px;
  padding: 14px 16px;
  overflow: auto;
  margin: 1.1em 0;
}
pre code {
  background: transparent;
  padding: 0;
  font-size: 0.88em;
  line-height: 1.6;
}
hr { border: none; border-top: 1px solid var(--yj-border); margin: 2em 0; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.1em 0;
  font-size: 0.95em;
}
th, td {
  border: 1px solid var(--yj-border);
  padding: 8px 12px;
  text-align: left;
}
thead th { background: var(--yj-quote); font-weight: 600; }
tbody tr:nth-child(even) { background: #faf9f6; }
.katex { font-size: 1.05em; }
.mermaid { margin: 1.2em 0; text-align: center; }
/* ── 导出的 LaTeX 代码块：已由 MathJax 渲染成 SVG/文档，居中、过宽可滚动 ── */
.latex-export { margin: 1.2em 0; text-align: center; overflow-x: auto; }
.latex-export .latex-doc { text-align: left; }
.latex-export svg { max-width: 100%; height: auto; }
/* ── 内联标记：==高亮== / ^上标^ / ~下标~ / <kbd>键</kbd> ──
   导出用独立青瓷色板（与编辑器 --hue-* 解耦），这里用半透强调色 + 内陷发丝边，
   与编辑区高亮观感一致、不抢眼。 */
mark {
  background: rgba(36, 128, 119, 0.16);
  color: inherit;
  padding: 0.05em 0.28em;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(36, 128, 119, 0.3);
}
sup, sub { line-height: 0; font-size: 0.78em; }
kbd {
  font-family: var(--yj-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 0.84em;
  background: #ffffff;
  color: #1b1d1c;
  border: 1px solid rgba(20, 30, 28, 0.18);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0.06em 0.42em;
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(20, 30, 28, 0.18);
}
/* ── 封面页与目录（PDF 分页导出用；HTML 中目录同样可点击跳转）── */
.yujian-cover {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 80px 24px;
}
.cover-title { font-size: 2.4em; margin: 0 0 0.4em; }
.cover-author, .cover-date { color: var(--yj-text-soft); margin: 0.2em 0; font-size: 1em; }
.yujian-toc { padding: 8px 0 24px; }
.toc-title { font-size: 1.5em; margin: 0 0 0.8em; }
.yujian-toc ul { list-style: none; padding-left: 0; margin: 0; }
.yujian-toc li { margin: 0.35em 0; }
.yujian-toc a { border-bottom: none; }
.toc-lv1 { font-weight: 600; }
.toc-lv2 { padding-left: 1.2em; }
.toc-lv3 { padding-left: 2.4em; font-size: 0.95em; }
.toc-lv4, .toc-lv5, .toc-lv6 { padding-left: 3.4em; font-size: 0.9em; color: var(--yj-text-soft); }
@media print {
  body { background: #fff; }
  .yujian-doc { padding: 0; max-width: none; }
  /* 封面与目录各自成页；一级标题另起一页 */
  .yujian-cover, .yujian-toc { break-after: page; }
  .yujian-doc h1 { break-before: page; }
  /* 紧跟封面 / 目录的标题不再另起页，避免产生空白页 */
  .yujian-cover + h1, .yujian-toc + h1 { break-before: avoid; }
  /* 标题不孤行；代码块 / 表格 / 图表不跨页断裂 */
  h1, h2, h3 { break-after: avoid; }
  pre, table, figure, .mermaid, img { break-inside: avoid; }
}
`

/** HTML 转义（合订面板拼接篇章标题时复用，避免文档名里的特殊字符破坏结构） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface TocEntry {
  /** 标题层级 1~6 */
  level: number
  text: string
  id: string
}

/**
 * 提取正文标题层级并给每个标题补锚点 id，返回目录项与「加了 id 的正文 HTML」。
 * 只处理导出产物的副本，绝不触碰编辑器内文档；解析失败时原样返回正文。
 */
function buildToc(bodyHtml: string): { html: string; entries: TocEntry[] } {
  const doc = new DOMParser().parseFromString(
    `<div id="yujian-root">${bodyHtml}</div>`,
    'text/html'
  )
  const root = doc.getElementById('yujian-root')
  if (!root) return { html: bodyHtml, entries: [] }

  const entries: TocEntry[] = []
  Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).forEach((h, i) => {
    const level = Number(h.tagName.slice(1)) || 1
    const id = `yujian-h-${i + 1}`
    h.setAttribute('id', id)
    entries.push({ level, text: h.textContent ?? '', id })
  })
  return { html: root.innerHTML, entries }
}

/** 目录 HTML：层级经 toc-lv* 类缩进，锚点可跳转 */
function tocHtml(entries: TocEntry[]): string {
  if (!entries.length) return ''
  const items = entries
    .map((e) => `<li class="toc-lv${e.level}"><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`)
    .join('')
  return `<nav class="yujian-toc"><h1 class="toc-title">目录</h1><ul>${items}</ul></nav>`
}

/** 封面 HTML：标题 / 作者 / 日期，缺省项不渲染 */
function coverHtml(meta: { title: string; author?: string; date?: string }): string {
  const lines = [`<h1 class="cover-title">${escapeHtml(meta.title)}</h1>`]
  if (meta.author) lines.push(`<p class="cover-author">${escapeHtml(meta.author)}</p>`)
  if (meta.date) lines.push(`<p class="cover-date">${escapeHtml(meta.date)}</p>`)
  return `<section class="yujian-cover">${lines.join('')}</section>`
}

/**
 * 组装完整 HTML 文档。
 * @param bodyHtml 渲染模式产出的文档 HTML 片段（来自 ProseMirror 视图 DOM）
 * @param title    文档标题（用于 <title> 与默认文件名）
 */
export function buildExportHtml(bodyHtml: string, title: string, opts: ExportOptions = {}): string {
  const meta = opts.meta ?? {}
  const docTitle = meta.title || title || '未命名文档'
  const safeTitle = escapeHtml(docTitle)
  const headExtras: string[] = []

  // 目录：先给正文标题补锚点，再据层级生成（HTML 可跳转、PDF 带缩进）
  let body = bodyHtml
  let toc = ''
  if (opts.toc) {
    const built = buildToc(body)
    body = built.html
    toc = tocHtml(built.entries)
  }

  // 脚注双向跳转：注入锚点与回跳链接（仅作用于导出副本，绝不触碰编辑器 DOM）
  const fnDoc = parseHtml(`<div id="yj-fn-root">${body}</div>`)
  const fnRoot = fnDoc.getElementById('yj-fn-root')
  if (fnRoot) {
    enhanceFootnotes(fnRoot)
    replaceEmojiInHtml(fnRoot)
    body = fnRoot.innerHTML
  }
  // 封面：标题 / 作者 / 日期，缺省项不渲染
  const cover = opts.cover
    ? coverHtml({ title: docTitle, author: meta.author, date: meta.date })
    : ''

  if (opts.math !== false) {
    headExtras.push(
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">'
    )
  }

  if (opts.mermaid !== false) {
    headExtras.push(
      '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>'
    )
    headExtras.push(`<script>
  window.addEventListener('load', function () {
    document.querySelectorAll('pre code.language-mermaid').forEach(function (el) {
      var pre = el.parentElement;
      if (!pre) return;
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = el.textContent;
      pre.parentNode.replaceChild(div, pre);
    });
    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
      mermaid.run();
    }
  });
<\/script>`)
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
${PROSE_CSS}
</style>
${headExtras.join('\n')}
</head>
<body>
<article class="yujian-doc">
${cover}${toc}${body}
</article>
</body>
</html>`
}

/**
 * 把导出 HTML 里的 ```latex 代码块替换为 MathJax 渲染结果（SVG / 文档），
 * 让导出的文章里公式不再是原始源码（避免 \require / \ce 等以字面量出现）。
 * 只处理导出产物副本，绝不触碰编辑器内文档。渲染失败时保留原代码块。
 */
export async function renderLatexBlocksInExport(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = Array.from(doc.querySelectorAll('pre code.language-latex'))
  for (const code of blocks) {
    const pre = code.parentElement
    if (!pre) continue
    const rendered = await renderLatexContent(code.textContent ?? '')
    if (!rendered) continue
    const holder = doc.createElement('div')
    holder.className = 'latex-export'
    holder.innerHTML = rendered
    pre.parentNode?.replaceChild(holder, pre)
  }
  return doc.documentElement.outerHTML
}
