/**
 * 设计门禁 —— 把《玉笺设计体系》从「文档级」变成「系统级」。
 *
 * 为什么需要它：v1.0 的 `docs/UI-DESIGN.md` 写得很完整（三条原则 + 玉质/玻璃材质 +
 * 排版/间距/圆角表），但**没有任何东西强制它**。结果是 40 个组件各自即兴发挥：
 * 22 种字号、24 种圆角、13 种 z-index；`--space-*` 甚至只写在文档里、从未在源码存在过。
 * 更隐蔽的是「伪令牌」——`var(--hue-hover)` / `var(--hue-border-default)` 这类
 * **从未定义**的变量名，CSS 会静默丢弃整条声明（不报错、不警告、测试全绿），
 * 于是边框不画、背景不变、hover 不动，只能靠人眼在某个皮肤下偶然发现。
 *
 * 七类规则（全部进 CI）：
 *   ① 令牌必须已定义 —— 抓伪令牌（含 `var(--x, fallback)` 里 x 不存在的情况）
 *   ② z-index 必须引用 --z-* 语义阶梯
 *   ③ border-radius 必须引用 --radius-*
 *   ④ 颜色不得写死 hex（排除 tokens.css 与导出模板）
 *   ⑤ 字号须为 --fs-* / em / 冻结遗留值
 *   ⑥ 间距须为整数 px；≥32px 的间距须为 8 的倍数
 *   ⑦ **零引用令牌**（定义了却没人用）——与 ① 互为反面：① 抓「用了不存在的」，
 *      ⑦ 抓「存在了没人用的」。二者都是「源码里的谎言」，但 ⑦ 更阴：它**能算出值**，
 *      所以不会报错、看起来也正常，只是**不参与主题切换**——通常只在 `:root` 写了一档，
 *      亮色下必然错。实测抓到 `--hue-bar`（5 皮肤 × 明暗共 10 处声明、全项目零引用）。
 *
 * ⑤⑥ 的「冻结遗留值」沿用 `check-structure.mjs` 的 any 门禁纪律：**只减不增**。
 * 想放宽必须显式改这里的阈值并在提交信息里说明原因。
 *
 * 反例防护：本脚本的扫描面按**目录**而非写死文件路径组织（组件拆分不会让它静默失效）。
 * 每次新增规则都做过「注入故障 → 报红 → 还原 → 复绿」验证。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/** 只扫生产代码；`scripts/` 下的测试脚本不受设计门禁约束 */
const SCAN_DIRS = ['src']
/** 独立样式上下文：导出 HTML 模板自带完整字体栈与调色，不参与应用主题，故豁免 */
const EXEMPT = ['src/export/']

// ── 规则⑤ 冻结遗留字号（半像素层：10.5/11.5/12.5 在密集 UI 里是一套自洽的「紧凑档」，
//    收敛会改变全应用文字度量，属于一次需要单独设计评审的排版改动，不塞进机械清扫）。
//    计数为基线，只减不增。
const FONT_LEGACY = { '12.5px': 42, '10.5px': 27, '11.5px': 26, '13.5px': 2, '20px': 1 }

// ── 规则⑥ 冻结离群间距（大间距属「区块节奏」，应是刻度的少数几档；30/78 是即兴值）。
//    微间距（≤24px）不设门禁：那里大量使用 1px 光学补偿（给带描边的元素减 1px），
//    机械规则会跟设计师的判断打架，收益为负。
const SPACE_LEGACY = { '30px': 3, '78px': 1 }

// ── 令牌与属性提取 ─────────────────────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|css|ts)$/.test(name)) out.push(p)
  }
  return out
}

const files = SCAN_DIRS.flatMap((d) => walk(join(root, d)))
  .map((f) => relative(root, f).split('\\').join('/'))
  .filter((f) => !EXEMPT.some((e) => f.startsWith(e)))

/**
 * 剥离注释后再扫描（**保留换行**，否则报错行号会整体错位）。
 * 必要性（实测）：本仓库的 CSS 注释里大量出现 `var(--x)`、`z-index:999`、`margin` 等
 * 讨论性文本，不剥注释会把说明文字判成违规——门禁一旦有假阳性就会被当成噪音而遭无视。
 * `//` 用 `(?<!:)` 排除 `https://`。
 */
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(?<!:)\/\/[^\n]*/g, '')

const read = (f) => stripComments(readFileSync(join(root, f), 'utf8'))

// ── 规则① 令牌定义集 ───────────────────────────────────────────
const defined = new Set()
/** 令牌名 → 定义处出现次数（供规则⑦ 用「总出现数 − 定义数」判活） */
const defSites = new Map()
/** 令牌名 → 全项目总出现次数（含定义处） */
const mentions = new Map()
// 动态定义的「令牌族」：--fog- 由 zen.ts 的 setProperty(`--fog-${i+1}`) 注入，
// --lv 由 FileTree 的 :style 绑定注入。二者无法被静态扫描枚举出完整名，故按前缀放行。
const dynamicPrefixes = new Set()
for (const f of files) {
  const s = read(f)
  // CSS 声明
  for (const m of s.matchAll(/(^|[\s;{])(--[a-zA-Z0-9-]+)\s*:/g)) {
    defined.add(m[2])
    defSites.set(m[2], (defSites.get(m[2]) ?? 0) + 1)
  }
  // Vue 内联 style 绑定的键名：{ '--lv': level }
  for (const m of s.matchAll(/['"](--[a-zA-Z0-9-]+)['"]\s*:/g)) defined.add(m[1])
  // JS 注入：root.style.setProperty(`--fog-${i + 1}`, ...)
  for (const m of s.matchAll(/setProperty\(\s*[`'"](--[a-zA-Z0-9-]*)/g)) {
    dynamicPrefixes.add(m[1])
    defined.add(m[1])
  }
  // 总出现次数：`--x` 后不接词字符/连字符，避免 --fs-1 被 --fs-10 误计
  for (const m of s.matchAll(/--[a-zA-Z0-9-]+(?![a-zA-Z0-9-])/g)) {
    mentions.set(m[0], (mentions.get(m[0]) ?? 0) + 1)
  }
}

const isDefined = (name) =>
  defined.has(name) || [...dynamicPrefixes].some((p) => p.endsWith('-') && name.startsWith(p))

const failures = []
const pass = []

// ── 规则① 伪令牌 ───────────────────────────────────────────────
const undefinedTokens = new Map()
for (const f of files) {
  const s = read(f)
  for (const m of s.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    if (isDefined(m[1])) continue
    if (!undefinedTokens.has(m[1])) undefinedTokens.set(m[1], new Set())
    undefinedTokens.get(m[1]).add(f)
  }
}
if (undefinedTokens.size) {
  failures.push(
    `伪令牌 ${undefinedTokens.size} 个（已定义集中查无此名 → 整条声明被静默丢弃）：\n      ` +
      [...undefinedTokens.entries()]
        .sort()
        .map(([n, fs]) => `${n}  ← ${[...fs].join(', ')}`)
        .join('\n      '),
  )
} else {
  pass.push('无伪令牌（var() 引用的每个令牌都有定义）')
}

// ── 规则② z-index ─────────────────────────────────────────────
const badZ = []
for (const f of files) {
  const s = read(f)
  s.split('\n').forEach((line, i) => {
    const m = line.match(/(^|[\s;{])z-index:\s*(\d+)/)
    if (m) badZ.push(`${f}:${i + 1}  z-index: ${m[2]}`)
  })
}
if (badZ.length) {
  failures.push(
    `z-index 写裸数字 ${badZ.length} 处（须用 --z-* 语义令牌）：\n      ` + badZ.join('\n      '),
  )
} else {
  pass.push('z-index 全部走 --z-* 语义阶梯')
}

// ── 规则③ border-radius ───────────────────────────────────────
const badRadius = []
for (const f of files) {
  const s = read(f)
  for (const m of s.matchAll(/(^|[\s;{])border-radius:\s*([^;}]+)/g)) {
    // 允许：令牌本身、令牌派生的 calc、四角语法（0 var(...) var(...) 0）、纯 0
    const rest = m[2]
      .replace(/!important/g, '')
      .replace(/var\(--radius-[a-z]+\)/g, 'T')
      .replace(/calc\(.*\)/g, 'C')
      .replace(/[TC\s,0]/g, '')
    if (rest !== '') badRadius.push(`${f}  border-radius: ${m[2].trim()}`)
  }
}
if (badRadius.length) {
  failures.push(
    `border-radius 未走刻度 ${badRadius.length} 处（须用 --radius-xs/sm/md/lg/xl/pill/full）：\n      ` +
      badRadius.join('\n      '),
  )
} else {
  pass.push('border-radius 全部走 --radius-* 刻度')
}

// ── 规则④ 写死颜色 ─────────────────────────────────────────────
// 允许清单：确有理由脱离主题的**字面量**，逐条注明原因。空着才是常态。
const COLOR_ALLOW = {
  // 导出产物的预览区必须是「纸白底」——它模仿的是导出 HTML 的阅读型配色，
  // 而导出模板 (src/export/docTemplate.ts) 是独立样式上下文、恒为浅色。
  // 预览若跟随暗色皮肤，就不再「所见即所得」，这个功能的价值直接归零。
  'src/components/ExportPreview.vue': ['#fcfcfb'],
}
const COLOR_PROPS = ['color', 'background', 'background-color', 'border-color', 'border-top-color', 'border-bottom-color', 'outline-color', 'fill', 'stroke']
const hardColors = []
for (const f of files) {
  if (f.endsWith('tokens.css')) continue
  const allow = COLOR_ALLOW[f] ?? []
  const s = read(f)
  const re = new RegExp(`(?:^|[;{\\s])(?:${COLOR_PROPS.join('|')})\\s*:\\s*([^;}]+)`, 'g')
  for (const m of s.matchAll(re)) {
    const v = m[1].trim()
    if (!/#[0-9a-fA-F]{3,8}\b/.test(v) || v.includes('var(')) continue
    if (allow.some((a) => v.includes(a))) continue
    hardColors.push(`${f}  ${v}`)
  }
}
if (hardColors.length) {
  failures.push(
    `颜色写死 ${hardColors.length} 处（换皮肤 / 明暗会错位，须走 --hue-* 令牌）：\n      ` +
      hardColors.join('\n      '),
  )
} else {
  pass.push('无写死 hex 颜色（tokens.css 与导出模板除外）')
}

// ── 规则⑤ 字号 ─────────────────────────────────────────────────
const fontLegacySeen = {}
const badFont = []
for (const f of files) {
  const s = read(f)
  for (const m of s.matchAll(/(^|[\s;{])font-size:\s*([^;}]+)/g)) {
    const v = m[2].trim().replace(/\s*!important$/, '')
    if (v.startsWith('var(--fs-')) continue
    if (/^[\d.]+(em|rem|%)$/.test(v)) continue // 相对单位天然随上下文缩放
    if (v in FONT_LEGACY) {
      fontLegacySeen[v] = (fontLegacySeen[v] ?? 0) + 1
      continue
    }
    badFont.push(`${f}  font-size: ${v}`)
  }
}
const fontRegressions = Object.entries(fontLegacySeen).filter(([v, n]) => n > FONT_LEGACY[v])
if (badFont.length || fontRegressions.length) {
  if (badFont.length) {
    failures.push(
      `字号不在刻度内 ${badFont.length} 处（须用 --fs-*，10/11/12/13/14/15/16/18/22/28）：\n      ` +
        badFont.join('\n      '),
    )
  }
  if (fontRegressions.length) {
    failures.push(
      `冻结遗留字号增长：` +
        fontRegressions.map(([v, n]) => `${v} ${FONT_LEGACY[v]} → ${n}`).join('、') +
        `\n      （半像素档只减不增；要加先改 scripts/check-design.mjs 的 FONT_LEGACY 并说明原因）`,
    )
  }
} else {
  const debt = Object.values(FONT_LEGACY).reduce((a, b) => a + b, 0)
  pass.push(`字号全部走 --fs-* 或冻结遗留档（遗留债务 ${debt} 处，只减不增）`)
}

// ── 规则⑥ 间距 ─────────────────────────────────────────────────
const SPACE_PROPS = ['padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'gap', 'row-gap', 'column-gap']
const spaceLegacySeen = {}
const badSpace = []
for (const f of files) {
  const s = read(f)
  const re = new RegExp(`(?:^|[;{\\s])(?:${SPACE_PROPS.join('|')})\\s*:\\s*([^;}]+)`, 'g')
  for (const m of s.matchAll(re)) {
    const value = m[1].trim().replace(/\s*!important$/, '')
    // 含函数或相对/视口单位的一律不按 px 栅格判：
    //   `max(24px, calc(var(--w-column) / 2))`、`45vh`、`1.6em` 是上下文相关的表达，
    //   不属「间距档位」的范畴。机械去判只会造出假阳性。
    if (/[()]|vh|vw|vmin|vmax|em|rem|%|ch|var\(/.test(value)) continue
    for (const t of value.split(/\s+/)) {
      if (/^-?[\d.]+px$/.test(t)) {
        const n = Math.abs(parseFloat(t))
        if (t in SPACE_LEGACY) {
          spaceLegacySeen[t] = (spaceLegacySeen[t] ?? 0) + 1
        } else if (n >= 32 && n % 8 !== 0) {
          badSpace.push(`${f}  ${t}（≥32px 须为 8 的倍数）`)
        }
      } else if (!/^(0|auto|inherit|normal)$/.test(t)) {
        badSpace.push(`${f}  ${t}（须为整数 px）`)
      }
    }
  }
}
const spaceRegressions = Object.entries(spaceLegacySeen).filter(([v, n]) => n > SPACE_LEGACY[v])
if (badSpace.length || spaceRegressions.length) {
  if (badSpace.length) {
    failures.push(`间距不合栅格 ${badSpace.length} 处：\n      ` + badSpace.join('\n      '))
  }
  if (spaceRegressions.length) {
    failures.push(
      `冻结遗留间距增长：` +
        spaceRegressions.map(([v, n]) => `${v} ${SPACE_LEGACY[v]} → ${n}`).join('、'),
    )
  }
} else {
  pass.push('间距全部为整数 px，大间距走 8 的倍数')
}

// ── 规则⑦ 零引用令牌 ───────────────────────────────────────────
// 判活口径：`总出现次数 − 定义处次数 > 0`。用「出现」而非「var() 引用」是因为
// 令牌也可能被 JS 消费（`getPropertyValue('--x')`、`:style="{ '--x': v }"`），
// 只数 var() 会把这些误判成死令牌、造出假阳性。
// 动态令牌族（`--fog-*`）从不出现在 defined 里，天然不会被本规则扫到。
//
// **例外：对外契约令牌。** `--crepe-*` 是为 Crepe/Milkdown 声明的**覆盖入口**——
// 我们只负责把值喂进去，真正的消费者是库自己的 CSS（在 node_modules 里），
// 所以「零引用」是它的正常状态，不是谎言。删掉会让编辑器回落到 Crepe 原生配色
// （近黑底 + 灰边），正是「组件原生、和软件风格不搭」的来源。
const EXTERNAL_CONTRACT = [/^--crepe-/]
const deadTokens = []
for (const name of defined) {
  if (dynamicPrefixes.has(name)) continue
  if (EXTERNAL_CONTRACT.some((re) => re.test(name))) continue
  const used = (mentions.get(name) ?? 0) - (defSites.get(name) ?? 0)
  if (used <= 0) deadTokens.push(name)
}
if (deadTokens.length) {
  failures.push(
    `零引用令牌 ${deadTokens.length} 个（定义了但全项目没人用 → 源码里的谎言，` +
      `它不参与主题切换，照用必错）：\n      ` +
      deadTokens.sort().map((n) => `${n}  （声明 ${defSites.get(n) ?? 1} 处，引用 0 处）`).join('\n      ') +
      `\n      处理：删掉声明（过时的不留兼容层），或把现有裸值改成引用它。`,
  )
} else {
  pass.push(`无零引用令牌（${defined.size} 个令牌全部有消费者）`)
}

// ── 输出 ───────────────────────────────────────────────────────
for (const line of pass) console.log(`  \x1b[32mPASS\x1b[0m ${line}`)
if (failures.length) {
  console.log(`\n\x1b[31m设计门禁失败：\x1b[0m`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  console.log(
    '\n字号 / 间距的冻结档若确需放宽，请改 scripts/check-design.mjs 并在提交信息里说明原因；' +
      '\n其余五类规则零容忍——它们是「改了看不出来、测试全绿」的高发区（见 docs/UI-DESIGN.md §9）。',
  )
  process.exit(1)
}
console.log(`\n\x1b[32mdesign check: OK\x1b[0m (${files.length} files scanned)\n`)
