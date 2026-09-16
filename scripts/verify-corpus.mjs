#!/usr/bin/env node
/**
 * Markdown 往返语料矩阵。
 *
 * 为什么要有它：`verify:md` 的用例是手写的，每加一种自定义语法就得有人记得补一条；
 * 漏了就是「静默失真」——文档看着还在，其实存盘时已被改写。改成语料文件夹后，
 * 新增用例 = 往 `tests/corpus/` 丢一个 .md，门槛从「会写 JS」降到「会写 Markdown」。
 *
 * 做法：对每个语料文件跑一次完整的 remark 流水线（gfm + math + 本项目三个自定义插件），
 * 断言 **parse → serialize 后逐字节等于原文**。
 *
 * 语料文件的编写约定（重要）：
 *  - 必须是 remark-stringify 的**规范形式**。例如强调写 `*em*` 而非 `_em_`、
 *    标题用 ATX（`#`）而非 setext（下划线）、代码块用围栏而非缩进——这些非规范写法
 *    会被 remark 正常化为规范形式，逐字节断言必然失败，但那**不是**本项目的缺陷。
 *  - 一个文件聚焦一类构造，出问题好定位；文件名即用例名。
 *  - 默认**所有**文件都必须逐字节往返一致。若某构造确实无法保真（属于上游 remark 行为），
 *    在 `EXPECTED_DIFF` 里登记并写明理由，不要让门禁悄悄放过。
 *
 * 用法：npm run verify:corpus
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleTs } from './lib/bundle.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const CORPUS = join(root, 'tests', 'corpus')

/**
 * 已登记的「纯 remark 流水线无法保真」用例 —— 必须在下方写明理由，勿静默放宽。
 *
 * ⚠️ 每一条都必须是**上游行为**，而不是本项目缺陷的遮羞布。判断标准：
 * 换个只装了 remark 的干净工程重跑，是否同样不一致？是 → 上游；否 → 必须修。
 */
const EXPECTED_DIFF = new Map([
  [
    '20-frontmatter.md',
    '纯 remark 无 remark-frontmatter：YAML 头会被当 Setext 标题 + 水平线解析，' +
      '往返成 `***`…`---------`（正是历史上的损坏形态）。真实编辑器在**边界层**补偿：' +
      'src/editor/frontmatterBoundary.ts 的 splitFrontmatter 在进 Crepe 前剥离 YAML 头、' +
      'reattachFrontmatter 在序列化后原样拼回（含 sep 空行）。该边界的往返保真由 ' +
      'verify:md 的 frontmatter 用例与 test-core [J2] 段共同守护。此处登记为上游差异，' +
      '作用是**留下这条损坏形态的活样本**——若哪天有人给流水线加上 remark-frontmatter，' +
      '本用例会立刻转绿，届时请从此表移除并同步边界层的实现说明。',
  ],
])

let passed = 0
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log('  \x1b[32mPASS\x1b[0m ' + name)
  } else {
    failed++
    console.log('  \x1b[31mFAIL\x1b[0m ' + name + (detail ? '\n       ' + detail : ''))
  }
}

/** 换行统一为 \n：让门禁不受 git autocrlf / 平台差异影响，只关心内容变化 */
const norm = (s) => s.replace(/\r\n/g, '\n')

/** 首个差异位置的可读描述（含行列），便于定位 */
function diffAt(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const line = a.slice(0, i).split('\n').length
      const col = i - (a.lastIndexOf('\n', i - 1) + 1) + 1
      return `第 ${line} 行第 ${col} 列起不同\n         原文: ${JSON.stringify(a.slice(i, i + 40))}\n         往返: ${JSON.stringify(b.slice(i, i + 40))}`
    }
  }
  return `长度不同（原文 ${a.length} / 往返 ${b.length}）`
}

console.log('\n\x1b[1m[Markdown 往返语料矩阵]\x1b[0m')

if (!existsSync(CORPUS)) {
  console.log(`  \x1b[31mFAIL\x1b[0m 语料目录不存在：${CORPUS}`)
  process.exit(1)
}

/** README.md 是语料编写说明，本身不是用例（它故意包含非规范写法举例） */
const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .sort()

if (files.length === 0) {
  console.log('  \x1b[31mFAIL\x1b[0m 语料目录为空 —— 零用例全绿是假阳性')
  process.exit(1)
}

/* 打包本项目四个自定义 remark 插件（Milkdown 依赖用最小桩替换） */
const stubs = {
  '@milkdown/kit/utils':
    'export const $remark = (_id, f) => f()\nexport const $nodeSchema = (_id, f) => f()\nexport const $inputRule = (f) => f()\n',
  '@milkdown/kit/prose/inputrules':
    'export class InputRule { constructor(re, runner) { this.re = re; this.runner = runner } }\n',
}

const dirs = []
try {
  const { url: wikiUrl, dir: d1 } = await bundleTs({
    root,
    entry: 'src/editor/features/wikilink.ts',
    outName: 'corpus-wikilink.mjs',
    stubs,
  })
  const { url: tagUrl, dir: d2 } = await bundleTs({
    root,
    entry: 'src/editor/features/tag.ts',
    outName: 'corpus-tag.mjs',
    stubs,
  })
  const { url: htmlUrl, dir: d3 } = await bundleTs({
    root,
    entry: 'src/editor/features/htmlInline.ts',
    outName: 'corpus-htmlInline.mjs',
    stubs,
  })
  // 内联标记（~sub~ / ^sup^ / ==mark==）——这几条历史上有过「单 ~ 被当删除线规范化」的坑，
  // 必须进矩阵用**真实** remark 流水线守（见 tests/corpus/19-inline-marks.md）。
  const { url: marksUrl, dir: d4 } = await bundleTs({
    root,
    entry: 'src/editor/features/inlineMarksSyntax.ts',
    outName: 'corpus-inlineMarks.mjs',
    stubs,
  })
  dirs.push(d1, d2, d3, d4)

  const { remarkWikilink } = await import(wikiUrl)
  const { remarkTag } = await import(tagUrl)
  const { remarkHtmlInline } = await import(htmlUrl)
  const { remarkInlineMarks } = await import(marksUrl)

  const { unified } = await import('unified')
  const remarkParse = (await import('remark-parse')).default
  const remarkGfm = (await import('remark-gfm')).default
  // remark-math 与编辑器 Crepe.Feature.Latex 用的是同一个包（内部自注册 from/toMarkdown 扩展），
  // 故语料里的 $…$ / $$…$$ 走的就是与真实编辑器一致的解析 + 序列化路径，而非「当普通文本」的假绿。
  const remarkMath = (await import('remark-math')).default
  const remarkStringify = (await import('remark-stringify')).default

  /**
   * 自定义节点的序列化 handler。真实链路里这一步由 Milkdown 的 schema runner 负责，
   * 这里用等价实现模拟——与 `verify:md` 的 htmlInline 用例同一手法。
   */
  function customHandlers() {
    const data = this.data()
    const tm = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
    tm.push({
      handlers: {
        wikiLink: (node) =>
          `[[${node.target ?? ''}${node.anchor ? '#' + node.anchor : ''}${node.alias ? '|' + node.alias : ''}]]`,
        tag: (node) => `#${node.name ?? ''}`,
        htmlInline: (node) => String(node?.value ?? ''),
      },
    })
  }

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkWikilink)
    .use(remarkTag)
    .use(remarkHtmlInline)
    .use(remarkInlineMarks)
    .use(customHandlers)
    .use(remarkStringify)

  console.log(`  语料 ${files.length} 个文件\n`)

  for (const f of files) {
    const src = norm(readFileSync(join(CORPUS, f), 'utf8'))
    const out = norm(processor.processSync(src).toString())
    if (EXPECTED_DIFF.has(f)) {
      // 登记为允许差异，但**不能只是跳过**：必须确认它「确实不一致」，
      // 否则一旦上游修好、这里转绿，我们就永远不知道可以撤掉这条豁免了。
      check(`${f}（已登记为允许差异，且差异依然存在）`, out !== src, '已一致 —— 请从 EXPECTED_DIFF 移除该条')
    } else {
      check(`${f} 往返逐字节一致`, out === src, out === src ? '' : diffAt(src, out))
    }
  }
} finally {
  for (const d of dirs) {
    const { rmSync } = await import('node:fs')
    rmSync(d, { recursive: true, force: true })
  }
}

console.log(
  `\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}==== ${passed} passed, ${failed} failed ====\x1b[0m\n`
)
process.exit(failed === 0 ? 0 : 1)
