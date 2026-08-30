/**
 * Markdown 解析 / 数学渲染 回归测试。
 *
 * 为什么要有这个脚本：本项目把「Markdown 往返保真」当第一号红线，而这条红线
 * 恰恰是被几个**看不见**的坑反复击穿的：
 *   - MathJax 默认不自动编号 → \eqref 永远 ???
 *   - SVG 里 ? 编码成 <path data-c="3F"> → `includes('???')` 恒 false，重试从未生效
 *   - CommonMark 把 <kbd>Ctrl</kbd> 切成开标签/文本/闭标签三个节点 → 空键帽
 * 这些都不是肉眼能发现的，必须靠可执行断言钉死。
 *
 * 做法：把两个「刻意不依赖运行时」的 feature 模块用 esbuild 打包成 mjs
 * （Milkdown 依赖用最小桩替换），再在纯 Node 里跑断言。全程不启动 Electron。
 *
 * 用法：npm run verify:md
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let failed = 0
let passed = 0

function report(results) {
  for (const r of results) {
    if (r.ok) {
      passed++
      console.log('  [32mPASS[0m ' + r.name)
    } else {
      failed++
      console.log('  [31mFAIL[0m ' + r.name + (r.detail ? '\n       ' + r.detail : ''))
    }
  }
}

/** 把 TS 模块打包成可在 Node 里直接 import 的 mjs（Milkdown 依赖走最小桩） */
function bundle(entry, outName, stubs) {
  const tmp = mkdtempSync(join(tmpdir(), 'yj-verify-'))
  const args = [
    join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    join(root, entry),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${join(tmp, outName)}`,
    '--log-level=error'
  ]
  for (const [pkg, code] of Object.entries(stubs)) {
    const stubPath = join(tmp, pkg.replace(/[^\w]/g, '_') + '.mjs')
    writeFileSync(stubPath, code, 'utf-8')
    args.push(`--alias:${pkg}=${stubPath}`)
  }
  execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe' })
  return { url: pathToFileURL(join(tmp, outName)).href, dir: tmp }
}

/* ────────────────────────────────────────────────
   一、数学渲染（src/editor/features/mathjax.ts）
   ──────────────────────────────────────────────── */
async function testMath() {
  console.log('\n[1m[数学渲染][0m')
  const { url, dir } = bundle(
    'src/editor/features/mathjax.ts',
    'mathjax.mjs',
    { '@milkdown/kit/prose/state': 'export class Plugin { constructor(s) { this.spec = s } }\n' }
  )
  try {
    const { renderMathWithRef, renderLatexContent, resetMathNumbering } = await import(url)

    // SVG 里没有字面文本，字符是字形路径 <path data-c="3F">，需解码后判断
    const glyphs = (svg) =>
      [...svg.matchAll(/data-c="([0-9A-Fa-f]+)"/g)]
        .map((m) => String.fromCodePoint(parseInt(m[1], 16)))
        .join('')
    const unresolved = (svg) => svg.includes('MathJax_ref') && /data-c="3F"/.test(svg)
    const eq = (label) => `\\begin{equation}\\label{${label}}\nx=1\n\\end{equation}`

    const R = []
    const t = (name, ok, detail = '') => R.push({ name, ok, detail })

    // 1. 竞态：\eqref 先渲染、\label 后渲染
    resetMathNumbering()
    const refFirst = renderMathWithRef('\\eqref{eq:emc}', true)
    await renderLatexContent(eq('eq:emc'))
    const refSvg = await refFirst
    t('竞态：\\eqref 先于 \\label 渲染，最终解析为 (1)', refSvg.includes('data-c="28"') && !unresolved(refSvg), JSON.stringify(glyphs(refSvg)))

    // 2. 编号不漂移
    resetMathNumbering()
    const n = []
    for (let i = 0; i < 3; i++) n.push(glyphs(await renderLatexContent(eq('eq:a'))))
    t('重复渲染编号不漂移（三次均为 (1)）', n.every((g) => g.includes('(1)')), n.join(' / '))

    // 3. 同文档顺序编号
    resetMathNumbering()
    const s1 = glyphs(await renderLatexContent(eq('eq:p')))
    const s2 = glyphs(await renderLatexContent(eq('eq:q')))
    const s3 = glyphs(await renderLatexContent(eq('eq:r')))
    t('同文档多个公式依次编号 (1)(2)(3)', s1.includes('(1)') && s2.includes('(2)') && s3.includes('(3)'), `${s1} ${s2} ${s3}`)

    // 4. 无编号环境不编号
    resetMathNumbering()
    t('equation* 不编号', !glyphs(await renderLatexContent('\\begin{equation*}\\label{eq:s}\\ y=2\\end{equation*}')).includes('('))
    t('align* 不编号', !glyphs(await renderLatexContent('\\begin{align*} a&=b \\\\ c&=d \\end{align*}')).includes('('))
    t('行内公式不编号', !glyphs(await renderMathWithRef('a+b', false)).includes('('))

    // 5. align 多行 + 双引用
    resetMathNumbering()
    const align = glyphs(await renderLatexContent('\\begin{align}\\label{eq:m} a&=b \\\\ \\label{eq:n} c&=d \\end{align}'))
    t('align 每行各一编号 (1)(2)', align.includes('(1)') && align.includes('(2)'), JSON.stringify(align))
    const rp = glyphs(await renderMathWithRef('\\eqref{eq:m},\\eqref{eq:n}', true))
    t('两个引用都能解析', rp.includes('(1)') && rp.includes('(2)') && !unresolved(rp), JSON.stringify(rp))

    // 6. \require 不泄漏
    resetMathNumbering()
    const amscd = await renderLatexContent('\\require{amscd}\n\\begin{CD}\nA @>>> B\n\\end{CD}')
    t('\\require 不泄漏为红色文本', !amscd.includes('require') && !amscd.includes('merror'), amscd.slice(0, 150))

    // 7. 切文档编号归位
    resetMathNumbering()
    t('切文档后编号从 (1) 开始', glyphs(await renderLatexContent(eq('eq:z'))).includes('(1)'))

    // 8. 引用不存在的 label 必须有兜底（不能永久挂死）
    resetMathNumbering()
    const started = Date.now()
    const missing = await renderMathWithRef('\\eqref{eq:nope}', true)
    const elapsed = Date.now() - started
    t('引用不存在的 label 不挂死（3s 内返回）', elapsed < 3000, elapsed + 'ms')
    t('兜底内容为 (???) 而非空占位', unresolved(missing), JSON.stringify(glyphs(missing)))

    // 9. 完整 LaTeX 文档
    resetMathNumbering()
    const doc = await renderLatexContent('\\documentclass{article}\n\\begin{document}\nHello $a+b$\n\\end{document}')
    t('完整 LaTeX 文档含正文且不报错', doc.includes('Hello') && !doc.includes('math-error'))

    // 10. 裸 $$…\label…$$ 自动套编号环境
    resetMathNumbering()
    const bare = glyphs(await renderLatexContent('E=mc^2 \\label{eq:bare}'))
    t('裸 $$…\\label…$$ 被自动编号 (1)', bare.includes('(1)'), JSON.stringify(bare))
    const bareRef = glyphs(await renderMathWithRef('\\eqref{eq:bare}', true))
    t('裸公式的引用可解析', bareRef.includes('(1)') && !unresolved(bareRef), JSON.stringify(bareRef))

    // 11. 已有环境不重复套壳
    resetMathNumbering()
    t('equation* 不被重复套壳（仍不编号）', !glyphs(await renderLatexContent('\\begin{equation*}x=1\\label{eq:s2}\\end{equation*}')).includes('('))

    report(R)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/* ────────────────────────────────────────────────
   二、内联 HTML / <kbd>（src/editor/features/htmlInline.ts）
   ──────────────────────────────────────────────── */
async function testHtmlInline() {
  console.log('\n[1m[内联 HTML / <kbd>][0m')
  const { url, dir } = bundle(
    'src/editor/features/htmlInline.ts',
    'htmlInline.mjs',
    {
      '@milkdown/kit/utils':
        'export const $remark = (_id, f) => f()\nexport const $nodeSchema = (_id, f) => f()\n'
    }
  )
  try {
    const { unified } = await import('unified')
    const remarkParse = (await import('remark-parse')).default
    const remarkGfm = (await import('remark-gfm')).default
    const remarkStringify = (await import('remark-stringify')).default
    const { remarkHtmlInline } = await import(url)

    const run = (md) => unified().use(remarkParse).use(remarkGfm).use(remarkHtmlInline).runSync(
      unified().use(remarkParse).use(remarkGfm).use(remarkHtmlInline).parse(md), md
    )
    const kids = (md) => run(md).children[0].children
    const dump = (md) => JSON.stringify(kids(md).map((n) => [n.type, n.value ?? n.text]))

    const R = []
    const t = (name, ok, detail = '') => R.push({ name, ok, detail })

    const k = kids('按 <kbd>Ctrl</kbd> 复制').filter((n) => n.type === 'htmlInline')
    t('<kbd>Ctrl</kbd> 合并为单个节点', k.length === 1, dump('按 <kbd>Ctrl</kbd> 复制'))
    t('节点值为完整 <kbd>Ctrl</kbd>', k[0]?.value === '<kbd>Ctrl</kbd>', JSON.stringify(k[0]?.value))

    const a = kids('见 <abbr title="Hyper Text">HTML</abbr> 规范').filter((n) => n.type === 'htmlInline')
    t('带属性的标签整体合并', a.length === 1 && a[0].value === '<abbr title="Hyper Text">HTML</abbr>', JSON.stringify(a.map((x) => x.value)))

    const b = kids('上一行<br>下一行').filter((n) => n.type === 'htmlInline')
    t('空标签 <br> 单独成节点且保留', b.length === 1 && b[0].value === '<br>', dump('上一行<br>下一行'))

    const m = kids('按 <kbd>Ctrl</kbd> + <kbd>C</kbd> 复制').filter((n) => n.type === 'htmlInline')
    t('同行多个键帽各成整体', m.length === 2 && m[0].value === '<kbd>Ctrl</kbd>' && m[1].value === '<kbd>C</kbd>', JSON.stringify(m.map((x) => x.value)))

    const nst = kids('按键 <kbd><kbd>Ctrl</kbd></kbd> 组合').filter((x) => x.type === 'htmlInline')
    t('嵌套标签整体合并', nst.length === 1 && nst[0].value === '<kbd><kbd>Ctrl</kbd></kbd>', JSON.stringify(nst.map((x) => x.value)))

    const em = kids('用 <kbd>**Ctrl**</kbd> 键').filter((x) => x.type === 'htmlInline')
    t('标签内部的行内标记原样保留', em.length === 1 && em[0].value === '<kbd>**Ctrl**</kbd>', JSON.stringify(em.map((x) => x.value)))

    t('块级 HTML 不被接管', run('<div>块级</div>\n\n正文').children[0].type === 'html')

    // 往返保真：真实链路里 htmlInline → 原文由 Milkdown 的 schema runner 负责，
    // 不经过 remark-stringify，测试用等价 handler 模拟这一步。
    function htmlInlineHandler() {
      const data = this.data()
      const tm = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
      tm.push({ handlers: { htmlInline: (node) => String(node?.value ?? '') } })
    }
    for (const src of [
      '按 <kbd>Ctrl</kbd> + <kbd>C</kbd> 复制',
      '上一行<br>下一行',
      '见 <abbr title="Hyper Text">HTML</abbr> 规范',
      '上标 <sup>2</sup> 与下标 <sub>2</sub>',
      '高亮一下 <mark>重点</mark> 结束'
    ]) {
      const out = unified()
        .use(remarkParse).use(remarkGfm).use(remarkHtmlInline)
        .use(htmlInlineHandler).use(remarkStringify)
        .processSync(src).toString().trim()
      t('往返逐字一致：' + src, out === src, 'got: ' + out)
    }

    report(R)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

await testMath()
await testHtmlInline()

console.log(`\n${failed === 0 ? '[32m' : '[31m'}==== ${passed} passed, ${failed} failed ====[0m\n`)
process.exit(failed === 0 ? 0 : 1)
