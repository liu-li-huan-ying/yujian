/**
 * 导出文档模板：把渲染模式产出的 HTML 片段，包成一份自包含的完整网页。
 *
 * 设计取舍：
 * - 内联一套干净的「阅读型」prose 样式（玉笺羊脂玉配色），离线直接打开即可读；
 * - 公式 / 图表按需引入 CDN（KaTeX CSS、mermaid JS）：联网时更精美，
 *   离线则优雅降级（数学走 MathML、mermaid 退化为代码块），文档始终有效。
 */

export interface ExportOptions {
  /** 引入 KaTeX CSS，让公式排版更精细（默认 true） */
  math?: boolean
  /** 引入 mermaid，把 ```mermaid 代码块渲染成图（默认 true） */
  mermaid?: boolean
}

const PROSE_CSS = `
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
@media print {
  body { background: #fff; }
  .yujian-doc { padding: 0; max-width: none; }
}
`

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 组装完整 HTML 文档。
 * @param bodyHtml 渲染模式产出的文档 HTML 片段（来自 ProseMirror 视图 DOM）
 * @param title    文档标题（用于 <title> 与默认文件名）
 */
export function buildExportHtml(bodyHtml: string, title: string, opts: ExportOptions = {}): string {
  const safeTitle = escapeHtml(title || '未命名文档')
  const headExtras: string[] = []

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
${bodyHtml}
</article>
</body>
</html>`
}
