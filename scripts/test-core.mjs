/**
 * 核心逻辑 自动化测试（索引层 / 引用改写 / 编辑器语法往返）
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么测这一层：`vaultIndex.ts` 是 Phase 3 的地基——搜索、双链、反链、标签、MOC、
 * 以及「重命名 / 移动自动改写 [[引用]]」全部消费它。这一层出错是**静默**的：
 * 反链少一条、引用指错地方、正文被改坏，UI 上看不出来，等发现时笔记已经乱了。
 * 同理，`wikilink.ts` 的序列化一旦丢字段，就是**不可逆的存盘数据丢失**。
 * 故用可执行断言把这些红线钉死，全程不启动 Electron（bundled 后在 Node 里直接跑）。
 *
 * 覆盖：
 *  A. rewriteWikiLinksInText —— 纯函数：锚点/别名保留、只替换 target、断链不动、CRLF 保真
 *  B. 索引纯函数 —— parseFile / deriveBackLinks / indexFile 增量 / removeFileFromIndex
 *  C. 端到端（临时库真实读写）—— 文件改名 / 目录移动 / 来源自身也被移动 / 幂等
 *  D. wikilink 语法往返 —— 目标 / 别名 / 锚点一个都不能丢（src/editor/features/wikilink.ts）
 *  E. i18n 双语对齐 —— 键集合与插值变量逐条一致（zh-CN / en-US）
 *
 * 运行：npm test
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
import { mkdtempSync, writeFileSync, readFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleTs } from './lib/bundle.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log('  \x1b[32mPASS\x1b[0m ' + name)
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log('  \x1b[31mFAIL\x1b[0m ' + name + (detail ? '\n       ' + detail : ''))
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/**
 * 把 TS 模块打成可在 Node 直接 import 的 mjs（实现见 scripts/lib/bundle.mjs）。
 * 刻意不在这里用子进程调 esbuild：那条路径在 Linux 上是原生二进制，
 * `node <它>` 会直接崩（详见该文件注释）。
 * stubs：把「不必在 Node 里真跑」的依赖（如 Milkdown 的 $remark / $nodeSchema）替换为最小桩，
 * 从而对纯逻辑（remark 改写 / toMarkdown 序列化）做断言——与 scripts/verify-markdown.mjs 同法。
 */
function bundle(entry, outName, stubs = {}) {
  return bundleTs({ root, entry, outName, stubs })
}

/** 建一个临时笔记库并写入若干文档（key = 相对路径，value = 正文） */
function makeVault(files) {
  const dir = mkdtempSync(join(tmpdir(), 'yj-vault-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
  }
  return dir
}

const read = (p) => readFileSync(p, 'utf-8')

/* ═══════════════════════════════════════════════════════════════════════ */
const { url, dir: bundleDir } = await bundle('electron/main/vaultIndex.ts', 'vaultIndex.mjs')

try {
  const Idx = await import(url)
  const {
    rewriteWikiLinksInText,
    rewriteLinksForMoves,
    parseFile,
    buildPathMaps,
    deriveBackLinks,
    indexFile,
    removeFileFromIndex,
    resolveTarget,
    resolveTargetWithMaps,
    buildIndex,
  } = Idx

  /* ── A. rewriteWikiLinksInText（纯函数） ────────────────────────────── */
  section('[A] rewriteWikiLinksInText —— 只改 target，锚点 / 别名 / 其余字节原样')

  const OLD = 'C:/vault/旧名.md'
  const NEW_BASE = '新名'
  const resolveOld = (t) =>
    t.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '').toLowerCase() === '旧名' ? OLD : null
  const newTargetOf = (abs, raw) => (abs === OLD && raw.replace(/^\.\//, '').slice(0, 2) === '旧名' ? NEW_BASE : null)

  const rw = (s) => rewriteWikiLinksInText(s, resolveOld, newTargetOf)

  check('基名式 [[旧名]] → [[新名]]', rw('[[旧名]]').text === '[[新名]]', rw('[[旧名]]').text)
  check('别名保留 [[旧名|显示]]', rw('[[旧名|显示]]').text === '[[新名|显示]]', rw('[[旧名|显示]]').text)
  check('锚点保留 [[旧名#小节]]', rw('[[旧名#小节]]').text === '[[新名#小节]]', rw('[[旧名#小节]]').text)
  check(
    '锚点 + 别名同时保留',
    rw('[[旧名#小节|显示]]').text === '[[新名#小节|显示]]',
    rw('[[旧名#小节|显示]]').text
  )
  check('计数正确（单链接）', rw('[[旧名]]').changed === 1)
  check('不解析的目标不动', rw('[[别的笔记]]').text === '[[别的笔记]]' && rw('[[别的笔记]]').changed === 0)
  check('新写法与旧写法相同 → 不算改写', rw('[[旧名]]').changed === 1)
  {
    // newTargetOf 返回与原文相同 → changed 必须为 0、内容不动
    const same = rewriteWikiLinksInText('[[旧名]]', resolveOld, () => '旧名')
    check('同形改写不动且计数为 0', same.text === '[[旧名]]' && same.changed === 0, JSON.stringify(same))
  }
  check('空目标 [[]] 不动', rw('[[]]').text === '[[]]' && rw('[[]]').changed === 0)

  {
    const src = '前\r\n[[旧名]] 与 [[其它]] 与 [[旧名|甲]]\r\n后'
    const out = rw(src)
    check('多链接：命中都改、未命中都留', out.text === '前\r\n[[新名]] 与 [[其它]] 与 [[新名|甲]]\r\n后', JSON.stringify(out.text))
    check('多链接计数 = 2', out.changed === 2, String(out.changed))
    check('CRLF 换行逐字节保留', out.text.includes('\r\n') && out.text.split('\r\n').length === 3)
  }
  {
    // 非链接文本必须逐字节不变（往返保真的前提）
    const src = '```\r\ncode [[旧名]]\r\n```\r\n普通 [[旧名]] 文本'
    const out = rw(src)
    check(
      '除 target 外字节不变（含代码块内提及同步改写）',
      out.text === '```\r\ncode [[新名]]\r\n```\r\n普通 [[新名]] 文本',
      JSON.stringify(out.text)
    )
  }

  /* ── B. 索引纯函数 ─────────────────────────────────────────────────── */
  section('[B] 索引纯函数 —— parseFile / deriveBackLinks / 增量修正')

  const rootB = 'C:/vault'
  const pA = 'C:/vault/A.md'
  const pB = 'C:/vault/B.md'
  const pC = 'C:/vault/sub/C.md'
  const maps = buildPathMaps([pA, pB, pC], rootB)

  const entryA = parseFile(
    pA,
    [
      '---',
      'title: 甲',
      'tags: [Alpha, beta]',
      'moc: true',
      '---',
      '# 甲标题',
      '## 小节一',
      '链接 [[B]] 与 [[sub/C]] 与 [[不存在]]',
      '内联 #gamma 与 #父/子 与 #delta',
      '行内代码 `#不是标签` 不算标签',
      '',
      '```',
      '#fence',
      'console.log("#nope")',
      '```',
    ].join('\n'),
    1000,
    maps.byBase,
    maps.byRel
  )

  check('frontmatter title 优先于 H1', entryA.title === '甲', entryA.title)
  check(
    'outLinks 只收解析成功的目标',
    entryA.outLinks.length === 2 && entryA.outLinks.includes(pB) && entryA.outLinks.includes(pC),
    JSON.stringify(entryA.outLinks)
  )
  check('断链目标不进 outLinks', !entryA.outLinks.some((p) => p.includes('不存在')))
  check(
    'tags：frontmatter + 正文内联合并去重、转小写',
    entryA.tags.includes('alpha') && entryA.tags.includes('beta') && entryA.tags.includes('gamma') && entryA.tags.includes('delta') && entryA.tags.includes('父/子'),
    JSON.stringify(entryA.tags)
  )
  check(
    'tags 不误收围栏 / 行内代码里的 #',
    !entryA.tags.includes('nope') && !entryA.tags.includes('fence') && !entryA.tags.includes('不是标签'),
    JSON.stringify(entryA.tags)
  )
  check('moc 标记解析', entryA.moc === true)
  check(
    'headings 层级正确',
    entryA.headings.length === 2 && entryA.headings[0].level === 1 && entryA.headings[1].level === 2,
    JSON.stringify(entryA.headings)
  )

  {
    const files = { [pA]: entryA, [pB]: parseFile(pB, '空', 1, maps.byBase, maps.byRel) }
    const back = deriveBackLinks(files)
    check('deriveBackLinks 由出链派生反链', (back[pB] ?? []).includes(pA) && (back[pC] ?? []).includes(pA), JSON.stringify(back))
  }

  {
    // 增量：A 原本链 B，改为链 C → backLinks[B] 摘掉 A，backLinks[C] 加上 A
    const idx = { version: 2, files: {}, backLinks: {} }
    indexFile(idx, rootB, pA, '[[B]]', 1, maps)
    indexFile(idx, rootB, pB, '正文', 1, maps)
    indexFile(idx, rootB, pC, '正文', 1, maps)
    check('增量登记后反链指向 B', (idx.backLinks[pB] ?? []).includes(pA))
    indexFile(idx, rootB, pA, '[[C]]', 2, maps)
    check('改链后旧反链被摘除', !(idx.backLinks[pB] ?? []).includes(pA), JSON.stringify(idx.backLinks))
    check('改链后新反链被加入', (idx.backLinks[pC] ?? []).includes(pA), JSON.stringify(idx.backLinks))
    removeFileFromIndex(idx, pA)
    check('移除文件后反链清空', !(idx.backLinks[pC] ?? []).includes(pA))
    check('移除文件后 files 条目消失', !idx.files[pA])
  }

  section('[B2] resolveTarget / resolveTargetWithMaps 同语义')
  {
    const idx = { version: 2, files: { [pA]: entryA, [pB]: parseFile(pB, 'x', 1, maps.byBase, maps.byRel), [pC]: parseFile(pC, 'x', 1, maps.byBase, maps.byRel) }, backLinks: {} }
    check('基名解析', resolveTarget(idx, rootB, 'B') === pB, String(resolveTarget(idx, rootB, 'B')))
    check('基名带扩展名解析', resolveTarget(idx, rootB, 'B.md') === pB)
    check('相对路径解析', resolveTarget(idx, rootB, 'sub/C') === pC)
    check('找不到返回 null', resolveTarget(idx, rootB, 'zzz') === null)
    check(
      'resolveTargetWithMaps 与 resolveTarget 一致',
      resolveTargetWithMaps(buildPathMaps(Object.keys(idx.files), rootB), 'sub/C') === pC
    )
  }

  /* ── C. 端到端：文件改名 ──────────────────────────────────────────── */
  section('[C] 端到端 · 文件改名 —— 全库引用同步改写')

  {
    const crlf = (s) => s.replace(/\n/g, '\r\n')
    const vault = makeVault({
      '目标.md': '# 目标\n',
      '子/路径目标.md': '# 路径目标\n',
      'a.md': crlf('最前一行\n[[目标]]\n[[目标|别名]]\n[[目标#小节]]\n[[目标.md]]\n[[./目标]]\n[[子/路径目标]]\n[[不存在]]\n最后一行\n'),
      'b.md': '见 [[目标]] 结束\n',
    })
    const from = join(vault, '目标.md')
    const to = join(vault, '新目标.md')

    const index = await buildIndex(vault)
    check('构建索引：目标.md 有 2 条反链来源', (index.backLinks[from] ?? []).length === 2, JSON.stringify(index.backLinks[from]))

    renameSync(from, to) // 模拟真实顺序：磁盘先迁移
    const summary = await rewriteLinksForMoves(vault, index, [{ from, to }])

    const expectedA = crlf('最前一行\n[[新目标]]\n[[新目标|别名]]\n[[新目标#小节]]\n[[新目标.md]]\n[[./新目标]]\n[[子/路径目标]]\n[[不存在]]\n最后一行\n')
    check('a.md 全部形态正确改写且逐字节保真', read(join(vault, 'a.md')) === expectedA, JSON.stringify(read(join(vault, 'a.md'))))
    check('b.md 基名式改写', read(join(vault, 'b.md')) === '见 [[新目标]] 结束\n', JSON.stringify(read(join(vault, 'b.md'))))
    check('未移动目标（子/路径目标）不受影响', read(join(vault, 'a.md')).includes('[[子/路径目标]]'))
    check('断链 [[不存在]] 不动', read(join(vault, 'a.md')).includes('[[不存在]]'))
    check('统计：2 个来源文件', summary.files === 2, String(summary.files))
    check('统计：6 条引用（a 5 + b 1）', summary.links === 6, String(summary.links))
    {
      const sSet = new Set(summary.sources.map((s) => s.toLowerCase()))
      check(
        '返回的 sources 为被改写的 a.md / b.md（未移动者保持原路径）',
        sSet.has(join(vault, 'a.md').toLowerCase()) && sSet.has(join(vault, 'b.md').toLowerCase()),
        JSON.stringify(summary.sources)
      )
    }
    check('CRLF 未被写成 LF', read(join(vault, 'a.md')).includes('\r\n'))

    // 幂等：再跑一次不应再改（新写法已无法解析到旧映射）
    const again = await rewriteLinksForMoves(vault, index, [{ from, to }])
    check('幂等：重复执行 0 改写', again.links === 0 && again.files === 0, JSON.stringify(again))

    rmSync(vault, { recursive: true, force: true })
  }

  /* ── C2. 端到端：目录移动（含来源自身也在移动之列） ─────────────── */
  section('[C2] 端到端 · 目录移动 —— 路径式改、基名式不动、来源自迁移')

  {
    const vault = makeVault({
      'd1/x.md': '# x\n',
      'd1/y.md': '内部链到 [[d1/x]]\n',
      'a.md': '基名 [[x]]\n路径 [[d1/y]]\n',
    })
    const index = await buildIndex(vault)
    const moves = [
      { from: join(vault, 'd1', 'x.md'), to: join(vault, 'd2', 'x.md') },
      { from: join(vault, 'd1', 'y.md'), to: join(vault, 'd2', 'y.md') },
    ]
    // 真实顺序：磁盘先整体迁移
    mkdirSync(join(vault, 'd2'), { recursive: true })
    renameSync(join(vault, 'd1', 'x.md'), join(vault, 'd2', 'x.md'))
    renameSync(join(vault, 'd1', 'y.md'), join(vault, 'd2', 'y.md'))
    rmSync(join(vault, 'd1'), { recursive: true, force: true })

    const summary = await rewriteLinksForMoves(vault, index, moves)

    check(
      'a.md：基名式 [[x]] 不动（基名未变）',
      read(join(vault, 'a.md')).includes('基名 [[x]]'),
      JSON.stringify(read(join(vault, 'a.md')))
    )
    check(
      'a.md：路径式 [[d1/y]] → [[d2/y]]',
      read(join(vault, 'a.md')).includes('路径 [[d2/y]]'),
      JSON.stringify(read(join(vault, 'a.md')))
    )
    check(
      '来源自身也被移动：d2/y.md 内部链改到新路径',
      read(join(vault, 'd2', 'y.md')) === '内部链到 [[d2/x]]\n',
      JSON.stringify(read(join(vault, 'd2', 'y.md')))
    )
    check('目录移动统计：2 文件 / 2 引用', summary.files === 2 && summary.links === 2, JSON.stringify(summary))
    {
      const sSet = new Set(summary.sources.map((s) => s.toLowerCase()))
      check(
        'sources 含根目录 a.md 与迁移后的 d2/y.md',
        sSet.has(join(vault, 'a.md').toLowerCase()) && sSet.has(join(vault, 'd2', 'y.md').toLowerCase()),
        JSON.stringify(summary.sources)
      )
    }

    rmSync(vault, { recursive: true, force: true })
  }

  /* ── C3. 端到端：无命中不写盘 ─────────────────────────────────────── */
  section('[C3] 端到端 · 无引用命中时不改任何文件')

  {
    const vault = makeVault({ '独.md': '# 独\n', 'o.md': '没有链接\n' })
    const index = await buildIndex(vault)
    const from = join(vault, '独.md')
    const to = join(vault, '独孤.md')
    renameSync(from, to)
    const before = read(join(vault, 'o.md'))
    const summary = await rewriteLinksForMoves(vault, index, [{ from, to }])
    check('零命中：files / links 均为 0', summary.files === 0 && summary.links === 0, JSON.stringify(summary))
    check('零命中：无关文件一字未改', read(join(vault, 'o.md')) === before)
    rmSync(vault, { recursive: true, force: true })
  }

  /* ── C4. 端到端：空移动清单为无操作 ───────────────────────────────── */
  section('[C4] 端到端 · 空移动清单直接返回')
  {
    const vault = makeVault({ 'x.md': '[[x]]\n' })
    const index = await buildIndex(vault)
    const summary = await rewriteLinksForMoves(vault, index, [])
    check('空清单：0 文件 / 0 引用', summary.files === 0 && summary.links === 0 && summary.sources.length === 0)
    rmSync(vault, { recursive: true, force: true })
  }
} finally {
  rmSync(bundleDir, { recursive: true, force: true })
}

/* ── D. 编辑器语法：wikilink 往返保真（src/editor/features/wikilink.ts） ── */
section('[D] wikilink 语法往返 —— 目标 / 别名 / 锚点一个都不能丢')

{
  const { url: wUrl, dir: wDir } = await bundle('src/editor/features/wikilink.ts', 'wikilink.mjs', {
    '@milkdown/kit/utils':
      'export const $remark = (_id, f) => f()\nexport const $nodeSchema = (_id, f) => f()\nexport const $inputRule = (f) => f()\n',
    '@milkdown/kit/prose/inputrules':
      'export class InputRule { constructor(re, runner) { this.re = re; this.runner = runner } }\n',
  })
  try {
    const W = await import(wUrl)

    /** 把一段文本喂给 remarkWikilink，取出其中的 wikiLink 节点（无则 null） */
    const parseOne = (src) => {
      const tree = {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: src }] }],
      }
      W.remarkWikilink()(tree)
      return tree.children[0].children.find((n) => n.type === 'wikiLink') ?? null
    }
    /** 用 toMarkdown runner 把（类 ProseMirror）节点序列化回 Markdown 文本 */
    const serialize = (node) => {
      const out = []
      W.wikiLinkSchema.toMarkdown.runner(
        { addNode: (_type, _value, text) => out.push(text ?? '') },
        { attrs: { target: node.target, alias: node.alias, anchor: node.anchor } }
      )
      return out.join('')
    }
    const roundTrip = (src) => {
      const n = parseOne(src)
      return n ? serialize(n) : null
    }

    check('[[A]] 往返一致', roundTrip('[[A]]') === '[[A]]', String(roundTrip('[[A]]')))
    check('[[A|别名]] 别名保留', roundTrip('[[A|别名]]') === '[[A|别名]]', String(roundTrip('[[A|别名]]')))
    check(
      '[[A#锚点]] 锚点保留（曾丢失）',
      roundTrip('[[A#锚点]]') === '[[A#锚点]]',
      String(roundTrip('[[A#锚点]]'))
    )
    check(
      '[[A#锚点|别名]] 锚点 + 别名同时保留',
      roundTrip('[[A#锚点|别名]]') === '[[A#锚点|别名]]',
      String(roundTrip('[[A#锚点|别名]]'))
    )
    check('解析出 target 正确', parseOne('[[目录/笔记#小节|显示]]')?.target === '目录/笔记')
    check('解析出 anchor 正确', parseOne('[[目录/笔记#小节|显示]]')?.anchor === '小节')
    check('解析出 alias 正确', parseOne('[[目录/笔记#小节|显示]]')?.alias === '显示')
    check('无别名时 alias 为 null', parseOne('[[A]]')?.alias == null)
    check('无锚点时 anchor 为 null', parseOne('[[A]]')?.anchor == null)
    check('普通文本不产出 wikiLink 节点', parseOne('没有链接') === null)

    {
      const tree = {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: '前 [[A]] 中 [[B#c]] 后' }] }],
      }
      W.remarkWikilink()(tree)
      const kids = tree.children[0].children
      check('混合段落节点序列正确', kids.map((n) => n.type).join(',') === 'text,wikiLink,text,wikiLink,text', kids.map((n) => n.type).join(','))
      check('混合段落两侧文本保留', kids[0].value === '前 ' && kids[4].value === ' 后')
    }
  } finally {
    rmSync(wDir, { recursive: true, force: true })
  }
}

/* ── E. i18n 双语对齐（键集合 + 插值变量） ── */
section('[E] i18n 双语对齐 —— 键集合与插值变量逐条一致')

{
  const zh = await bundle('src/i18n/locales/zh-CN.ts', 'zh-CN.mjs')
  const en = await bundle('src/i18n/locales/en-US.ts', 'en-US.mjs')
  try {
    const zhObj = (await import(zh.url)).default
    const enObj = (await import(en.url)).default

    /** 展开成「叶子路径」列表；数组按下标展开，从而数组长度差异也会被发现 */
    const flat = (obj) => {
      const out = []
      const walk = (v, p) => {
        if (Array.isArray(v)) {
          v.forEach((item, i) => walk(item, `${p}[${i}]`))
          return
        }
        if (v && typeof v === 'object') {
          for (const [k, vv] of Object.entries(v)) walk(vv, p ? `${p}.${k}` : k)
          return
        }
        out.push(p)
      }
      walk(obj, '')
      return out
    }
    const getByPath = (obj, path) => {
      const segs = path.replace(/\[(\d+)\]/g, '.$1').split('.')
      let cur = obj
      for (const s of segs) {
        if (cur == null) return undefined
        cur = cur[s]
      }
      return cur
    }
    const varsOf = (obj, path) => {
      const v = getByPath(obj, path)
      if (typeof v !== 'string') return ''
      return [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    }

    const zhKeys = flat(zhObj)
    const enKeys = flat(enObj)
    const enSet = new Set(enKeys)
    const zhSet = new Set(zhKeys)
    const missEn = zhKeys.filter((k) => !enSet.has(k))
    const missZh = enKeys.filter((k) => !zhSet.has(k))
    check(
      `键集合一致（zh ${zhKeys.length} / en ${enKeys.length}）`,
      missEn.length === 0 && missZh.length === 0,
      `en 缺 [${missEn.slice(0, 5).join(', ')}] | zh 缺 [${missZh.slice(0, 5).join(', ')}]`
    )

    const varMismatch = zhKeys.filter((k) => enSet.has(k)).filter((k) => varsOf(zhObj, k) !== varsOf(enObj, k))
    check(
      '插值变量逐条一致（如 {n} / {m}）',
      varMismatch.length === 0,
      varMismatch
        .slice(0, 5)
        .map((k) => `${k}: {${varsOf(zhObj, k)}} vs {${varsOf(enObj, k)}}`)
        .join(' | ')
    )
  } finally {
    rmSync(zh.dir, { recursive: true, force: true })
    rmSync(en.dir, { recursive: true, force: true })
  }
}

/* ── F. IPC 契约一致性：常量表 ↔ 主进程 ↔ preload ── */
section('[F] IPC 契约 —— 每个通道都既有主进程接线又有 preload 暴露')

{
  const chText = readFileSync(join(root, 'electron/shared/ipc-channels.ts'), 'utf-8')
  const mainText = readFileSync(join(root, 'electron/main/index.ts'), 'utf-8')
  const preText = readFileSync(join(root, 'electron/preload/index.ts'), 'utf-8')

  const all = [...chText.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*'/gm)].map((m) => m[1])
  const refs = (text) => new Set([...text.matchAll(/IPC\.([A-Z0-9_]+)/g)].map((m) => m[1]))
  const mainRefs = refs(mainText)
  const preRefs = refs(preText)

  // 先自检解析：正则若失效会「零通道全绿」，故用下限兜底
  check(`IPC 常量表解析正常（${all.length} 个）`, all.length > 20, `仅解析到 ${all.length} 个`)

  const noHandler = all.filter((n) => !mainRefs.has(n))
  const noPreload = all.filter((n) => !preRefs.has(n))
  const orphan = [...new Set([...mainRefs, ...preRefs])].filter((n) => !all.includes(n))

  check('每个通道都在主进程被引用（handle / send）', noHandler.length === 0, `未引用：${noHandler.join(', ')}`)
  check('每个通道都在 preload 被引用（invoke / on）', noPreload.length === 0, `未引用：${noPreload.join(', ')}`)
  check('不存在常量表里没有的野通道', orphan.length === 0, `多余：${orphan.join(', ')}`)
}

/* ═══════════════════════════════════════════════════════════════════════ */
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}==== ${passed} passed, ${failed} failed ====\x1b[0m\n`)
if (failed > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
process.exit(0)
