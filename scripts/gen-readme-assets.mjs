// 生成 README 配图（纯 SVG，色值严格取自 tokens.css / appearance.ts）
// 运行：node scripts/gen-readme-assets.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = 'docs/assets'
mkdirSync(OUT, { recursive: true })

// ── 真实皮肤令牌（与 appearance.ts / tokens.css 一致）──
const SKINS = [
  { key: 'celadon', name: '青瓷', en: 'Celadon', dark: '#5FA8A0', light: '#248077', base: '#23292B' },
  { key: 'sky',     name: '天青', en: 'Sky',     dark: '#5E9DBE', light: '#2B7BA8', base: '#212A2F' },
  { key: 'moon',    name: '月白', en: 'Moon',    dark: '#93A7B4', light: '#5A7180', base: '#23282C' },
  { key: 'dai',     name: '黛',   en: 'Dai',     dark: '#8B7CB8', light: '#6A5A9E', base: '#262430' },
  { key: 'amber',   name: '琥珀', en: 'Amber',   dark: '#C79A4E', light: '#9A6F24', base: '#2A2620' }
]

// ── 通用色 ──
const C = {
  base: '#23292B', bar: '#1F2527', editor: '#1C1E1F', surface: '#262C2E',
  text1: '#E8E9E7', text2: '#A3A7A5', text3: '#8B908E', accent: '#5FA8A0',
  accentLight: '#248077', onAccent: '#14201E', success: '#4EC9A0',
  line: 'rgba(255,255,255,0.055)', line2: 'rgba(255,255,255,0.10)',
  hover: 'rgba(255,255,255,0.05)', active: 'rgba(95,168,160,0.16)',
  codeFg: '#8FD0C6', codeStr: '#9BD4A4', codeKw: '#8FB8D8'
}

const FONT = "font-family=\"-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif\""
const MONO = "font-family=\"'JetBrains Mono','Sarasa Mono SC','Cascadia Code',Menlo,Consolas,monospace\""

// ── 工具函数 ──
let s = ''
const r = (x, y, w, h, o = {}) => {
  let a = `x="${x}" y="${y}" width="${w}" height="${h}"`
  if (o.fill) a += ` fill="${o.fill}"`
  if (o.stroke) a += ` stroke="${o.stroke}"`
  if (o.sw) a += ` stroke-width="${o.sw}"`
  if (o.rx) a += ` rx="${o.rx}"`
  if (o.op) a += ` opacity="${o.op}"`
  s += `<rect ${a}/>`
}
const t = (x, y, str, o = {}) => {
  let a = `x="${x}" y="${y}"`
  if (o.size) a += ` font-size="${o.size}"`
  if (o.fill) a += ` fill="${o.fill}"`
  if (o.anchor) a += ` text-anchor="${o.anchor}"`
  if (o.weight) a += ` font-weight="${o.weight}"`
  if (o.spacing) a += ` letter-spacing="${o.spacing}"`
  if (o.op) a += ` opacity="${o.op}"`
  a += ` ${o.mono ? MONO : FONT}`
  s += `<text ${a}>${esc(str)}</text>`
}
const ln = (x1, y1, x2, y2, stroke, sw = 1, op = 1) =>
  (s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"/>`)
const circle = (cx, cy, rad, fill) => (s += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}"/>`)
const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 玉质暗色填充（青瓷）：先实色底，再叠两层 tint 径向 + 顶部高光
const JADE_DEFS = `
  <linearGradient id="jHi" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.055"/>
    <stop offset="20%" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="jT1" cx="12%" cy="0%" r="70%">
    <stop offset="0%" stop-color="rgb(126,196,182)" stop-opacity="0.13"/>
    <stop offset="62%" stop-color="rgb(126,196,182)" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="jT2" cx="85%" cy="100%" r="60%">
    <stop offset="0%" stop-color="rgb(95,168,160)" stop-opacity="0.10"/>
    <stop offset="58%" stop-color="rgb(95,168,160)" stop-opacity="0"/>
  </radialGradient>`
const jade = (x, y, w, h) => {
  r(x, y, w, h, { fill: C.base })
  r(x, y, w, h, { fill: 'url(#jT1)' })
  r(x, y, w, h, { fill: 'url(#jT2)' })
  r(x, y, w, h, { fill: 'url(#jHi)' })
}

// ============================================================
// 1. 应用总览外壳（青瓷 · 深）
// ============================================================
function overview() {
  s = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640" viewBox="0 0 1080 640" role="img" aria-label="玉笺编辑器界面总览（青瓷·深）">
  <defs>${JADE_DEFS}</defs>`
  // 窗口底（框架层玉质）
  jade(0, 0, 1080, 640)
  ln(0, 38, 1080, 38, C.line)
  // ── 标题栏 ──
  circle(20, 19, 5, C.accent)
  t(34, 24, '玉笺', { size: 13, fill: C.text1, weight: 500 })
  // 右侧：分段控件（所见即所得 / 源码）
  const segX = 700, segY = 7, segW = 150, segH = 24
  r(segX, segY, segW, segH, { rx: 6, fill: 'rgba(255,255,255,0.055)', stroke: 'rgba(255,255,255,0.07)' })
  r(segX + 2, segY + 2, 73, segH - 4, { rx: 4, fill: C.accent })
  t(segX + 38, segY + 16, '所见即所得', { size: 11, fill: C.onAccent, anchor: 'middle', weight: 500 })
  t(segX + 113, segY + 16, '源码', { size: 11, fill: C.text3, anchor: 'middle' })
  // 图标按钮
  const ib = (ix, ch) => { r(ix, 8, 22, 22, { rx: 6, fill: 'rgba(255,255,255,0.05)' }); t(ix + 11, 23, ch, { size: 12, fill: C.text2, anchor: 'middle' }) }
  ib(864, '⤓'); ib(892, '◐'); ib(920, '⋯'); ib(948, '?')
  // ── 侧栏 ──
  ln(224, 38, 224, 614, C.line)
  jade(0, 38, 224, 576)
  r(12, 50, 200, 32, { rx: 7, fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.06)' })
  t(24, 70, '我的笔记库', { size: 12, fill: C.text1 })
  t(196, 69, '▾', { size: 11, fill: C.text3, anchor: 'end' })
  r(12, 90, 200, 28, { rx: 7, fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.06)' })
  t(24, 108, '搜索…', { size: 12, fill: C.text3 })
  t(20, 140, '文件', { size: 11, fill: C.text3, spacing: 1 })
  const tree = (yy, txt, act) => {
    if (act) r(6, yy - 18, 212, 26, { rx: 6, fill: C.active })
    t(28, yy, '▸', { size: 10, fill: act ? C.text1 : C.text2 })
    t(42, yy, txt, { size: 12.5, fill: act ? C.text1 : C.text2, op: act ? 1 : 0.72 })
  }
  tree(168, '技术笔记', false)
  tree(198, 'electron-架构.md', true)
  tree(228, 'vite-版本锁定.md', false)
  tree(258, 'i18n-中英切换.md', false)
  t(16, 600, '128 篇文档', { size: 11, fill: C.text3 })
  // ── 内容 ──
  r(224, 38, 660, 576, { fill: C.editor })
  ln(224, 68, 884, 68, 'rgba(255,255,255,0.045)')
  t(254, 56, '技术笔记 / electron-架构.md', { size: 11, fill: C.text3 })
  // 内容列（居中，max 720）
  const cx = 254, cw = 600
  t(cx, 110, 'Electron 进程模型', { size: 24, fill: C.text1, weight: 500 })
  t(cx, 140, '应用由主进程、预加载脚本与渲染进程三类构成。理解它们的权限边界，是设计 IPC 通道的前提。', { size: 13.5, fill: C.text2, op: 0.9 })
  t(cx, 178, '主进程', { size: 15, fill: C.text1, weight: 500 })
  t(cx, 202, '每个应用有且仅有一个主进程，拥有完整的 Node.js 权限，负责窗口与文件系统。', { size: 13.5, fill: C.text2, op: 0.9 })
  // 代码块
  const cbX = cx, cbY = 224, cbW = cw, cbH = 96
  r(cbX, cbY, cbW, cbH, { rx: 8, fill: C.surface, stroke: 'rgba(255,255,255,0.06)' })
  ln(cbX + 6, cbY + 26, cbX + cbW - 6, cbY + 26, 'rgba(255,255,255,0.05)')
  r(cbX, cbY, cbW, cbH, { rx: 8, fill: 'none', stroke: 'rgba(255,255,255,0.055)' })
  // 内陷高光
  ln(cbX + 1, cbY + 1, cbX + cbW - 1, cbY + 1, 'rgba(255,255,255,0.06)', 1, 0.6)
  t(cbX + 14, cbY + 18, 'main.ts', { size: 11, fill: C.text3 })
  t(cbX + 14, cbY + 46, 'app.whenReady().then(() => {', { size: 12, fill: C.codeFg, mono: true })
  t(cbX + 14, cbY + 66, "  createWindow()  // 三进程模型", { size: 12, fill: C.codeFg, mono: true })
  t(cbX + 14, cbY + 86, '})', { size: 12, fill: C.codeFg, mono: true })
  // 引用
  ln(cx, 348, cx + 3, 384, C.accent, 3)
  t(cx + 16, 366, '图床密钥只存主进程，用 safeStorage 加密，绝不下发渲染层。', { size: 13, fill: C.text2, op: 0.7 })
  // ── 大纲 ──
  ln(884, 38, 884, 614, C.line)
  jade(884, 38, 196, 576)
  t(900, 64, '大纲', { size: 11, fill: C.text3, spacing: 1 })
  const ol = (yy, txt, ind, act) => {
    if (act) r(896, yy - 16, 172, 24, { rx: 6, fill: C.active })
    t(900 + ind * 14, yy, txt, { size: 12, fill: act ? C.text1 : C.text3 })
  }
  ol(96, 'Electron 进程模型', 0, true)
  ol(124, '主进程', 1, false)
  ol(152, '预加载脚本', 1, false)
  ol(180, '渲染进程', 1, false)
  ol(214, 'IPC 通道', 1, false)
  ol(248, '保真策略', 0, false)
  // ── 状态栏 ──
  ln(0, 614, 1080, 614, C.line)
  circle(20, 627, 4, C.success)
  t(32, 631, '玉笺', { size: 11, fill: C.text2 })
  t(1060, 631, 'UTF-8 · Markdown · 1,284 字', { size: 11, fill: C.text2, anchor: 'end' })
  s += `</svg>`
  writeFileSync(`${OUT}/yujian-overview.svg`, s)
}

// ============================================================
// 2. 五套皮肤色板
// ============================================================
function skins() {
  const cw = 200, ch = 170, gap = 16, total = SKINS.length * cw + (SKINS.length - 1) * gap
  const W = total, H = ch + 40
  s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="玉笺五套皮肤色板">`
  SKINS.forEach((sk, i) => {
    const x = i * (cw + gap)
    r(x, 0, cw, ch, { rx: 12, fill: sk.base, stroke: 'rgba(255,255,255,0.10)' })
    // cap 上半色
    r(x, 0, cw, 70, { rx: 12, fill: sk.dark })
    r(x, 58, cw, 12, { fill: sk.dark })
    // 玉质噪点近似：顶部高光
    r(x, 0, cw, 70, { rx: 12, fill: 'rgba(255,255,255,0.06)' })
    t(x + cw / 2, 104, sk.name, { size: 15, fill: C.text1, anchor: 'middle', weight: 600, spacing: 1 })
    t(x + cw / 2, 126, sk.dark.toUpperCase(), { size: 11, fill: sk.dark, anchor: 'middle', mono: true })
    t(x + cw / 2, 144, '浅 ' + sk.light.toUpperCase(), { size: 10, fill: C.text3, anchor: 'middle', mono: true })
    t(x + cw / 2, 162, sk.en, { size: 10, fill: C.text3, anchor: 'middle', spacing: 1 })
  })
  s += `</svg>`
  writeFileSync(`${OUT}/yujian-skins.svg`, s)
}

// ============================================================
// 3. 三层材质分层
// ============================================================
function material() {
  const W = 1080, H = 430
  s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="三层材质分层：框架玉质 / 浮层玻璃 / 内容实色">
  <defs>${JADE_DEFS}
    <linearGradient id="gHi" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>`
  // 层 1：框架层玉质
  let y = 0
  r(0, y, W, 130, { fill: C.base })
  r(0, y, W, 130, { fill: 'url(#jT1)' })
  r(0, y, W, 130, { fill: 'url(#jT2)' })
  r(0, y, W, 130, { fill: 'url(#jHi)' })
  r(40, y + 26, 280, 78, { rx: 10, fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.08)' })
  t(62, y + 56, '标题栏', { size: 13, fill: C.text2 })
  t(62, y + 80, '侧边栏 · 大纲 · 状态栏', { size: 11, fill: C.text3 })
  t(700, y + 76, '① 框架层 = 玉质（静态预渲染，零运行时开销）', { size: 14, fill: C.text1, anchor: 'end', weight: 500 })
  // 层 2：浮层玻璃（在玉质背景上叠一块玻璃菜单）
  y = 150
  r(0, y, W, 130, { fill: C.base })
  r(0, y, W, 130, { fill: 'url(#jT1)' })
  r(0, y, W, 130, { fill: 'url(#jT2)' })
  r(0, y, W, 130, { fill: 'url(#jHi)' })
  // 玻璃菜单
  const gx = 360, gy = y + 20, gw = 360, gh = 96
  r(gx, gy, gw, gh, { rx: 12, fill: 'rgba(32,37,38,0.66)', stroke: 'rgba(255,255,255,0.09)' })
  r(gx, gy, gw, 1, { fill: 'rgba(255,255,255,0.10)' })
  ln(gx, gy + 32, gx + gw, gy + 32, 'rgba(255,255,255,0.07)')
  r(gx + 8, gy + 8, gw - 16, 16, { fill: C.active })
  t(gx + 16, gy + 20, '导出文档', { size: 13, fill: C.text1 })
  t(gx + 16, gy + 52, '导出为 HTML', { size: 12.5, fill: C.text2 })
  t(gx + 16, gy + 76, '导出为 PDF', { size: 12.5, fill: C.text2 })
  t(700, y + 76, '② 浮层 = 玻璃（实时模糊，仅小面积浮层）', { size: 14, fill: C.text1, anchor: 'end', weight: 500 })
  // 层 3：内容层纯净实色
  y = 300
  r(0, y, W, 130, { fill: C.editor })
  r(40, y + 24, 1000, 82, { rx: 8, fill: 'rgba(255,255,255,0.02)' })
  t(60, y + 64, '正文 16px / 行高 1.75 · 内容列 720 居中 · 纯净实色不加纹理', { size: 14, fill: C.text2 })
  t(700, y + 76, '③ 内容层 = 纯净实色（保对比度与导出一致）', { size: 14, fill: C.text1, anchor: 'end', weight: 500 })
  s += `</svg>`
  writeFileSync(`${OUT}/yujian-material.svg`, s)
}

// ============================================================
// 4. 玻璃浮层示意（亮色）
// ============================================================
function glass() {
  const W = 1080, H = 360
  s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="玻璃浮层示意（亮色羊脂玉半透）">
  <defs>${JADE_DEFS}</defs>`
  // 背景：亮色玉质窗口
  r(0, 0, W, H, { fill: '#EFF2F0' })
  r(0, 0, W, H, { fill: 'url(#jT1)', op: 1 })
  r(0, 0, W, H, { fill: 'url(#jT2)', op: 1 })
  // 标题栏亮
  r(0, 0, W, 38, { fill: '#F3F5F3' })
  ln(0, 38, W, 38, 'rgba(0,0,0,0.065)')
  circle(20, 19, 5, C.accentLight)
  t(34, 24, '玉笺', { size: 13, fill: '#1B1D1C', weight: 500 })
  r(864, 8, 22, 22, { rx: 6, fill: 'rgba(0,0,0,0.04)' })
  t(875, 23, '⤓', { size: 12, fill: '#575B5A', anchor: 'middle' })
  // 玻璃菜单浮于内容上方
  const gx = 430, gy = 70, gw = 360, gh = 150
  r(gx, gy, gw, gh, { rx: 12, fill: 'rgba(245,248,246,0.78)', stroke: 'rgba(20,30,28,0.10)' })
  r(gx, gy, gw, 1, { fill: 'rgba(255,255,255,0.6)' })
  ln(gx, gy + 40, gx + gw, gy + 40, 'rgba(0,0,0,0.06)')
  r(gx + 8, gy + 10, gw - 16, 20, { fill: 'rgba(36,128,119,0.10)' })
  t(gx + 16, gy + 24, '导出文档', { size: 14, fill: '#1B1D1C', weight: 500 })
  r(gx + 8, gy + 48, gw - 16, 30, { fill: 'rgba(36,128,119,0.10)' })
  t(gx + 16, gy + 67, '导出为 HTML', { size: 12.5, fill: '#1B1D1C' })
  t(gx + gw - 16, gy + 67, 'Ctrl E', { size: 11, fill: '#6E7372', anchor: 'end' })
  t(gx + 16, gy + 101, '导出为 PDF', { size: 12.5, fill: '#3D4341' })
  t(gx + gw - 16, gy + 101, 'Ctrl P', { size: 11, fill: '#6E7372', anchor: 'end' })
  t(gx + 16, gy + 132, '↑↓ 选择 · Enter 执行 · Esc 关闭', { size: 11, fill: '#6E7372' })
  t(540, 300, '所有浮层（标题栏下拉 / 右键 / 帮助 / 编辑区 slash 菜单）共用同一套玻璃，明暗双版', { size: 13, fill: '#575B5A', anchor: 'middle' })
  s += `</svg>`
  writeFileSync(`${OUT}/yujian-glass.svg`, s)
}

// ============================================================
// 5. 块手柄一致左轨
// ============================================================
function handle() {
  const W = 1080, H = 220
  s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="块操作手柄一致左轨，绝不压字">
  <defs>${JADE_DEFS}</defs>`
  r(0, 0, W, H, { fill: C.editor })
  // 左侧 96px 沟槽（仅以淡线示意）
  ln(96, 0, 96, H, 'rgba(255,255,255,0.05)')
  t(48, 200, '96px 沟槽', { size: 10, fill: C.text3, anchor: 'middle' })
  // 手柄药丸
  const hx = 18, hy = 70
  r(hx, hy, 52, 28, { rx: 6, fill: '#262C2E', stroke: 'rgba(255,255,255,0.10)' })
  r(hx + 4, hy + 4, 20, 20, { rx: 4, fill: 'rgba(255,255,255,0.06)' })
  r(hx + 28, hy + 4, 20, 20, { rx: 4, fill: 'rgba(255,255,255,0.06)' })
  t(hx + 26, hy + 22, '+', { size: 16, fill: C.text2, anchor: 'middle' })
  // 正文（不会被压）
  t(120, 90, '保留 Crepe 算出的「块自身左缘」，仅 translateX(-12px) 向左挪出呼吸缝；', { size: 14, fill: C.text1 })
  t(120, 118, '缩进块手柄随之右移，始终在块左缘左侧、永不遮字。', { size: 14, fill: C.codeFg })
  t(120, 160, '编辑区左侧预留 96px 沟槽，最窄窗口也不被裁切。', { size: 13, fill: C.text3 })
  s += `</svg>`
  writeFileSync(`${OUT}/yujian-handle.svg`, s)
}

// ============================================================
// 6. 表格长串换行示意
// ============================================================
function tableWrap() {
  const W = 1080, H = 220
  const col1 = 180, col2 = 620, col3 = 280
  s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="表格长串在单元格内换行，不再叠字">
  <defs>${JADE_DEFS}</defs>`
  r(0, 0, W, H, { fill: C.editor })
  const x0 = 40, y0 = 30
  // 表头
  r(x0, y0, col1, 36, { rx: 0, fill: C.active })
  r(x0 + col1, y0, col2, 36, { fill: C.active })
  r(x0 + col1 + col2, y0, col3, 36, { fill: C.active })
  t(x0 + 14, y0 + 23, '能力', { size: 12.5, fill: C.accent, weight: 500 })
  t(x0 + col1 + 14, y0 + 23, '长串 token 示例', { size: 12.5, fill: C.accent, weight: 500 })
  t(x0 + col1 + col2 + 14, y0 + 23, '状态', { size: 12.5, fill: C.accent, weight: 500 })
  const rows = [
    ['导出 HTML', 'directlyFromProseMirrorDOMWithoutReRenderingPipeline', '已修复换行'],
    ['导出 PDF', 'webContents.printToPDFWithCurrentLayout', '已修复换行'],
    ['图床密钥', 'safeStorageEncryptOnlyInMainProcess', '已修复换行']
  ]
  rows.forEach((rw, i) => {
    const ry = y0 + 36 + i * 46
    if (i % 2 === 1) r(x0, ry, col1 + col2 + col3, 46, { fill: 'rgba(255,255,255,0.035)' })
    ln(x0, ry, x0 + col1 + col2 + col3, ry, 'rgba(255,255,255,0.07)')
    t(x0 + 14, ry + 28, rw[0], { size: 12.5, fill: C.text1 })
    // 长串：分两行显示（模拟换行）
    const tk = rw[1]
    t(x0 + col1 + 14, ry + 20, tk.slice(0, 38), { size: 11.5, fill: C.codeFg, mono: true })
    t(x0 + col1 + 14, ry + 38, tk.slice(38), { size: 11.5, fill: C.codeFg, mono: true })
    t(x0 + col1 + col2 + 14, ry + 28, rw[2], { size: 12, fill: C.codeStr })
  })
  ln(x0, y0 + 36 + 3 * 46, x0 + col1 + col2 + col3, y0 + 36 + 3 * 46, 'rgba(255,255,255,0.07)')
  s += `</svg>`
  writeFileSync(`${OUT}/yujian-table.svg`, s)
}

overview(); skins(); material(); glass(); handle(); tableWrap()
console.log('README 配图已生成至', OUT)
