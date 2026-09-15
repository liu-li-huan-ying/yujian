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
 *  F. IPC 契约 —— 常量表 / 主进程接线 / preload 暴露三方一致
 *  G. 软错误上报 —— 可容忍失败必须有出口、分级、有界，且上报自身绝不抛
 *  H. 数据安全线 —— .assets / 快照桶随文档迁移、删除走回收站、危险操作前置守卫
 *  I. 快照 diff 引擎 —— hunk 行号 / 聚合 / 并排配对（src/utils/snapshotDiff.ts）
 *  J. frontmatter 解析 / 回写 —— 正文逐字保留（src/markdown/frontmatter.ts）
 *  K. 标签页重映射 —— 文件夹移动按前缀整体改写（src/store/tabs.ts）
 *  L. 关系图谱派生 —— 节点 / 边由索引派生，本地子图 BFS / 全局度降序截断（electron/main/vaultIndex.ts）
 *  M. 命令面板内核 —— 模糊匹配 + 命令目录（src/utils/fuzzy.ts, src/utils/commands.ts）
 *  N. 中文排版状态 —— 默认 / 收敛 / 持久化（src/typography.ts）
 *  O~S. 见各段标题（导出 / 搜索正则 / 快捷键 / 中文搜索 / 大文档）
 *  T. 导出元信息 —— frontmatter 取值与别名回退（src/export/exportMeta.ts）
 *  U. 搜索结果导航 —— 命中序号回绕与替换后当前行重推导（src/utils/searchNav.ts）
 *  V. 错误归一化 —— 非 Error 抛出物的兜底（electron/shared/error.ts）
 *  W. 冲突判定 —— 「另存我的版本」兄弟路径 / 行尾无关比较（src/utils/conflict.ts）
 *
 * 运行：npm test
 * 退出码：0 = 全部通过；1 = 存在失败。
 */
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  renameSync,
  mkdirSync,
  rmSync,
  readdirSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleTs } from './lib/bundle.mjs'

// 测试期静音软错误的开发态 console 输出（断言不依赖日志，日志会淹没 97 条结果）
process.env.NODE_ENV = 'production'

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
const { url, dir: bundleDir } = await bundle('electron/main/vaultIndex/index.ts', 'vaultIndex.mjs')

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
    reconcileIndex,
    loadIndex,
    saveIndex,
  } = Idx

  /* ── X. 索引 reconcile 刷新磁盘已变 frontmatter（内容地图识别真因回归） ──
     为什么单独测：内容地图「moc:true」由索引元数据派生。若打开库时只 load 旧缓存、不
     reconcile，应用关闭期间外部改动的 frontmatter 永不被重新解析——典型 bug：在外部把 moc
     改好，重开库仍显示「不是内容地图」。reconcileIndex 仅重解析 mtime 变化的文件，是打开库时
     一次性对齐的既定用途（vault/indexStore.ensureIndex 现已在 load 缓存后调用它）。 */
  section('[X] 索引 reconcile 刷新磁盘已变 frontmatter（内容地图识别）')

  {
    const dir = makeVault({
      'A.md': '---\nmoc: true\n---\n\n# A\n',
      'B.md': '---\ntitle: B\n---\n\n# B\n',
    })
    const aPath = join(dir, 'A.md')
    const bPath = join(dir, 'B.md')
    // 1) 全量构建：A 是 MOC
    let idx = await buildIndex(dir)
    check('构建后 A.moc=true', idx.files[aPath].moc === true)
    // 2) 落盘缓存
    await saveIndex(dir, idx)
    // 3) 模拟「应用关闭期间外部把 A 的 moc 去掉」（确保 mtime 已推进，避免同毫秒误判未变）
    await new Promise((r) => setTimeout(r, 30))
    writeFileSync(aPath, '---\nmoc: false\n---\n\n# A\n', 'utf-8')
    // 4) 载入旧缓存（应当仍是 moc=true，stale）
    const stale = await loadIndex(dir)
    check('载入旧缓存 A.moc 仍为 true（stale）', stale.files[aPath].moc === true)
    // 5) reconcile 应当重新解析磁盘 → A.moc=false
    const fixed = await reconcileIndex(dir, stale)
    check('reconcile 后 A.moc=false（已刷新）', fixed.files[aPath].moc === false)
    // 6) 反向：外部把 B 改成 moc，reconcile 应发现新 MOC
    await new Promise((r) => setTimeout(r, 30))
    writeFileSync(bPath, '---\nmoc: true\n---\n\n# B\n', 'utf-8')
    const fixed2 = await reconcileIndex(dir, fixed)
    check('reconcile 后 B.moc=true（新增 MOC 被发现）', fixed2.files[bPath].moc === true)
    rmSync(dir, { recursive: true, force: true })
  }

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
  const preText = readFileSync(join(root, 'electron/preload/index.ts'), 'utf-8')

  // 主进程接线已按域拆到 electron/main/（含 ipc/ 子包），故必须整树扫描。
  // ⚠️ 写死单文件路径会在下次拆分时「静默漏扫」→ 全部通道报未接线，门禁形同虚设。
  const collectSources = (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? collectSources(join(dir, e.name))
          : e.name.endsWith('.ts')
            ? [readFileSync(join(dir, e.name), 'utf-8')]
            : []
      )
      .join('\n')

  const all = [...chText.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*'/gm)].map((m) => m[1])
  const refs = (text) => new Set([...text.matchAll(/IPC\.([A-Z0-9_]+)/g)].map((m) => m[1]))
  const mainRefs = refs(collectSources(join(root, 'electron/main')))
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

/* ── G. 软错误上报：可容忍失败必须有出口、有界、且绝不影响主流程 ── */
section('[G] 软错误上报 —— 有出口 / 分级 / 有界 / 上报自身绝不抛')

{
  const { url: sUrl, dir: sDir } = await bundle('electron/main/softError.ts', 'softError.mjs')
  try {
    const S = await import(sUrl)

    // describeError：把任意抛出物收敛成一行可读摘要
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' })
    check(
      'describeError 带 errno code',
      S.describeError(enoent) === 'Error[ENOENT]: no such file',
      S.describeError(enoent)
    )
    check('describeError 普通 Error', S.describeError(new Error('boom')) === 'Error: boom')
    check('describeError 字符串原样', S.describeError('plain') === 'plain')
    check(
      'describeError null / undefined',
      S.describeError(null) === 'null' && S.describeError(undefined) === 'undefined'
    )
    check('describeError 普通对象转 JSON', S.describeError({ a: 1 }) === '{"a":1}', S.describeError({ a: 1 }))
    {
      const cyc = {}
      cyc.self = cyc
      const out = S.describeError(cyc)
      check('describeError 循环引用不抛且给兜底串', typeof out === 'string' && out.length > 0, String(out))
    }
    check(
      'describeError Symbol 也返回字符串（JSON.stringify 会返回 undefined）',
      typeof S.describeError(Symbol('s')) === 'string',
      String(S.describeError(Symbol('s')))
    )

    S.clearSoftErrors()

    S.reportSoftError('index.save', new Error('disk full'))
    S.reportSoftError('history.move', new Error('locked'), 'debug')
    const all = S.getSoftErrors()
    check('上报后可读回', all.length === 2, String(all.length))
    check('默认级别为 warn', all[0].level === 'warn', all[0].level)
    check('显式 debug 级别被保留', all[1].level === 'debug', all[1].level)
    check('scope 如实记录', all[0].scope === 'index.save' && all[1].scope === 'history.move')
    check('seq 严格递增', all[1].seq === all[0].seq + 1, all[0].seq + ' → ' + all[1].seq)
    check('message 已收敛为一行摘要', all[0].message === 'Error: disk full', all[0].message)
    check('记录时间戳', typeof all[0].at === 'number' && all[0].at > 0)

    check('按级别过滤', S.getSoftErrors({ level: 'warn' }).length === 1)
    check('limit 取最近 N 条', S.getSoftErrors({ limit: 1 })[0].scope === 'history.move')
    check('countSoftErrors 默认只数 warn（debug 属正常降级，不计故障）', S.countSoftErrors() === 1)

    {
      const snapshot = S.getSoftErrors()
      snapshot[0].scope = 'tampered'
      check('getSoftErrors 返回副本（外部改写不污染内部状态）', S.getSoftErrors()[0].scope === 'index.save')
    }

    S.reportSoftError('index.save', new Error('disk full again'))
    const sum = S.summarizeSoftErrors()
    const save = sum.find((x) => x.scope === 'index.save')
    check('summarize 按 scope 归并计数', !!save && save.count === 2, JSON.stringify(save))
    check('summarize 记录最后一条消息', !!save && save.lastMessage === 'Error: disk full again', JSON.stringify(save))
    const keys = sum.map((x) => x.level + ':' + x.scope)
    check('summarize 区分级别（同 scope 不同级别不合并）', new Set(keys).size === keys.length)

    {
      S.clearSoftErrors()
      for (let i = 0; i < 250; i++) S.reportSoftError('noise', new Error('e' + i))
      const buf = S.getSoftErrors()
      check('环容量有界（200 条，长时间运行不吃内存）', buf.length === 200, String(buf.length))
      check('超出后保留最新', buf[buf.length - 1].message === 'Error: e249', buf[buf.length - 1].message)
      check('淘汰的是最旧条目', buf[0].message === 'Error: e50', buf[0].message)
    }

    {
      S.clearSoftErrors()
      const seen = []
      S.setSoftErrorSink((e) => seen.push(e.scope))
      S.reportSoftError('assets.move', new Error('x'))
      check('sink 收到上报', seen.length === 1 && seen[0] === 'assets.move', JSON.stringify(seen))

      S.setSoftErrorSink(() => {
        throw new Error('sink 自身故障')
      })
      let threw = false
      try {
        S.reportSoftError('replace.write', new Error('y'))
      } catch {
        threw = true
      }
      check('sink 抛错不得外溢（否则「可容忍」会变「致命」）', !threw)
      check('sink 抛错仍完成入环', S.getSoftErrors().some((e) => e.scope === 'replace.write'))
      S.setSoftErrorSink(null)
    }

    {
      const n = S.clearSoftErrors()
      check('clearSoftErrors 返回清掉的条数', n > 0, String(n))
      check('清空后为空', S.getSoftErrors().length === 0)
    }

    {
      let threw = false
      try {
        S.reportSoftError('weird', {
          toString: () => {
            throw new Error('nope')
          }
        })
        S.reportSoftError('weird', Symbol('s'))
        S.reportSoftError('weird', 0)
      } catch {
        threw = true
      }
      check('上报任意抛出物都不抛', !threw)
    }
  } finally {
    rmSync(sDir, { recursive: true, force: true })
  }
}

/* ── H. 数据安全线：关联数据必须随文档一起走，删除必须走回收站 ── */
section('[H] 数据安全线 —— .assets / 快照桶随文档迁移，删除走回收站而非直接抹除')

{
  // 假回收站：把「删除」变成移到临时目录，从而能断言「确实走了回收站」而不是 rm。
  // 这正是 trash.ts 存在的意义——vault.ts 因此不再顶层依赖 electron，可在 Node 里直测。
  const trashDir = mkdtempSync(join(tmpdir(), 'yj-trash-'))
  const V = await import((await bundle('electron/main/vault/index.ts', 'vault.mjs')).url)
  const Snap = await import((await bundle('electron/main/snapshots.ts', 'snapshots.mjs')).url)
  // 注入必须打在「被测模块自己的」trash 副本上（打包会内联 ./trash，外层单独打包的实例是另一份）
  const fakeTrash = async (p) => {
    await renameSync(p, join(trashDir, `${Date.now()}-${basename(p)}`))
  }
  V.setTrashImpl(fakeTrash)
  Snap.setTrashImpl(fakeTrash)

  const BODY_A = '# 甲\n\n见 [[B]]\n'

  /** 建一个「三样关联数据俱全」的库：正文 + 同名 .assets + 快照桶（模拟真实文档） */
  const makeDoc = async () => {
    const dir = makeVault({ 'A.md': BODY_A, 'B.md': '# 乙\n' })
    await Snap.createSnapshot(dir, join(dir, 'A.md'), BODY_A, '初稿')
    mkdirSync(join(dir, 'A.assets'), { recursive: true })
    writeFileSync(join(dir, 'A.assets', 'pic.png'), 'PNG', 'utf-8')
    return dir
  }
  const bucketsOf = (dir) => readdirSync(join(dir, '.yujian-history'))

  // H1 改名：正文 / .assets / 快照桶必须一起走（且全程未调用 watchVault——
  //    这条同时守护「库根能自解析」，否则历史会被静默跳过）
  {
    const dir = await makeDoc()
    const before = bucketsOf(dir)
    const res = await V.renameItem(join(dir, 'A.md'), 'C.md')

    check('改名：返回新绝对路径', res.path === join(dir, 'C.md'), res.path)
    check('改名：正文逐字节不变', read(join(dir, 'C.md')) === BODY_A, JSON.stringify(read(join(dir, 'C.md'))))
    check('改名：旧文件不复存在', !existsSync(join(dir, 'A.md')))
    check(
      '改名：同名 .assets 一并改名且内容保留',
      existsSync(join(dir, 'C.assets', 'pic.png')) && !existsSync(join(dir, 'A.assets'))
    )
    const after = bucketsOf(dir)
    check('改名：快照桶整桶迁移（旧桶消失、新桶生成）', after.length === 1 && after[0] !== before[0], after.join(','))
    const bucketFiles = readdirSync(join(dir, '.yujian-history', after[0]))
    check(
      '改名：快照桶内 index.json 与正文都在（历史可读，非空壳）',
      bucketFiles.includes('index.json') && bucketFiles.some((f) => f.endsWith('.md')),
      bucketFiles.join(',')
    )
    check('改名：同批其它文档不受影响', read(join(dir, 'B.md')) === '# 乙\n')
    rmSync(dir, { recursive: true, force: true })
  }

  // H2 移动到子目录：绝对路径同样变化，关联数据要跟走
  {
    const dir = await makeDoc()
    mkdirSync(join(dir, 'sub'))
    const before = bucketsOf(dir)
    await V.moveItem(join(dir, 'A.md'), join(dir, 'sub'))
    check('移动：文档落到子目录', existsSync(join(dir, 'sub', 'A.md')))
    check('移动：.assets 跟到子目录', existsSync(join(dir, 'sub', 'A.assets', 'pic.png')))
    check('移动：源位置不再残留 .assets', !existsSync(join(dir, 'A.assets')))
    check('移动：快照桶跟着迁移', bucketsOf(dir)[0] !== before[0], bucketsOf(dir)[0])
    rmSync(dir, { recursive: true, force: true })
  }

  // H3 文件夹改名：内部每篇文档都要处理（硬约束 6）
  {
    const dir = makeVault({ 'sub/A.md': BODY_A })
    await Snap.createSnapshot(dir, join(dir, 'sub', 'A.md'), BODY_A, '初稿')
    mkdirSync(join(dir, 'sub', 'A.assets'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'A.assets', 'pic.png'), 'PNG', 'utf-8')
    const before = bucketsOf(dir)

    await V.renameItem(join(dir, 'sub'), 'sub2')
    check('文件夹改名：内部文档随迁', existsSync(join(dir, 'sub2', 'A.md')))
    check('文件夹改名：内部 .assets 随迁', existsSync(join(dir, 'sub2', 'A.assets', 'pic.png')))
    check('文件夹改名：嵌套文档的快照桶也迁移（不是只改精确匹配项）', bucketsOf(dir)[0] !== before[0], bucketsOf(dir)[0])
    check('文件夹改名：旧目录名不再残留', !existsSync(join(dir, 'sub')))
    rmSync(dir, { recursive: true, force: true })
  }

  // H4 删除：一律走回收站（可恢复），三样关联数据都要进去
  {
    const dir = await makeDoc()
    const trashBefore = readdirSync(trashDir).length
    await V.deleteItem(join(dir, 'A.md'))
    const added = readdirSync(trashDir).length - trashBefore
    check('删除：文档本体已移出库', !existsSync(join(dir, 'A.md')))
    check('删除：同名 .assets 一并移出库', !existsSync(join(dir, 'A.assets')))
    check('删除：快照桶一并清走', !existsSync(join(dir, '.yujian-history')) || bucketsOf(dir).length === 0)
    check('删除：本体 + 附件 + 历史三项都进了回收站', added === 3, `实际新增 ${added} 项`)
    check('删除：无关文档未被波及', existsSync(join(dir, 'B.md')))
    rmSync(dir, { recursive: true, force: true })
  }

  // H5 删除文件夹：内部每篇文档的历史都要清（硬约束 6）
  {
    const dir = makeVault({ 'sub/A.md': BODY_A, 'sub/B.md': '# 乙\n' })
    await Snap.createSnapshot(dir, join(dir, 'sub', 'A.md'), BODY_A, '初稿')
    await V.deleteItem(join(dir, 'sub'))
    check('文件夹删除：目录整体移出库', !existsSync(join(dir, 'sub')))
    check('文件夹删除：内部文档历史已清理', !existsSync(join(dir, '.yujian-history')) || bucketsOf(dir).length === 0)
    rmSync(dir, { recursive: true, force: true })
  }

  // H6 危险操作的前置守卫：宁可显式失败，也绝不覆盖 / 绝不路径逃逸
  {
    const dir = makeVault({ 'A.md': BODY_A, 'C.md': '# 已存在\n' })
    const mustThrow = async (label, fn) => {
      let msg = ''
      try {
        await fn()
      } catch (e) {
        msg = String(e)
      }
      check(label, msg.length > 0, msg || '未抛错')
    }

    await mustThrow('改名：空名称被拒', () => V.renameItem(join(dir, 'A.md'), '   '))
    await mustThrow('改名：含路径分隔符被拒（防路径逃逸）', () => V.renameItem(join(dir, 'A.md'), 'a/b.md'))
    await mustThrow('改名：目标已存在时被拒（绝不覆盖）', () => V.renameItem(join(dir, 'A.md'), 'C.md'))
    check('改名被拒后原文件完好无损', read(join(dir, 'A.md')) === BODY_A && read(join(dir, 'C.md')) === '# 已存在\n')
    await mustThrow('移动：目标目录不存在时被拒', () => V.moveItem(join(dir, 'A.md'), join(dir, 'nope')))

    rmSync(dir, { recursive: true, force: true })
  }

  V.setTrashImpl(null)
  Snap.setTrashImpl(null)
  rmSync(trashDir, { recursive: true, force: true })
}

section('[I] 快照 diff 引擎 —— hunk 行号 / 聚合 / 并排配对（src/utils/snapshotDiff.ts）')
const { url: sdUrl, dir: sdDir } = await bundle('src/utils/snapshotDiff.ts', 'snapshotDiff.mjs')
try {
  const SD = await import(sdUrl)
  const rowsOf = (a, b) => SD.buildDiffRows(a, b)
  const sig = (rows) => rows.map((r) => r.prefix + r.text).join('|')

  // 相同文本 → 全 ctx、无变更
  const same = rowsOf('l1\nl2\n', 'l1\nl2\n')
  check('相同文本 → 全 ctx 且 hasChanges=false', same.every((r) => r.type === 'ctx') && !SD.hasChanges(same))

  // 行中修改
  const mid = rowsOf('l1\nl2\nl3\nl4\nl5\n', 'l1\nl2\nX\nl4\nl5\n')
  check('行中修改 → 行序列正确', sig(mid) === ' l1| l2|-l3|+X| l4| l5', sig(mid))
  check('行中修改 → 统计 {add:1,del:1}', JSON.stringify(SD.diffStats(mid)) === '{"add":1,"del":1}', JSON.stringify(SD.diffStats(mid)))

  // hunk 头行号必须与 `diff -U1` 一致（旧实现把上下文行重复计数 → 行号偏大）
  const h1 = SD.buildHunks(mid)
  check('单 hunk 且 kind=mod', h1.length === 1 && h1[0].kind === 'mod', JSON.stringify(h1.map((h) => h.kind)))
  check('hunk 头 = @@ -2,3 +2,3 @@（对齐 diff -U1）', h1[0].oldStart === 2 && h1[0].oldSpan === 3 && h1[0].newStart === 2 && h1[0].newSpan === 3, `-${h1[0].oldStart},${h1[0].oldSpan} +${h1[0].newStart},${h1[0].newSpan}`)
  check('hunk pickText = B 侧新增内容', h1[0].pickText === 'X\n', JSON.stringify(h1[0].pickText))

  // 纯增
  const add = SD.buildHunks(rowsOf('l1\nl2\n', 'l1\nX\nl2\n'))
  check('纯增 → kind=add @@ -1,2 +1,3 @@', add.length === 1 && add[0].kind === 'add' && add[0].oldStart === 1 && add[0].oldSpan === 2 && add[0].newStart === 1 && add[0].newSpan === 3, JSON.stringify(add[0]))

  // 纯删 → pickText 空（无可摘取来源）
  const del = SD.buildHunks(rowsOf('l1\nX\nl2\n', 'l1\nl2\n'))
  check('纯删 → kind=del @@ -1,3 +1,2 @@ 且 pickText 空', del.length === 1 && del[0].kind === 'del' && del[0].oldStart === 1 && del[0].oldSpan === 3 && del[0].newStart === 1 && del[0].newSpan === 2 && del[0].pickText === '', JSON.stringify(del[0]))

  // 首行修改 → 无前置上下文
  const head = SD.buildHunks(rowsOf('l1\nl2\n', 'Z\nl2\n'))
  check('首行修改 → @@ -1,2 +1,2 @@', head.length === 1 && head[0].oldStart === 1 && head[0].newStart === 1 && head[0].oldSpan === 2 && head[0].newSpan === 2, JSON.stringify(head[0]))

  // 两处相隔变更 → 两个 hunk，行号各自正确
  const multi = SD.buildHunks(
    rowsOf('a1\na2\na3\na4\na5\na6\na7\na8\na9\na10\n', 'a1\na2\nB3\na4\na5\na6\na7\nB8\na9\na10\n')
  )
  check('两处变更 → 2 个 hunk', multi.length === 2, String(multi.length))
  check('第 2 个 hunk = @@ -7,3 +7,3 @@', Boolean(multi[1]) && multi[1].oldStart === 7 && multi[1].newStart === 7 && multi[1].oldSpan === 3 && multi[1].newSpan === 3, JSON.stringify(multi[1]))

  // 任一侧为 null → 无 diff
  check('任一侧 null → 空 rows', SD.buildDiffRows(null, 'x\n').length === 0 && SD.buildDiffRows('x\n', null).length === 0)

  // 并排配对：ctx 两侧对齐，del/add 配对成一行
  const sp = SD.splitPairs(mid)
  check('并排：ctx 两侧同文', sp[0].left.text === 'l1' && sp[0].right.text === 'l1')
  check('并排：del/add 配对成一行', sp[2].left.type === 'del' && sp[2].left.text === 'l3' && sp[2].right.type === 'add' && sp[2].right.text === 'X')
} finally {
  rmSync(sdDir, { recursive: true, force: true })
}

section('[J] frontmatter 解析 / 回写 —— 正文逐字保留（src/editor/frontmatter.ts）')
// gray-matter 在 ESM 产物里做动态 require('fs') 会炸 → 外置回 Node 原生加载
const grayStub = [
  "import { createRequire } from 'node:module'",
  "const require = createRequire(" + JSON.stringify(resolve(root, 'package.json')) + ")",
  "export default require('gray-matter')"
].join('\n')
const { url: fmUrl, dir: fmDir } = await bundle('src/markdown/frontmatter.ts', 'frontmatter.mjs', {
  'gray-matter': grayStub
})
try {
  const FM = await import(fmUrl)
  const doc = '---\ntitle: 甲\nmoc: true\ncustom: 保留我\n---\n\n# 标题\n\n正文第一段。\n'
  const p = FM.parseFrontmatter(doc)
  check('解析出已知字段 + 未知字段透传', p.data.title === '甲' && p.data.moc === true && p.data.custom === '保留我', JSON.stringify(p.data))
  check('hasFrontmatter=true', p.hasFrontmatter === true)
  check('正文逐字保留', p.content === '\n# 标题\n\n正文第一段。\n', JSON.stringify(p.content))

  const plain = '# 无属性\n\n正文。\n'
  const pp = FM.parseFrontmatter(plain)
  check('无 frontmatter：data 空 + hasFrontmatter=false', Object.keys(pp.data).length === 0 && pp.hasFrontmatter === false)
  check('无 frontmatter：正文原样返回', pp.content === plain, JSON.stringify(pp.content))

  const rt = FM.serializeFrontmatter(p.data, p.content)
  check('parse→serialize 往返逐字节等于原文', rt === doc, JSON.stringify(rt))
  check('往返后正文仍逐字一致', FM.parseFrontmatter(rt).content === p.content)

  const cleaned = FM.serializeFrontmatter({ title: '', moc: true, tags: [] }, '# 正文\n')
  check('空值字段被剔除（title/tags 去掉、moc 保留）', !cleaned.includes('title') && !cleaned.includes('tags') && cleaned.includes('moc: true'), JSON.stringify(cleaned))

  const empty = FM.serializeFrontmatter({}, '\n\n# 正文\n')
  check('全空 → 去掉 frontmatter 块并归一化前导换行', empty === '\n# 正文\n', JSON.stringify(empty))

  const crlf = FM.serializeFrontmatter({ title: 'x' }, '第一行\r\n第二行\r\n')
  check('CRLF 正文保真', crlf.includes('第一行\r\n第二行\r\n'))
} finally {
  rmSync(fmDir, { recursive: true, force: true })
}

/* ═══════════════════════════════════════════════════════════════════════ */

section('[K] 标签页路径重映射 —— 文件夹移动按前缀整体改写（src/store/tabs.ts）')
// pinia / vue 是纯 JS 依赖 → 外置回 Node 原生加载，保证探针与 store 共用同一 pinia 实例
const piniaStub = [
  "import { createRequire } from 'node:module'",
  "const require = createRequire(" + JSON.stringify(resolve(root, 'package.json')) + ")",
  "const m = require('pinia')",
  "export const defineStore = m.defineStore"
].join('\n')
const vueStub = [
  "import { createRequire } from 'node:module'",
  "const require = createRequire(" + JSON.stringify(resolve(root, 'package.json')) + ")",
  "const m = require('vue')",
  "export const ref = m.ref",
  "export const computed = m.computed"
].join('\n')
const { url: tabsUrl, dir: tabsDir } = await bundle('src/store/tabs.ts', 'tabs.mjs', {
  pinia: piniaStub,
  vue: vueStub
})
try {
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useTabsStore } = await import(tabsUrl)
  const tabs = useTabsStore()
  tabs.open('C:/v/A.md')
  tabs.open('C:/v/dir/B.md')
  tabs.open('C:/v/dir/sub/C.md')
  tabs.open('C:/v/other.md')
  tabs.activate('C:/v/dir/sub/C.md')

  const r = tabs.remap('C:/v/dir', 'C:/v/moved')
  check('文件夹移动：前缀命中的嵌套标签全部改写', tabs.paths.join('|') === 'C:/v/A.md|C:/v/moved/B.md|C:/v/moved/sub/C.md|C:/v/other.md', tabs.paths.join('|'))
  check('文件夹移动：激活标签同步改写', tabs.activePath === 'C:/v/moved/sub/C.md' && r.activeChanged === true, String(tabs.activePath))
  check('affected 覆盖两条嵌套改写', r.affected.length === 2 && r.affected[0][1] === 'C:/v/moved/B.md' && r.affected[1][1] === 'C:/v/moved/sub/C.md', JSON.stringify(r.affected))
  check('未命中标签不受影响', tabs.has('C:/v/other.md') && tabs.has('C:/v/A.md'))

  const r2 = tabs.remap('C:/v/A.md', 'C:/v/z.md')
  check('单文件精确改写', tabs.has('C:/v/z.md') && !tabs.has('C:/v/A.md') && r2.affected.length === 1, tabs.paths.join('|'))
  check('非激活单文件改写不改变 activeChanged', r2.activeChanged === false)

  const rb = tabs.remap('C:/v/nope', 'C:/v/x')
  check('未命中任何标签 → no-op', rb.affected.length === 0 && rb.activeChanged === false)
} finally {
  rmSync(tabsDir, { recursive: true, force: true })
}


/* ═══════════════════════════════════════════════════════════════════════ */

section('[L] 关系图谱派生 —— buildGraph 由索引派生节点 / 边（electron/main/vaultIndex.ts）')
const { buildGraph } = await import(url)

  /** 由「路径 → 出链」简表构造索引（出链已是解析后的绝对路径，与真实索引一致） */
  const mkIdx = (spec) => {
    const files = {}
    for (const [p, outLinks] of Object.entries(spec)) {
      files[p] = {
        mtime: 1,
        title: p.replace(/^.*[\\/]/, '').replace(/\.(md|markdown)$/i, ''),
        headings: [],
        outLinks,
        tags: [],
        moc: false,
      }
    }
    return { version: 2, files, backLinks: {} }
  }
  const pathsOf = (g) => g.nodes.map((n) => n.path).slice().sort()
  const depthOf = (g, p) => g.nodes.find((n) => n.path === p)?.depth

  // A→B、A→C、B→C、C→D；F→A（反链方向，须被 BFS 纳入）；E 孤立
  const IDX = mkIdx({
    '/v/A.md': ['/v/B.md', '/v/C.md'],
    '/v/B.md': ['/v/C.md'],
    '/v/C.md': ['/v/D.md'],
    '/v/D.md': [],
    '/v/E.md': [],
    '/v/F.md': ['/v/A.md'],
  })

  const all = buildGraph(IDX)
  check('全局：total / shown 等于全库文件数且不截断', all.total === 6 && all.shown === 6 && all.truncated === false, JSON.stringify({ t: all.total, s: all.shown }))
  check('全局：边去重后为 5 条（A→B A→C B→C C→D F→A）', all.edges.length === 5, String(all.edges.length))
  check('全局：孤立节点不产生边', !all.edges.some((e) => e.source === '/v/E.md' || e.target === '/v/E.md'))

  const h1 = buildGraph(IDX, { center: '/v/A.md', maxHops: 1 })
  check('本地 1 跳：出链与反链邻居都纳入（A B C F），排除更远与孤立', pathsOf(h1).join(',') === '/v/A.md,/v/B.md,/v/C.md,/v/F.md', pathsOf(h1).join(','))
  check('本地 1 跳：中心 depth=0 且 center=true，其余邻居 depth=1', depthOf(h1, '/v/A.md') === 0 && h1.nodes.find((n) => n.path === '/v/A.md').center === true && h1.nodes.filter((n) => n.depth === 1).length === 3, JSON.stringify(h1.nodes.map((n) => [n.path, n.depth, n.center])))
  check('本地 1 跳：shown < total 时 truncated=true', h1.shown === 4 && h1.total === 6 && h1.truncated === true, JSON.stringify({ s: h1.shown, t: h1.total }))
  check('本地 1 跳：只保留两端都在子图内的边（4 条）', h1.edges.length === 4, String(h1.edges.length))

  const h2 = buildGraph(IDX, { center: '/v/A.md', maxHops: 2 })
  check('本地 2 跳：沿 C 再扩到 D（depth=2）', pathsOf(h2).includes('/v/D.md') && depthOf(h2, '/v/D.md') === 2, pathsOf(h2).join(','))
  check('本地 2 跳：孤立节点 E 永远进不来', !pathsOf(h2).includes('/v/E.md'))

  const miss = buildGraph(IDX, { center: '/v/NOPE.md', maxHops: 2 })
  check('center 不在库内 → 退化为全局视图', miss.shown === 6 && miss.nodes.every((n) => !n.center), String(miss.shown))

  const emptyGraph = buildGraph({ version: 2, files: {}, backLinks: {} })
  check('空索引 → 空图', emptyGraph.total === 0 && emptyGraph.shown === 0 && emptyGraph.nodes.length === 0 && emptyGraph.edges.length === 0 && emptyGraph.truncated === false)
  // 互链：A→B 与 B→A 是同一条线的两个方向，去重后只能画一次
  const MUTUAL = mkIdx({
    '/v/A.md': ['/v/B.md'],
    '/v/B.md': ['/v/A.md'],
  })
  const mu = buildGraph(MUTUAL)
  check('互链：A→B 与 B→A 去重后只有 1 条边', mu.edges.length === 1, String(mu.edges.length))

  // 400 节点：N0 连其余全部（度 399）→ 超限时按「度降序」确定性截断到 300
  const big = {}
  for (let i = 0; i < 400; i++) big['/v/N' + i + '.md'] = []
  const bigAll = Object.keys(big)
  big['/v/N0.md'] = bigAll.filter((p) => p !== '/v/N0.md')
  big['/v/N1.md'] = bigAll.slice(2, 52)
  const BIG = mkIdx(big)
  const gb = buildGraph(BIG)
  check('超限：截断到 300 且 truncated=true', gb.shown === 300 && gb.truncated === true, JSON.stringify({ s: gb.shown, t: gb.total }))
  check('超限：按度降序保留最连通的核心（N0 / N1 必在）', pathsOf(gb).includes('/v/N0.md') && pathsOf(gb).includes('/v/N1.md'))
  const shownSet = new Set(pathsOf(gb))
  check('超限：边两端恒在展示集合内', gb.edges.every((e) => shownSet.has(e.source) && shownSet.has(e.target)))
  const gb2 = buildGraph(BIG)
  check('超限：采样确定性（两次结果完全一致）', pathsOf(gb).join(',') === pathsOf(gb2).join(','))


/* ── M. 命令面板内核：模糊匹配 + 命令目录（src/utils/fuzzy.ts, src/utils/commands.ts） ── */
section('[M] command palette core -- fuzzy match + command catalog (src/utils/fuzzy.ts, src/utils/commands.ts)')
const { fuzzyMatch, fuzzyRank, highlightSegments } = await import((await bundle('src/utils/fuzzy.ts', 'fuzzy.mjs')).url)
const { COMMANDS, GROUP_ORDER, groupCommands } = await import((await bundle('src/utils/commands.ts', 'commands.mjs')).url)

// 模糊匹配：空查询恒为 0 分、无高亮
check('fuzzy empty query -> score 0, no highlight', (() => { const r = fuzzyMatch('', 'arbitrary'); return r.score === 0 && r.positions.length === 0 })())

// 模糊匹配：非子序列返回 null（跳着取不到）
check('fuzzy non-subsequence -> null', fuzzyMatch('xyz', 'abc') === null)

// 模糊匹配：子序列命中且下标正确（o p n 在 open 上，跳过 e）
check('fuzzy subsequence -> positions correct', (() => { const r = fuzzyMatch('opn', 'open'); return r && r.positions.join(',') === '0,1,3' })())

// 模糊匹配：前缀命中优于中间命中
check('fuzzy prefix beats mid-match', (() => { const a = fuzzyMatch('op', 'open'); const b = fuzzyMatch('op', 'copy'); return !!a && !!b && a.score > b.score })())

// 模糊匹配：连续命中优于分散命中
check('fuzzy consecutive beats scattered', (() => { const a = fuzzyMatch('abc', 'abc'); const b = fuzzyMatch('abc', 'a1b1c'); return !!a && !!b && a.score > b.score })())

// 模糊匹配：大小写不敏感
check('fuzzy case-insensitive', (() => { const r = fuzzyMatch('OPEN', 'open'); return r && r.positions.join(',') === '0,1,2,3' })())

// 高亮分段：命中/未命中正确切分
check('highlightSegments splits hit runs', (() => {
  const segs = highlightSegments('open', [0, 1])
  return segs.length === 2 && segs[0].hit === true && segs[0].text === 'op' && segs[1].hit === false && segs[1].text === 'en'
})())

// 模糊排序：最佳匹配排第一
check('fuzzyRank best match first', (() => {
  const ranked = fuzzyRank('op', ['copy', 'open', 'scope'], (x) => x)
  return ranked.length === 3 && ranked[0].item === 'open'
})())

// 模糊排序：空查询保持原始顺序并截断
check('fuzzyRank empty query keeps order + limits', (() => {
  const ranked = fuzzyRank('', ['a', 'b', 'c', 'd'], (x) => x, 2)
  return ranked.length === 2 && ranked[0].item === 'a' && ranked[1].item === 'b'
})())

// 模糊排序：结果数量上限（5000 文件不至于全量）
check('fuzzyRank respects limit', fuzzyRank('x', ['x1', 'x2', 'x3', 'x4', 'x5'], (x) => x, 3).length === 3)

// 命令目录：id 全不重复
check('commands ids unique', (() => { const s = new Set(COMMANDS.map((c) => c.id)); return s.size === COMMANDS.length })())

// 命令目录：覆盖 6 个分组且顺序固定
check('commands 6 groups in fixed order', GROUP_ORDER.join(',') === 'file,view,knowledge,tool,export,settings' && groupCommands().map((b) => b.group).join(',') === GROUP_ORDER.join(','))

// 命令目录：每条都属已知分组
check('commands every entry has known group', COMMANDS.every((c) => GROUP_ORDER.includes(c.group)))

/* ── N. 中文排版状态（src/typography.ts） ── */
section('[N] CJK typography state -- defaults / normalize / persistence (src/typography.ts)')
const Typo = await import((await bundle('src/typography.ts', 'typography.mjs')).url)
const { normalizeTypography, DEFAULT_TYPOGRAPHY, loadTypography, saveTypography, setTypographyStorage } = Typo

// 默认：五个开关全开
check('typography defaults all on (5 keys)', Object.keys(DEFAULT_TYPOGRAPHY).length === 5 && Object.values(DEFAULT_TYPOGRAPHY).every((v) => v === true))

// normalize：合法布尔原样保留
check('normalize keeps valid booleans', (() => {
  const s = normalizeTypography({ enabled: false, space: true, emphasis: false, punct: false, paraGap: true })
  return s.enabled === false && s.space === true && s.emphasis === false && s.punct === false && s.paraGap === true
})())

// normalize：非布尔值一律回落默认（不信任外部存储）
check('normalize coerces non-boolean to default', (() => {
  const s = normalizeTypography({ enabled: 'yes', space: 1, emphasis: null })
  return s.enabled === true && s.space === true && s.emphasis === true
})())

// normalize：垃圾输入 → 全默认，且不缺键
check('normalize garbage -> full defaults', (() => {
  const d = JSON.stringify(DEFAULT_TYPOGRAPHY)
  return JSON.stringify(normalizeTypography(null)) === d
    && JSON.stringify(normalizeTypography('nope')) === d
    && JSON.stringify(normalizeTypography(42)) === d
})())

// 持久化往返：注入假存储，保存后读回一致
check('typography persists & reloads (injected storage)', (() => {
  const mem = new Map()
  setTypographyStorage({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) })
  const next = { enabled: true, space: false, emphasis: true, punct: false, paraGap: true }
  saveTypography(next)
  const back = loadTypography()
  setTypographyStorage(null)
  return JSON.stringify(back) === JSON.stringify(next)
})())

// 损坏的存储值 → 回落默认，绝不抛
check('typography corrupt storage -> defaults', (() => {
  setTypographyStorage({ getItem: () => '{not json', setItem: () => {} })
  const v = loadTypography()
  setTypographyStorage(null)
  return JSON.stringify(v) === JSON.stringify(DEFAULT_TYPOGRAPHY)
})())

/* ── O. 大文档分块渲染（src/editor/hugeDoc.ts） ── */
section('[O] huge doc chunked rendering -- threshold / class toggle (src/editor/hugeDoc.ts)')
const H = await import((await bundle('src/editor/hugeDoc.ts', 'hugeDoc.mjs', {
  '@milkdown/kit/prose/state':
    'export class Plugin { constructor(spec) { this.spec = spec } }\nexport class PluginKey { constructor(name) { this.name = name } }\n',
})).url)

// 常量契约：阈值与类名（CSS 依赖该精确值）
check('hugeDoc threshold = 20000', H.HUGE_DOC_THRESHOLD === 20000)
check('hugeDoc class name = yj-huge-doc', H.HUGE_DOC_CLASS === 'yj-huge-doc')

// 纯函数：严格大于阈值才算大文档（边界不掉进/不掉出）
check('isHugeDoc strict-greater boundary', (() => {
  return H.isHugeDoc(0) === false
    && H.isHugeDoc(20000) === false
    && H.isHugeDoc(20001) === true
})())

// 纯函数：自定义阈值
check('isHugeDoc honors custom threshold', H.isHugeDoc(100, 100) === false && H.isHugeDoc(101, 100) === true)

// 插件行为：构造时按当前文档定态，尺寸跨阈时增删类（仿 view + classList）
check('createHugeDocPlugin toggles class across threshold', (() => {
  const spec = H.createHugeDocPlugin().spec
  const classes = new Set()
  const dom = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } }
  const view = { dom, state: { doc: { content: { size: 500 } } } }
  const handle = spec.view(view)
  const bootSmall = !classes.has('yj-huge-doc')        // 小文档：不挂类
  view.state.doc.content.size = 30000
  handle.update(view)
  const grewBig = classes.has('yj-huge-doc')           // 变超大：挂类
  view.state.doc.content.size = 100
  handle.update(view)
  const shrankSmall = !classes.has('yj-huge-doc')      // 再变小：摘类
  return bootSmall && grewBig && shrankSmall
})())

// 插件行为：尺寸未跨阈时不重复 toggle（避免每次事务无谓写 classList）
check('createHugeDocPlugin no redundant toggle', (() => {
  const spec = H.createHugeDocPlugin().spec
  let toggles = 0
  const dom = { classList: { toggle: () => { toggles++ } } }
  const view = { dom, state: { doc: { content: { size: 30000 } } } }
  const handle = spec.view(view)
  const afterInit = toggles
  handle.update(view)                                   // 同尺寸：应短路
  return afterInit === 1 && toggles === 1
})())

/* ── P. 阅读进度判定（src/utils/progress.ts） ── */
section('[P] reading progress -- user scroll vs layout reflow (src/utils/progress.ts)')
const P = await import((await bundle('src/utils/progress.ts', 'progress.mjs')).url)

// 百分比：0 / 中段 / 满 的正确换算
check('progressPercent basic mapping', P.progressPercent(0, 100) === 0 && P.progressPercent(50, 100) === 50 && P.progressPercent(100, 100) === 100)

// 越界夹紧 + 不可滚动归零
check('progressPercent clamps out-of-range & zero max', (() => {
  return P.progressPercent(-30, 100) === 0
    && P.progressPercent(180, 100) === 100
    && P.progressPercent(50, 0) === 0
    && P.progressPercent(50, -10) === 0
})())

// 核心场景：开关侧栏/大纲致内容重排（高度变、位置没变）→ 不改刻度，进度条不莫名跳动
check('reflow (height changed, scrollTop kept) does not move progress', P.acceptProgress({
  top: 500, max: 2400, lastTop: 500, lastMax: 2000, prev: 25,
}) === false)

// 用户真滚动（位置变了）→ 采纳
check('real scroll (position changed) is accepted', P.acceptProgress({
  top: 600, max: 2000, lastTop: 500, lastMax: 2000, prev: 25,
}) === true)

// force（换文档 / 拖拽跳转等显式意图）→ 无视回流抑制
check('force overrides reflow suppression', P.acceptProgress({
  top: 500, max: 2400, lastTop: 500, lastMax: 2000, prev: 25, force: true,
}) === true)

// 死区：真实滚动中的亚像素抖动不重绘
check('sub-pixel jitter within dead zone is ignored', P.acceptProgress({
  top: 1001, max: 1000000, lastTop: 1000, lastMax: 1000000, prev: 0.1,
}) === false)

// 两端永远精确：滚到底必须显示 100%，回到顶必须显示 0%
check('progress always lands exactly on 0% and 100%', (() => {
  const atBottom = P.acceptProgress({ top: 1000000, max: 1000000, lastTop: 999000, lastMax: 1000000, prev: 99.95 })
  const atTop = P.acceptProgress({ top: 0, max: 1000000, lastTop: 5000, lastMax: 1000000, prev: 0.4 })
  return atBottom === true && atTop === true
})())

// 内容不足一屏（max <= 1）→ 采纳（调用方据此回落 0 并隐藏进度条）
check('non-scrollable (max <= 1) is accepted', P.acceptProgress({ top: 0, max: 0, lastTop: 0, lastMax: 0, prev: 40 }) === true)

/* ── Q. 中文分词 / 双击选词（src/utils/cjk-segment.ts + src/editor/wordSelect.ts） ── */
section('[Q] CJK word segmentation -- double-click selection (src/utils/cjk-segment.ts)')
const Seg = await import((await bundle('src/utils/cjk-segment.ts', 'cjk-segment.mjs')).url)

// CJK 判定：汉字 / 假名 / 谚文 / 全角标点 归中文，西文一律交回编辑器默认
check('isCjkChar: CJK scripts and fullwidth punct', (() => {
  return Seg.isCjkChar('中') === true
    && Seg.isCjkChar('あ') === true           // 日文假名
    && Seg.isCjkChar('한') === true           // 韩文谚文
    && Seg.isCjkChar('，') === true           // 全角逗号
    && Seg.isCjkChar('　') === true           // 全角空格
})())

// CJK 判定：拉丁 / 数字 / 半角标点 / 空串 不接管
check('isCjkChar: latin, digits and halfwidth are not CJK', (() => {
  return Seg.isCjkChar('a') === false
    && Seg.isCjkChar('7') === false
    && Seg.isCjkChar(' ') === false
    && Seg.isCjkChar('.') === false
    && Seg.isCjkChar('') === false
})())

// 空文本 / 不支持的环境：返回空数组而不是抛错
check('segmentWords: empty input returns empty', Seg.segmentWords('').length === 0 && Seg.segmentWords('   ').length >= 0)

// 西文整词必须能切出来（这部分 ICU 表现稳定，可硬断言）
check('segmentWords: latin word kept whole', (() => {
  const ws = Seg.segmentWords('open Markdown now')
  return ws.some((w) => w.text === 'open') && ws.some((w) => w.text === 'Markdown') && ws.some((w) => w.text === 'now')
})())

// 不变量：区间有效、内容与切片一致、按序不重叠（中文切分结果不硬断言——ICU 升级会微调词典）
check('segmentWords invariants: valid, consistent, ordered', (() => {
  const text = '玉笺是一款跨平台开源Markdown编辑器，支持2026年的中文排版。'
  const ws = Seg.segmentWords(text)
  if (ws.length === 0) return false
  let last = -1
  for (const w of ws) {
    if (!(w.start >= 0 && w.end <= text.length && w.start < w.end)) return false
    if (w.text !== text.slice(w.start, w.end)) return false
    if (w.start < last) return false
    last = w.end
  }
  return true
})())

// 核心痛点：中文长句里取词**绝不能是整段**（这正是原生双击的行为）
check('wordRangeAt on Chinese never selects the whole run', (() => {
  const text = '中文排版需要考虑标点挤压和避头尾规则'
  for (let off = 0; off < text.length; off++) {
    const w = Seg.wordRangeAt(text, off)
    if (w && w.end - w.start >= text.length) return false // 整段 = 未解决
  }
  return true
})())

// 定位不变量：返回非 null 时，偏移必落在区间内，且区间内容与切片一致
check('wordRangeAt: offset inside range and slice matches', (() => {
  const text = '研究人工智能在自然语言处理中的应用'
  for (let off = 0; off < text.length; off++) {
    const w = Seg.wordRangeAt(text, off)
    if (w === null) continue
    if (!(off >= w.start && off < w.end)) return false
    if (w.text !== text.slice(w.start, w.end)) return false
  }
  return true
})())

// 越界与空白：返回 null（调用方据此回退默认 / 选中单个字符）
check('wordRangeAt: out-of-range and spaces return null', (() => {
  if (Seg.wordRangeAt('abc', -1) !== null) return false
  if (Seg.wordRangeAt('abc', 3) !== null) return false
  if (Seg.wordRangeAt('', 0) !== null) return false
  return Seg.wordRangeAt(' ', 0) === null
})())

// 保守双字回退：ICU 把未登录双字词切成两个单字时（「开源」→「开」+「源」），应合并回双字
check('segmentWords: lone Han fallback yields a two-char word', (() => {
  const ws = Seg.segmentWords('开源')
  return ws.some((w) => w.text === '开源' && w.end - w.start === 2)
})())

// 双字回退必须**保守**：相邻段不是单字汉字时绝不跨过去合并（否则「我」+「喜欢」→「我喜」）
check('segmentWords: fallback never crosses a longer word', (() => {
  const ws = Seg.segmentWords('我喜欢')
  if (ws.some((w) => w.text.startsWith('我喜'))) return false
  // 也不与标点粘连
  const ws2 = Seg.segmentWords('编辑器，中文')
  if (ws2.some((w) => /[，。、]/.test(w.text))) return false
  return true
})())

// 插件结构：确实接管了双击（非 CJK 时返回 false 的分支见源码注释）
const { createWordSelectPlugin } = await import((await bundle('src/editor/wordSelect.ts', 'wordSelect.mjs', {
  '@milkdown/kit/prose/state':
    'export class Plugin { constructor(spec) { this.spec = spec } }\nexport class PluginKey { constructor(name) { this.name = name } }\nexport class TextSelection { static create(d, a, b) { return { from: a, to: b } } }\n',
})).url)
check('createWordSelectPlugin handles double click', typeof createWordSelectPlugin().spec?.props?.handleDoubleClick === 'function')

/* ── R. 快捷键可配（src/utils/keymap.ts, src/shortcuts.ts） ── */
section('[R] custom shortcuts -- combo normalization / conflict / persistence (src/utils/keymap.ts, src/shortcuts.ts)')
const Km = await import((await bundle('src/utils/keymap.ts', 'keymap.mjs')).url)
const Sc = await import((await bundle('src/shortcuts.ts', 'shortcuts.mjs')).url)
const { normalizeCombo, parseCombo, isBindable, eventToCombo, eventMatches, normalizeKey, formatCombo } = Km

// 假存储：状态隔离，测完不影响真实 localStorage
function makeStore() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  }
}
const store = makeStore()
Sc.setShortcutsStorage(store)

// 规范化：修饰键顺序 / 大小写 / Cmd 与 Ctrl 归一
check('normalizeCombo: order + case + Cmd==Ctrl', (() => {
  return normalizeCombo('shift+ctrl+p') === 'Ctrl+Shift+P'
    && normalizeCombo('CTRL+S') === 'Ctrl+S'
    && normalizeCombo('cmd+k') === 'Ctrl+K'
    && normalizeCombo(' alt + / ') === 'Alt+/'
})())

// 规范化：F 键与命名键
check('normalizeKey: F-keys and named keys', (() => {
  return normalizeKey('f1') === 'F1'
    && normalizeKey(' ') === 'Space'
    && normalizeKey('Escape') === 'Esc'
    && normalizeKey('/') === '/'
})())

// 非法输入一律 null：绝不让「半截键位」进存储
check('parseCombo rejects malformed input', (() => {
  return parseCombo('') === null
    && parseCombo('Ctrl+') === null          // 只有修饰键
    && parseCombo('Ctrl+Shift') === null     // 主键段是修饰键名
    && parseCombo('Ctrl+Foo+Bar') === null   // 未知修饰键
    && normalizeCombo('Ctrl++') === null
})())

// 可绑定性：光一个字母键不能当全局快捷键（否则打不出字）
check('isBindable: bare letter no, Ctrl/F-key yes', (() => {
  const a = parseCombo('A')
  const b = parseCombo('Ctrl+A')
  const f = parseCombo('F1')
  const s = parseCombo('Shift+A')
  return !!a && !!b && !!f && !!s
    && isBindable(a) === false
    && isBindable(b) === true
    && isBindable(f) === true
    && isBindable(s) === false
})())

// 事件 → 组合：只按修饰键不成键；meta 与 ctrl 同归一
check('eventToCombo: modifiers-only null, meta==ctrl', (() => {
  if (eventToCombo({ key: 'Shift', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }) !== null) return false
  const a = eventToCombo({ key: 'p', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false })
  const b = eventToCombo({ key: 'p', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })
  return a !== null && b !== null && formatCombo(a) === formatCombo(b) && formatCombo(a) === 'Ctrl+Shift+P'
})())

// 匹配：同一组合不同写法都命中；不同修饰不命中
check('eventMatches: matches equal combo only', (() => {
  const c = parseCombo('Ctrl+Shift+P')
  const yes = { key: 'P', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }
  const no = { key: 'P', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }
  return eventMatches(c, yes) === true && eventMatches(c, no) === false
})())

// 默认键位来自命令目录（单一事实来源），且**不与保留键位相撞**
check('default bindings come from command catalog and avoid reserved', (() => {
  const reserved = new Set(Sc.RESERVED.map((r) => r.combo))
  const vals = Object.values(Sc.DEFAULT_BINDINGS)
  if (vals.length === 0) return false
  if (vals.some((v) => reserved.has(v))) return false
  // 默认表里不应有两条命令抢同一个键
  return new Set(vals).size === vals.length
    && Sc.DEFAULT_BINDINGS['file.open'] === 'Ctrl+O'
    && Sc.DEFAULT_BINDINGS['view.search'] === 'Ctrl+F'
})())

// 默认 → 覆盖 → 读回：覆盖优先
check('setBinding overrides default', (() => {
  Sc.resetAllBindings()
  if (Sc.getBinding('view.stats') !== undefined) return false
  Sc.setBinding('view.stats', 'Ctrl+Shift+S')
  return Sc.getBinding('view.stats') === 'Ctrl+Shift+S' && Sc.isCustomized('view.stats') === true
})())

// 冲突：撞别人的键默认不生效，并报出占用者
check('setBinding refuses conflict and reports owner', (() => {
  Sc.resetAllBindings()
  Sc.setBinding('view.stats', 'Ctrl+Shift+S')
  const r = Sc.setBinding('tool.backup', 'Ctrl+Shift+S')
  if (r.ok !== false || r.conflict.kind !== 'command' || r.conflict.id !== 'view.stats') return false
  return Sc.getBinding('tool.backup') === undefined
})())

// 抢占：steal 后新主人拿到键，原主人被清空（不留两个主人）
check('setBinding steal moves the combo', (() => {
  const r = Sc.setBinding('tool.backup', 'Ctrl+Shift+S', { steal: true })
  return r.ok === true
    && Sc.getBinding('tool.backup') === 'Ctrl+Shift+S'
    && Sc.getBinding('view.stats') === undefined
})())

// 保留键位：即便 steal 也不能占（否则会锁死入口 / 破坏系统键）
check('reserved combos cannot be taken even with steal', (() => {
  const a = Sc.setBinding('view.stats', 'Ctrl+K', { steal: true })
  const b = Sc.setBinding('view.stats', 'Ctrl+Shift+P', { steal: true })
  const c = Sc.setBinding('view.stats', 'Ctrl+B', { steal: true })
  return a.ok === false && b.ok === false && c.ok === false
    && a.conflict.kind === 'reserved' && a.conflict.entry.reason === 'app'
    && c.conflict.entry.reason === 'editor'
})())

// 不可绑定的输入被拒（只按一个字母键）
check('setBinding rejects non-bindable combo', Sc.setBinding('view.stats', 'A').ok === false)

// 解绑：显式清空 ≠ 用默认值
check('unbind is distinct from default', (() => {
  Sc.resetAllBindings()
  Sc.setBinding('file.save', '')
  return Sc.getBinding('file.save') === undefined
    && Sc.isCustomized('file.save') === true
    && Sc.getBinding('file.open') === 'Ctrl+O'
})())

// 重置：单个与全部
check('resetBinding / resetAllBindings', (() => {
  Sc.resetBinding('file.save')
  if (Sc.getBinding('file.save') !== 'Ctrl+S' || Sc.isCustomized('file.save') !== false) return false
  Sc.setBinding('view.stats', 'Ctrl+Shift+S')
  Sc.resetAllBindings()
  return Sc.getBinding('view.stats') === undefined && Sc.hasAnyCustomization() === false
})())

// 派发表：只含已绑定键位，且覆盖后立刻生效
check('buildDispatchTable reflects overrides', (() => {
  Sc.resetAllBindings()
  const t1 = Sc.buildDispatchTable()
  if (t1.get('Ctrl+O') !== 'file.open' || t1.get('F1') !== 'settings.shortcuts') return false
  Sc.setBinding('file.open', 'Ctrl+Alt+O')
  const t2 = Sc.buildDispatchTable()
  Sc.resetAllBindings()
  return t2.get('Ctrl+O') === undefined && t2.get('Ctrl+Alt+O') === 'file.open'
})())

// 持久化：写入后重新加载，覆盖仍在
check('overrides persist across reload (injected storage)', (() => {
  Sc.resetAllBindings()
  Sc.setBinding('view.stats', 'Ctrl+Shift+S')
  const raw = store.getItem('yujian.shortcuts')
  if (!raw || !raw.includes('Ctrl+Shift+S')) return false
  // 换一个等价存储喂回去（模拟重启后重新读盘）
  const store2 = makeStore()
  store2.setItem('yujian.shortcuts', raw)
  Sc.setShortcutsStorage(store2)
  const ok = Sc.getBinding('view.stats') === 'Ctrl+Shift+S'
  Sc.resetAllBindings()
  Sc.setShortcutsStorage(store)
  return ok
})())

// 脏数据清洗：未知命令 / 非法键位 / 非字符串一律丢弃，不污染运行时
check('dirty stored data is dropped on load', (() => {
  const s = makeStore()
  s.setItem('yujian.shortcuts', JSON.stringify({
    'not.a.command': 'Ctrl+1',
    'view.stats': 'Ctrl++',
    'tool.backup': 42,
    'file.save': 'Ctrl+Alt+S',
  }))
  Sc.setShortcutsStorage(s)
  const ok = Sc.getBinding('file.save') === 'Ctrl+Alt+S'
    && Sc.getBinding('view.stats') === undefined
    && Sc.getBinding('tool.backup') === undefined
  Sc.setShortcutsStorage(store)
  Sc.resetAllBindings()
  return ok
})())

// 变更订阅：改键位会通知（命令面板 / App 靠它刷新）
check('onShortcutsChange notifies subscribers', (() => {
  let n = 0
  const off = Sc.onShortcutsChange(() => n++)
  Sc.setBinding('view.stats', 'Ctrl+Shift+S')
  off()
  Sc.setBinding('view.stats', '')
  Sc.resetAllBindings()
  return n === 1
})())

// ⚠️ 最危险的失效面：默认表里若混进一个「裸字母」键位，全局派发会在正文里被每一次按键命中，
// 既触发命令又 preventDefault，正文直接打不出字。故默认键位必须逐个满足 isBindable。
check('every default binding is bindable (no bare letters)', (() => {
  const ids = Object.keys(Sc.DEFAULT_BINDINGS)
  if (ids.length === 0) return false
  for (const id of ids) {
    const c = Km.parseCombo(Sc.DEFAULT_BINDINGS[id])
    if (!c || !Km.isBindable(c)) return false
  }
  return true
})())

// 派发表同理：它是 onKeydown 唯一的数据来源，里面必须只有可绑定的组合
check('dispatch table only contains bindable combos', (() => {
  Sc.resetAllBindings()
  const table = Sc.buildDispatchTable()
  if (table.size === 0) return false
  for (const combo of table.keys()) {
    const c = Km.parseCombo(combo)
    if (!c || !Km.isBindable(c)) return false
  }
  return true
})())

// 存储可被手改：塞一个「可解析但不可绑定」的裸字母进去，必须被丢弃——
// 否则它会进派发表，于是正文里按 a 就触发命令（还 preventDefault，字都打不出来）
check('stored non-bindable override (bare letter) is dropped on load', (() => {
  const s = makeStore()
  s.setItem('yujian.shortcuts', JSON.stringify({ 'view.stats': 'A' }))
  Sc.setShortcutsStorage(s)
  const got = Sc.getBinding('view.stats')
  const table = Sc.buildDispatchTable()
  Sc.setShortcutsStorage(store)
  Sc.resetAllBindings()
  return got === undefined && table.has('A') === false
})())

section('[S] search regex -- Chinese whole-word matching (src/utils/regex.ts)')
const Rx = await import((await bundle('electron/shared/regex.ts', 'regex.mjs')).url)
const { buildRegex } = Rx

// 中文全词匹配（wholeWord）不开：子串命中（与旧 \b 行为一致，纯拉丁也如此）
check('CJK substring match when wholeWord off', (() => {
  const re = buildRegex('开', false, false)
  return '开源'.search(re) !== -1 && '开心'.search(re) !== -1
})())

// 中文全词匹配开：不命中「开源」——开被源夹住，二者都是词字符，Unicode 词边界不成立
// （这是旧 \b 实现的失效点：\b 只认 ASCII 词，把 源 当非词，于是「开」两侧都被当成边界 → 误命中）
check('CJK wholeWord does NOT match inside 开源', (() => {
  const re = buildRegex('开', false, true)
  return '开源'.search(re) === -1
})())

// 中文全词匹配开：不命中「开会」（两词字符相连，无边界）
check('CJK wholeWord does NOT match inside 开会', (() => {
  const re = buildRegex('开', false, true)
  return '开会'.search(re) === -1
})())

// 中文全词匹配开：被非词字符（句号 / 空格 / 行首行尾）包围时命中
check('CJK wholeWord matches when surrounded by non-word chars', (() => {
  const re = buildRegex('开', false, true)
  return '开。'.search(re) !== -1      // 开 + 句号
    && '我 开 会'.search(re) !== -1   // 开 + 空格
    && '开'.search(re) !== -1         // 单独成词（行首行尾）
})())

// 拉丁全词匹配保持既有语义：cat 命中 cat，不命中 category
check('Latin wholeWord matches cat but not category', (() => {
  const re = buildRegex('cat', false, true)
  return 'cat'.search(re) !== -1 && 'category'.search(re) === -1
})())

// 中英混合词边界：code 命中 "my code."，不命中 decode / codex（相邻词字符无边界）
check('Mixed boundary: code vs decode/codex', (() => {
  const re = buildRegex('code', false, true)
  return 'my code.'.search(re) !== -1
    && 'decode'.search(re) === -1
    && 'codex'.search(re) === -1
})())

// 大小写不敏感（默认）
check('case-insensitive by default', (() => {
  const re = buildRegex('Cat', false, true)
  return 'CAT'.search(re) !== -1 && 'scat'.search(re) === -1
})())

// wholeWord 正则必须带 u 标志，否则 \p{L} 语法解析失败 → 中文边界完全不生效
check('wholeWord regex carries the u flag', (() => {
  const re = buildRegex('开', false, true)
  return re.flags.includes('u')
})())

// regex 模式：\d+ 命中数字串（flags 含 g 供装饰层逐次 exec）
check('regex mode: \\d+ matches digits', (() => {
  const re = buildRegex('\\d+', false, false, true)
  const m = 'abc123'.match(re)
  return !!m && m[0] === '123' && re.flags.includes('g')
})())

section('[T] export meta -- frontmatter 取值与回退 (src/export/exportMeta.ts)')
// 复用 [J] 段的 grayStub：gray-matter 在 ESM 产物里做动态 require('fs') 会炸
const Em = await import(
  (await bundle('src/export/exportMeta.ts', 'exportMeta.mjs', { 'gray-matter': grayStub })).url
)
const { pickExportMeta } = Em

// 有 frontmatter 时优先取它
check('picks title/author/date from frontmatter', (() => {
  const md = '---\ntitle: 季度小结\nauthor: 张三\ndate: 2026-09-14\n---\n\n正文'
  const m = pickExportMeta(md, 'fallback')
  return m.title === '季度小结' && m.author === '张三' && m.date === '2026-09-14'
})())

// 无 frontmatter / 缺字段 → 标题回退文档名，作者日期留空
check('title falls back to base, author/date omitted', (() => {
  const m = pickExportMeta('# 只有正文\n', '我的文档')
  return m.title === '我的文档' && m.author === undefined && m.date === undefined
})())

// 键的优先级与别名：author 缺失取 authors，date 缺失依次取 updated / created
check('alias keys: authors, updated/created', (() => {
  const a = pickExportMeta('---\nauthors: 李四\n---\n', 'x')
  const b = pickExportMeta('---\nupdated: 2026-01-02\n---\n', 'x')
  const c = pickExportMeta('---\ncreated: 2026-03-04\n---\n', 'x')
  return a.author === '李四' && b.date === '2026-01-02' && c.date === '2026-03-04'
})())

// 显式 title 优先于别名顺序：title 存在时不该被 base 覆盖
check('explicit title wins over base', (() => {
  return pickExportMeta('---\ntitle: 真标题\n---\n', '基名').title === '真标题'
})())

// 空串 / 纯空白视为「没有」，不能把空白当值交出去
check('blank values are treated as absent', (() => {
  const m = pickExportMeta('---\ntitle: "   "\nauthor: ""\n---\n', '基名')
  return m.title === '基名' && m.author === undefined
})())

// YAML 会把日期解析成 Date 对象：必须归一成 YYYY-MM-DD，不能吐出 ISO 时间戳
check('Date object normalizes to YYYY-MM-DD', (() => {
  const m = pickExportMeta('---\ndate: 2026-05-06\n---\n', 'x')
  return m.date === '2026-05-06' && !String(m.date).includes('T')
})())

// 空文档也不能抛
check('empty markdown does not throw', (() => {
  const m = pickExportMeta('', '空')
  return m.title === '空'
})())

section('[U] palette hotkey -- 命令面板/快速打开热键判定 (src/utils/paletteHotkey.ts)')
const Ph = await import((await bundle('src/utils/paletteHotkey.ts', 'paletteHotkey.mjs')).url)
const { resolvePaletteHotkey } = Ph

const key = (k, o = {}) => ({ key: k, ctrlKey: true, metaKey: false, shiftKey: false, ...o })

// 未开时：Ctrl+Shift+P 开命令面板、Ctrl+K 开快速打开
check('opens commands on Ctrl+Shift+P, files on Ctrl+K', (() => {
  return resolvePaletteHotkey(key('p', { shiftKey: true }), null) === 'commands'
    && resolvePaletteHotkey(key('k'), null) === 'files'
})())

// 已开时再按**同一个键**= 关闭
check('same key toggles closed', (() => {
  return resolvePaletteHotkey(key('p', { shiftKey: true }), 'commands') === null
    && resolvePaletteHotkey(key('k'), 'files') === null
})())

// 已开时按**另一个键**= 切换过去（不是一律关闭）
// ⚠️ 这正是原先的实现缺陷：旧代码写成「已开时按任一键都关闭」，
// 于是命令面板开着时按 Ctrl+K 会整个关掉，而非切到快速打开。
check('other key switches mode instead of closing', (() => {
  return resolvePaletteHotkey(key('k'), 'commands') === 'files'
    && resolvePaletteHotkey(key('p', { shiftKey: true }), 'files') === 'commands'
})())

// 不归我管的键一律放行（undefined），否则会吞掉正常按键
check('unrelated keys are not intercepted', (() => {
  return resolvePaletteHotkey(key('s'), null) === undefined
    && resolvePaletteHotkey(key('p'), null) === undefined      // Ctrl+P 不带 Shift
    && resolvePaletteHotkey(key('k', { shiftKey: true }), null) === undefined // Ctrl+Shift+K
    && resolvePaletteHotkey({ key: 'k', ctrlKey: false, metaKey: false, shiftKey: false }, null) === undefined
})())

// Cmd(mac) 与 Ctrl 等价；大小写不敏感（CapsLock / Shift 状态下 key 可能是 'P'）
check('meta==ctrl and case-insensitive', (() => {
  return resolvePaletteHotkey({ key: 'P', ctrlKey: false, metaKey: true, shiftKey: true }, null) === 'commands'
    && resolvePaletteHotkey({ key: 'K', ctrlKey: false, metaKey: true, shiftKey: false }, null) === 'files'
})())

/* ── [U] 搜索结果导航（src/utils/searchNav.ts）─────────────────────
   从 Sidebar.vue 抽出的纯逻辑：命中序号回绕与「替换后当前行重推导」。
   前者决定 Ctrl+G / 上一处的循环行为，后者关系到替换后高亮是否残留过期行号。 */
section('[U] search nav -- 命中导航与当前行重推导 (src/utils/searchNav.ts)')

const SN = await import((await bundle('src/utils/searchNav.ts', 'searchNav.mjs')).url)
const { wrapIndex, nextIndex, prevIndex, pickCurrentLine } = SN

check('wrapIndex wraps negatives and overflow', (() => {
  return wrapIndex(0, 3) === 0
    && wrapIndex(2, 3) === 2
    && wrapIndex(3, 3) === 0
    && wrapIndex(-1, 3) === 2
    && wrapIndex(-4, 3) === 2
})())

check('wrapIndex on empty list is 0, never negative', (() => {
  return wrapIndex(0, 0) === 0 && wrapIndex(-1, 0) === 0
})())

check('nextIndex starts at 0 when nothing selected', (() => {
  return nextIndex(-1, 5) === 0 && nextIndex(0, 5) === 1 && nextIndex(4, 5) === 0
})())

// 未选中时按「上一处」应落到末尾，符合向上查找的直觉（而非跳到开头）
check('prevIndex starts at last when nothing selected', (() => {
  return prevIndex(-1, 5) === 4 && prevIndex(0, 5) === 4 && prevIndex(3, 5) === 2
})())

check('next/prevIndex on empty list is -1 (no navigation)', (() => {
  return nextIndex(-1, 0) === -1 && prevIndex(2, 0) === -1
})())

// 替换后行号会整体偏移，必须重新取一个仍然有效的命中，而不是沿用旧行号
check('pickCurrentLine prefers active doc first hit', (() => {
  const results = [
    { path: '/v/a.md', hits: [{ line: 3 }, { line: 9 }] },
    { path: '/v/b.md', hits: [{ line: 7 }] },
  ]
  return pickCurrentLine(results, '/v/b.md') === 7 && pickCurrentLine(results, '/v/a.md') === 3
})())

check('pickCurrentLine falls back to first file, then undefined', (() => {
  const results = [{ path: '/v/a.md', hits: [{ line: 4 }] }]
  return pickCurrentLine(results, '/v/other.md') === 4          // 活动文档不在结果里
    && pickCurrentLine(results, null) === 4                      // 无活动文档
    && pickCurrentLine([], '/v/a.md') === undefined              // 无结果
    && pickCurrentLine([{ path: '/v/a.md', hits: [] }], '/v/a.md') === undefined // 空命中
})())

/* ── [V] 错误归一化（electron/shared/error.ts）─────────────────────
   这个函数存在的理由就是「catch 到的不一定是 Error」。故重点断言
   非 Error 抛出物（字符串 / null / undefined / 对象 / 数字）都不会二次抛错。 */
section('[V] errMsg -- 错误归一化对非 Error 抛出物的兜底 (electron/shared/error.ts)')

const { errMsg } = await import((await bundle('electron/shared/error.ts', 'error.mjs')).url)

check('Error 取 message', (() => {
  return errMsg(new Error('boom')) === 'boom' && errMsg(new RangeError('r')) === 'r'
})())

// 本函数存在的唯一理由就是「catch 到的不一定是 Error」，故逐个覆盖非 Error 抛出物。
// 若有人图省事把它内联回 `e.message`，这条会立刻红——`null.message` 会二次抛错。
check('非 Error 抛出物一律 String()，绝不二次抛错', (() => {
  const cases = [
    ['string', 'oops', 'oops'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['number', 42, '42'],
    ['object', { code: 7 }, '[object Object]'],
  ]
  const bad = []
  for (const [name, input, want] of cases) {
    let got
    try {
      got = errMsg(input)
    } catch (e) {
      bad.push(`${name} 抛错了（${e}）`)
      continue
    }
    if (got !== want) bad.push(`${name} 期望 ${want} 实际 ${got}`)
  }
  if (bad.length) {
    check('（明细）', false, bad.join('；'))
    return false
  }
  return true
})())

/*
   [W] 外部改动冲突判定 —— 「另存我的版本」的兄弟路径 + 忽略行尾的内容比较
   （src/utils/conflict.ts）

   为什么单独测：这两条判定**错了都不会抛错**——
   兄弟路径算错＝另存写进不存在的目录（用户以为保住了，其实没有）；
   内容比较算错＝把自己保存的回声当成外部改动，于是每次保存都弹「文件被外部修改」。
   故用断言把边界钉死，而不是靠 review 时「看起来对」。 */
section('[W] 外部改动冲突判定 —— 兄弟路径 / 行尾无关比较（src/utils/conflict.ts）')

const { siblingMinePath, isSameText } = await import(
  (await bundle('src/utils/conflict.ts', 'conflict.mjs')).url
)

check('兄弟路径：有扩展名 → 插在扩展名前', siblingMinePath('a/b/note.md') === 'a/b/note.mine.md')
check('兄弟路径：无扩展名 → 直接追加', siblingMinePath('a/b/readme') === 'a/b/readme.mine')
check(
  '兄弟路径：Windows 反斜杠同样识别',
  siblingMinePath('a\\b\\note.md') === 'a\\b\\note.mine.md'
)
// 目录名里的点不算扩展名：否则 my.notes/readme → my.mine.notes/readme（目录不存在，另存必失败）
check(
  '兄弟路径：目录名里的点不当扩展名',
  siblingMinePath('a/my.notes/readme') === 'a/my.notes/readme.mine'
)
check('兄弟路径：多点文件名只切最后一个点', siblingMinePath('a/x.tar.gz') === 'a/x.tar.mine.gz')

check('内容比较：CRLF 与 LF 视为相同', isSameText('a\r\nb\r\n', 'a\nb\n'))
check('内容比较：真实差异必须判不同', !isSameText('a\nb\n', 'a\nc\n'))
check('内容比较：空串相等，空串与单个换行不等', isSameText('', '') && !isSameText('', '\n'))

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}==== ${passed} passed, ${failed} failed ====\x1b[0m\n`)

if (failed > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
process.exit(0)
