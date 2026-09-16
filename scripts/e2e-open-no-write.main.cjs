/**
 * 「打开不写盘」E2E 的**车内脚本**（必须用 CJS，因为真实主进程产物是 CJS）。
 *
 * 它由 `scripts/e2e-open-no-write.mjs` 以 `electron <本文件>` 方式启动，
 * 扮演真实应用的 `main` 入口：
 *   1. 在 app ready 之前把 session.json 预置好（指定库 + 打开哪些文档 + 激活哪篇）；
 *   2. **顶层** require 真实产物 `out/main/index.js`（协议注册必须先于 ready，不能放进 whenReady）；
 *   3. 等窗口出现 + 编辑器真正渲染出目标文本（说明「打开」已完成，而非空壳窗口）；
 *   4. 再睡过自动保存窗口（默认 800ms×6），让任何被误判为编辑的保存都来得及发生；
 *   5. 把此刻可见正文 + 库路径以哨兵格式写到 stdout，交给编排者比对磁盘字节。
 *
 * 注意：本文件**不改磁盘上的库文件**，只读；唯一的写是 session.json（应用自己的配置，非笔记库）。
 */

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const VAULT = process.env.YJ_E2E_VAULT
const WAIT_MS = Number(process.env.YJ_E2E_WAIT || 4800)
const ACTIVE_DOC = 'frontmatter.md'

function report(payload) {
  process.stdout.write(`\n__YJ_E2E__${JSON.stringify(payload)}__END__\n`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fatal(msg) {
  report({ ok: false, fatal: msg })
  app.exit(1)
}

if (!VAULT) {
  fatal('缺少 YJ_E2E_VAULT 环境变量')
  process.exit(1)
}

/* ── 1. 预置会话（必须早于 require 真实入口，应用启动时才会自动打开）── */

try {
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  const docs = fs
    .readdirSync(VAULT)
    .filter((n) => n.endsWith('.md'))
    .map((n) => path.join(VAULT, n))
  fs.writeFileSync(
    path.join(userData, 'session.json'),
    JSON.stringify(
      {
        version: 1,
        vaultPath: VAULT,
        openTabs: docs,
        activePath: path.join(VAULT, ACTIVE_DOC),
        mode: 'wysiwyg',
        startupMode: 'restore',
        sidebarWidth: 260
      },
      null,
      2
    ),
    'utf8'
  )
} catch (e) {
  fatal(`预置 session 失败：${e.message}`)
}

/* ── 2. 顶层 require 真实主进程：协议注册必须先于 app ready ── */

const appEntry = path.join(__dirname, '..', 'out', 'main', 'index.js')
if (!fs.existsSync(appEntry)) {
  fatal(`未找到构建产物 ${appEntry}`)
}
try {
  require(appEntry)
} catch (e) {
  fatal(`加载真实主进程失败：${e.stack || e.message}`)
}

/* ── 3~5. 等打开完成 → 睡过保存窗口 → 上报 ── */

app.whenReady().then(async () => {
  const win = await waitForWindow(20_000)
  if (!win) return fatal('20s 内未出现主窗口')

  // 轮询到编辑器渲染出「中文排版」——证明文档真的灌进了所见即所得视图
  const ok = await waitForEditorText(win, '中文排版', 20_000)
  if (!ok) return fatal('20s 内编辑器未渲染出目标文档内容')

  await sleep(WAIT_MS)

  const visible = await win.webContents
    .executeJavaScript('document.querySelector(".milkdown")?.innerText ?? ""')
    .catch(() => '')

  report({ ok: true, vault: VAULT, visible: String(visible).slice(0, 160) })
  app.exit(0)
})

async function waitForWindow(timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) return wins[0]
    await sleep(100)
  }
  return null
}

async function waitForEditorText(win, needle, timeoutMs) {
  const t0 = Date.now()
  const probe = `(() => { const el = document.querySelector('.milkdown'); return !!(el && el.innerText && el.innerText.includes(${JSON.stringify(needle)})) })()`
  while (Date.now() - t0 < timeoutMs) {
    const found = await win.webContents.executeJavaScript(probe).catch(() => false)
    if (found) return true
    await sleep(150)
  }
  return false
}
