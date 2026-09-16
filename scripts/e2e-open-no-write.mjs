/**
 * E2E 守卫：打开文档**不写盘**（真启动 Electron，非桩）。
 *
 * ── 为什么需要它 ──────────────────────────────────────────
 * 玉笺的所见即所得内核是 Crepe，其序列化是**破坏性**的：
 *   `---` → `***`、`[` → `\[`、结尾 `---` 被吃成 Setext 下划线、正文前导空行被吞。
 * 因此只要「打开文档」这一步被误判成「用户编辑」（灌入 → markdownUpdated 回显 → 判脏），
 * 800ms 后自动保存就会把**规范化后的文本**写回磁盘 —— 用户根本没动过键盘，文件却被改坏，
 * 而坏内容立刻成为新的磁盘原文，无法自愈。
 *
 * 单元测试用的是「桩」，跑不到真实的 Crepe/ProseMirror 组合，所以这个红线必须由
 * **真启动应用、真读磁盘字节**的 E2E 来守。
 *
 * ── 为什么不用 Playwright ────────────────────────────────
 * 本机无 Playwright，且实测无头 Electron 能建窗口 + executeJavaScript（无需显示器）。
 * 于是直接让 Electron 自己当驱动：零额外依赖，且跑的就是**真实应用主进程**。
 *
 * ── 两段式结构（必须）────────────────────────────────────
 * ① 编排者（node 跑本文件）：造临时库 → 快照字节 → spawn electron → 关闭后比对字节。
 * ② 车内脚本（electron 跑 e2e-open-no-write.main.cjs）：预置 session → 顶层 require
 *    真实产物 `out/main/index.js` → 等文档载入编辑器 → 睡过自动保存窗口 → 上报。
 *
 * ⚠️ 车内脚本为什么在顶层 require 真实入口：`out/main/index.js` 里
 *   `protocol.registerSchemesAsPrivileged` 必须在 app ready **之前**调用，
 *   放进 `whenReady().then()` 里 require 会抛
 *   「should be called before app is ready」→ 应用起不来（实测踩过）。
 *
 * ── 运行 ────────────────────────────────────────────────
 *   前置：`npm run build`（应用加载 out/，不是源码）
 *   node scripts/e2e-open-no-write.mjs                 # 1 轮
 *   node scripts/e2e-open-no-write.mjs --rounds=3      # 3 轮（每轮全新库，抓时序性偶发）
 *   node scripts/e2e-open-no-write.mjs --keep          # 保留临时库便于人工查看
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const IN_ELECTRON = join(HERE, 'e2e-open-no-write.main.cjs')
const require = createRequire(import.meta.url)

/**
 * 取 Electron 可执行文件路径。
 *
 * 不手拼 `node_modules/electron/dist/electron(.exe)`：`electron` 包的 `index.js`
 * 会读它**自己生成**的 `path.txt`（各平台二进制名不同）再拼 `dist/`，
 * 且在二进制缺失时**自动补下载**。从普通 Node 上下文 `require('electron')` 返回的
 * 就是这个路径字符串（而不是 Electron API 对象——那是 Electron 运行时里才有的行为）。
 */
function resolveElectronBin() {
  try {
    const p = require('electron')
    return typeof p === 'string' ? p : null
  } catch {
    return null
  }
}

/* ────────────────────────────────────────────────────────────
 * 易损语料：每一种都曾在真实使用中被 Crepe 写坏过
 * ────────────────────────────────────────────────────────── */

export const FIXTURES = {
  // ① frontmatter + 双链 + 各类行内语法（综合易损样本）
  'frontmatter.md': [
    '---',
    'title: 中文排版',
    'tags: [排版, 渲染]',
    'moc: true',
    '---',
    '',
    '# 中文排版',
    '',
    '正文段落，参见 [[双链目标]] 与 [[功能总览]]。',
    '',
    '## 二级标题',
    '',
    '- 列表项一',
    '- 列表项二，含 `行内代码` 与 ==高亮== 与 ^上标^ 与 ~下标~',
    '',
    '> 引用块',
    '',
    '| 列 A | 列 B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '- [ ] 待办未完成',
    '- [x] 待办已完成',
    ''
  ].join('\n'),

  // ② 无 frontmatter：确保「不被凭空加头」
  'plain.md': [
    '# 纯正文',
    '',
    '这是没有 frontmatter 的文档，打开后仍应逐字节不变。',
    '',
    '结尾用一个分隔线收束：',
    '',
    '---',
    ''
  ].join('\n'),

  // ③ 头与正文之间刻意留两个空行（Crepe 会吃掉前导空行 → 最容易暴露误写）
  'loose-gap.md': [
    '---',
    'title: 松间隙',
    '---',
    '',
    '',
    '# 松间隙',
    '',
    '题目与正文之间空了两行，序列化会把它压成一行 —— 未编辑时不该发生。',
    ''
  ].join('\n'),

  // ④ 反斜杠转义 / 尖括号 / 数学：remark-stringify 会重排这类字符
  'escapes.md': [
    '# 转义样本',
    '',
    '星号 \\*不斜\\*、方括号 \\[不是链接\\]、井号 \\#不是标题\\#。',
    '',
    '<kbd>Ctrl</kbd> + <kbd>S</kbd> 保存。',
    '',
    '数学 $$a^2 + b^2 = c^2$$ 与行内 $x_i$。',
    ''
  ].join('\n')
}

/** 供双链指向，避免断链噪声（不参与成败判定） */
export const EXTRA_DOCS = {
  '双链目标.md': '# 双链目标\n\n被引用的文档。\n',
  '功能总览.md': '---\ntitle: 功能总览\nmoc: true\n---\n\n# 功能总览\n\n枢纽文档。\n'
}

/** 启动时激活的文档（选最易损的那篇） */
export const ACTIVE_DOC = 'frontmatter.md'

/** 自动保存防抖（EditorHost.AUTOSAVE_DELAY） */
const AUTOSAVE_DELAY_MS = 800
/** 灌入回显另有 200ms debounce（@milkdown/plugin-listener）+ 渲染往返，留足余量 */
const DEFAULT_WAIT_MS = AUTOSAVE_DELAY_MS * 6

/* ────────────────────────────────────────────────────────────
 * 断言（纯函数，可被外部复用）
 * ────────────────────────────────────────────────────────── */

export function sha(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}

/** 首个差异行，便于一眼看出被写坏成什么样 */
export function firstDiffLine(a, b, side) {
  const la = a.split('\n')
  const lb = b.split('\n')
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return side === 'before' ? la[i] ?? '(缺失)' : lb[i] ?? '(缺失)'
  }
  return ''
}

/** 核心断言：打开前 vs 关闭后，每个文件必须逐字节相等 */
export function assertNoWrite(before, after) {
  const failures = []
  for (const [name, beforeText] of Object.entries(before)) {
    if (!(name in after)) {
      failures.push({ file: name, reason: '文件在打开后被删除' })
      continue
    }
    const afterText = after[name]
    if (beforeText === afterText) continue
    failures.push({
      file: name,
      reason: `字节发生变化（${sha(beforeText)} → ${sha(afterText)}，长度 ${beforeText.length} → ${afterText.length}）`,
      beforeHead: firstDiffLine(beforeText, afterText, 'before'),
      afterHead: firstDiffLine(beforeText, afterText, 'after')
    })
  }
  return failures
}

/** 额外断言：笔记库内不得新增文件（如误建的 .assets / 临时文件） */
export function assertNoNewFiles(beforeNames, afterNames) {
  const ignored = (n) => n.startsWith('.yujian-history') || n.startsWith('.mdeditor')
  return afterNames
    .filter((n) => !ignored(n) && !beforeNames.includes(n))
    .map((file) => ({ file, reason: '打开后凭空新增文件' }))
}

/* ────────────────────────────────────────────────────────────
 * 编排者
 * ────────────────────────────────────────────────────────── */

async function listVaultFiles(vault) {
  const out = []
  const walk = async (dir, rel) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(join(dir, e.name), r)
      else out.push(r)
    }
  }
  await walk(vault, '')
  return out
}

function readAll(vault) {
  return Promise.all(
    Object.keys(FIXTURES).map(async (n) => [n, await readFile(join(vault, n), 'utf8')])
  ).then(Object.fromEntries)
}

function runElectron(electronBin, vault, waitMs) {
  return new Promise((resolvePromise) => {
    const env = { ...process.env, YJ_E2E_VAULT: vault, YJ_E2E_WAIT: String(waitMs), MD_EDITOR_COMPAT_MODE: '1' }
    delete env.ELECTRON_RUN_AS_NODE // 宿主 IDE 会注入：不清除则 Electron 退化成纯 Node，永不建窗
    // Linux 上 Chromium 的 SUID 沙箱要求 chrome-sandbox 属 root 且 mode 4755；
    // CI 里不满足 → 启动即 FATAL 中止。`--no-sandbox` 必须在**进程启动前**作为命令行参数传入，
    // 不能只靠应用里 `app.commandLine.appendSwitch('no-sandbox')`（那已晚于沙箱初始化）。
    const args = process.platform === 'linux' ? ['--no-sandbox', IN_ELECTRON] : [IN_ELECTRON]
    const child = spawn(electronBin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const killTimer = setTimeout(() => child.kill(), 90_000)
    child.on('exit', () => {
      clearTimeout(killTimer)
      const m = out.match(/__YJ_E2E__(.+?)__END__/s)
      if (!m) {
        resolvePromise({ fatal: `Electron 未上报结果。尾部输出：${out.slice(-500) || '(空)'}` })
        return
      }
      try {
        resolvePromise(JSON.parse(m[1]))
      } catch (e) {
        resolvePromise({ fatal: `结果解析失败：${e.message}` })
      }
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const keep = args.includes('--keep')
  const roundsArg = args.find((a) => a.startsWith('--rounds='))
  const rounds = roundsArg ? Math.max(1, Number(roundsArg.split('=')[1]) || 1) : 1
  const waitArg = args.find((a) => a.startsWith('--wait='))
  const waitMs = waitArg ? Number(waitArg.split('=')[1]) || DEFAULT_WAIT_MS : DEFAULT_WAIT_MS

  // 用 electron 包自己的解析器取可执行文件路径，而不是手拼 `dist/electron(.exe)`。
  // 理由：`node_modules/electron/index.js` 会读它自己生成的 path.txt 再拼 dist/，
  // 且**发现缺失时会自动补下载**——手拼路径在 Linux CI 上会因平台名/未下载而失配。
  // 从普通 Node 上下文 `require('electron')` 返回的就是路径字符串（不是 API 对象）。
  const electronBin = resolveElectronBin()
  const appEntry = join(ROOT, 'out', 'main', 'index.js')

  console.log('E2E 打开不写盘（真 Electron）')
  console.log(`  语料：${Object.keys(FIXTURES).length} 篇易损文档 · 等待窗口 ${waitMs}ms · ${rounds} 轮`)

  if (!electronBin || !existsSync(electronBin)) {
    console.error(
      `✗ 未找到 electron 可执行文件${electronBin ? `：${electronBin}` : ''}\n` +
        `  请先确保 Electron 二进制已下载：\n` +
        `    ELECTRON_MIRROR="https://github.com/electron/electron/releases/download/" node node_modules/electron/install.js\n` +
        `  （CI 上 npm ci 应自动完成；本地若失败可按上面手动补）`
    )
    process.exit(1)
  }
  console.log(`  electron：${electronBin}`)
  if (!existsSync(appEntry)) {
    console.error(`✗ 未找到构建产物 ${appEntry}，请先 \`npm run build\``)
    process.exit(1)
  }
  // Linux 无显示器（CI）时需要 xvfb-run 才能起窗口；有 DISPLAY 则直跑
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    console.error('✗ Linux 下无 DISPLAY：请用 `xvfb-run -a node scripts/e2e-open-no-write.mjs` 运行')
    process.exit(1)
  }

  let passed = 0
  const failures = []

  for (let round = 1; round <= rounds; round++) {
    const vault = join(ROOT, 'tmp', `e2e-vault-${round}`)
    await rm(vault, { recursive: true, force: true })
    await mkdir(vault, { recursive: true })
    for (const [name, text] of Object.entries({ ...FIXTURES, ...EXTRA_DOCS })) {
      await writeFile(join(vault, name), text, 'utf8')
    }

    const before = await readAll(vault)
    const beforeNames = await listVaultFiles(vault)

    const r = await runElectron(electronBin, vault, waitMs)
    if (r.fatal) {
      failures.push({ round, file: '(进程)', reason: r.fatal })
      console.log(`  ✗ 第 ${round} 轮：${r.fatal}`)
      if (!keep) await rm(vault, { recursive: true, force: true })
      continue
    }

    // 关闭应用后再读盘：避开写了一半的中间态
    const after = await readAll(vault)
    const afterNames = await listVaultFiles(vault)
    const roundFailures = [
      ...assertNoWrite(before, after),
      ...assertNoNewFiles(beforeNames, afterNames)
    ].map((f) => ({ round, ...f }))

    if (roundFailures.length === 0) {
      passed++
      const seen = String(r.visible || '').replace(/\s+/g, ' ').slice(0, 28)
      console.log(`  ✓ 第 ${round} 轮：${Object.keys(FIXTURES).length} 篇逐字节未变（编辑器实测载入「${seen}…」）`)
    } else {
      failures.push(...roundFailures)
      console.log(`  ✗ 第 ${round} 轮：${roundFailures.length} 处异常`)
      for (const f of roundFailures) {
        console.log(`      · ${f.file}：${f.reason}`)
        if (f.beforeHead !== undefined) console.log(`        打开前: ${JSON.stringify(f.beforeHead)}`)
        if (f.afterHead !== undefined) console.log(`        关闭后: ${JSON.stringify(f.afterHead)}`)
      }
    }

    if (!keep) await rm(vault, { recursive: true, force: true })
    else console.log(`    （保留：${vault}）`)
  }

  console.log('')
  if (failures.length === 0) {
    console.log(`✓ E2E 打开不写盘：${passed}/${rounds} 轮通过，0 字节变化`)
    process.exit(0)
  }
  console.log(`✗ E2E 打开不写盘：${passed}/${rounds} 轮通过，${failures.length} 处失败`)
  process.exit(1)
}

await main()
