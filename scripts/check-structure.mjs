/**
 * 结构健康门禁 —— 防「劣化回潮」，而不是查正确性（正确性归 `npm run check`）。
 *
 * 为什么需要它：2026-09-14 审计（docs/AUDIT-2026-09-14.md）发现两件事都靠人肉才看出来：
 *   1. `App.vue` 在 09-10 抽过一次 composable 降到 1683，新功能一压又涨回 1789；
 *   2. `any` 从 61 → 44 → 43，降幅停滞，且没有任何东西阻止它反弹。
 * 这两类问题都不会让测试变红，只会让代码慢慢变形。故把「上限」写成可执行断言，
 * 超标即 CI 失败 —— 想放宽必须**显式改这个阈值并说明原因**，而不是悄悄涨上去。
 *
 * 四类规则（全部进 CI）：
 *   ① 行数上限（默认 1700 / 目录级 / 文件级三级覆盖）
 *   ② `any` 逃逸「总量只减不增 + 白名单外即失败」
 *   ③ 无 TODO / FIXME / HACK 遗留标记
 *   ④ 依赖图：无循环依赖（Tarjan SCC）、无自环、无分层越界
 *
 * 只扫生产代码（`src/` + `electron/`）；`scripts/` 下的测试脚本不设行数限制
 * （`test-core.mjs` 本就是线性堆叠的断言集合，拆分反而更难读）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { buildGraph } from './lib/depgraph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/** 行数上限：默认适用于所有生产文件，目录级与文件级可分别收紧（文件级优先） */
const MAX_LINES_DEFAULT = 1700
const MAX_LINES_BY_FILE = {
  // 抽出 useToast / useFileConflict / useZenMode / useWindowLayout 后为 1458，留 ~40 行余量；
  // 与 Sidebar 同等对待（组件级一律 1500），再涨说明又有该抽的块了
  'src/App.vue': 1500,
  // 抽出 useSidebarSearch 后为 1436，留 64 行余量；涨破即该再抽一轮
  'src/components/Sidebar.vue': 1500,
  // 纯常量 + 类型表（645 行、无逻辑分支），拆开只增记账成本、无结构性收益
  'electron/shared/ipc-channels.ts': 700,
}
/**
 * 目录级上限：主进程是「上帝模块」的重灾区 ——
 * `vault.ts` 1134 / `vaultIndex.ts` 1045 / `index.ts` 618 三个胖文件 2026-09-15 才刚拆成包
 * （见 docs/review/AUDIT-STRUCTURE-2026-09-15.md §五·3）。若不留这一条，
 * 同样的堆积会顺着 1700 的默认阈值悄悄长回来。
 * 当前最大 `vault/treeOps.ts` 431 行、余量 19 行 —— 涨破即说明该再拆 treeOps。
 */
const MAX_LINES_BY_DIR = {
  'electron/main/': 450,
}
const limitFor = (rel) => {
  if (MAX_LINES_BY_FILE[rel] !== undefined) return MAX_LINES_BY_FILE[rel]
  for (const [dir, max] of Object.entries(MAX_LINES_BY_DIR)) {
    if (rel.startsWith(dir)) return max
  }
  return MAX_LINES_DEFAULT
}
/**
 * `any` 逃逸：既控总量，更控**越界**。
 *
 * 61 处全部集中在 `src/editor/features/` 的 5 个文件——那里是 ProseMirror / Milkdown
 * 第三方 AST 边界，节点类型无法从包里导出完整类型，强制标 `any` 属合理妥协。
 * 真正危险的不是「有多少」，而是**它扩散到核心逻辑**：一旦 `vault` / 索引 /
 * 序列化里出现 `any`，Markdown 往返保真就失去类型护栏。故设白名单：
 * 白名单外出现哪怕 1 处 `any` 也直接失败，白名单内则走总量「只减不增」。
 */
const MAX_ANY = 61
const ANY_ALLOWED_PREFIX = 'src/editor/features/'
/** 遗留标记必须为零 */
const BANNED_MARKERS = /\b(TODO|FIXME|XXX|HACK|WORKAROUND)\b/g

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'release', 'dist', 'assets'])
const EXTS = /\.(ts|vue)$/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.test(name)) out.push(p)
  }
  return out
}

const files = [...walk(join(root, 'src')), ...walk(join(root, 'electron'))]

const ANY_RE = /(\bas\s+any\b|<any>|:[ \t]*(?:any\[\]|any)\b|\bany\[\]\b)/g

let anyCount = 0
const anyByFile = new Map()
const anyOutside = []
const tooLong = []
const markers = []

for (const file of files) {
  const src = readFileSync(file, 'utf-8')
  const rel = relative(root, file).split(sep).join('/')

  // any 逃逸。用**单一交替**而非分别匹配：分别匹配会让 `: any[]` 被 `:[ \t]*any\b`
  // 和 `any[]` 各计一次，导致总数虚高、阈值失真。
  const hits = src.match(ANY_RE)
  if (hits) {
    anyCount += hits.length
    anyByFile.set(rel, hits.length)
    if (!rel.startsWith(ANY_ALLOWED_PREFIX)) anyOutside.push(`${rel}: ${hits.length} 处`)
  }

  const lines = src.split('\n').length
  const limit = limitFor(rel)
  if (lines > limit) tooLong.push({ rel, lines, limit })

  BANNED_MARKERS.lastIndex = 0
  let m
  while ((m = BANNED_MARKERS.exec(src))) markers.push(`${rel}: ${m[1]}`)
}

const failures = []
const pass = []

if (anyOutside.length) {
  failures.push(
    `any 逃逸越界 ${anyOutside.length} 个文件（只允许出现在 ${ANY_ALLOWED_PREFIX}*）：\n      ` +
      anyOutside.join('\n      '),
  )
} else {
  pass.push(`any 逃逸未越界（全部位于 ${ANY_ALLOWED_PREFIX}*）`)
}

if (anyCount > MAX_ANY) {
  failures.push(`any 逃逸 ${anyCount} 处 > 上限 ${MAX_ANY}（应只减不增）`)
} else {
  pass.push(`any ${anyCount} ≤ ${MAX_ANY}`)
}

if (tooLong.length) {
  for (const t of tooLong) failures.push(`${t.rel} ${t.lines} 行 > 上限 ${t.limit}`)
} else {
  pass.push(
    `文件行数均在上限内（默认 ${MAX_LINES_DEFAULT}，electron/main/ ${MAX_LINES_BY_DIR['electron/main/']}，` +
      `App.vue / Sidebar.vue ${MAX_LINES_BY_FILE['src/App.vue']}）`,
  )
}

if (markers.length) {
  failures.push(`遗留标记 ${markers.length} 处：${markers.slice(0, 5).join(', ')}`)
} else {
  pass.push('无 TODO / FIXME / HACK 遗留标记')
}

// ── 依赖图：循环依赖 / 自环 / 分层越界 ──
// 规则与诊断脚本 analyze-structure.mjs 共用 lib/depgraph.mjs —— 若各写一份，
// 就会出现「诊断说没问题、门禁说有问题」的荒谬局面。
// ⚠️ 本段曾长期缺失：depgraph.mjs 的注释一直宣称「门禁共用」，但门禁从未引用它，
// 于是循环依赖与分层越界实际上没有任何 CI 保护。
{
  const { cycles, selfLoops, violations } = buildGraph()
  if (cycles.length || selfLoops.length) {
    const detail = [
      ...cycles.map((c) => c.join(' ↔ ')),
      ...selfLoops.map((f) => `${f}（自环）`),
    ].join('\n      ')
    failures.push(`循环依赖 ${cycles.length} 环 / 自环 ${selfLoops.length} 处：\n      ${detail}`)
  } else {
    pass.push('无循环依赖（Tarjan 强连通分量）')
  }

  if (violations.length) {
    failures.push(
      `分层越界 ${violations.length} 处：\n      ` +
        violations.map((v) => `[${v.ruleId}] ${v.from} → ${v.to}`).join('\n      '),
    )
  } else {
    pass.push('分层无越界（渲染层 / 主进程 / 纯逻辑层）')
  }
}

for (const line of pass) console.log(`  \x1b[32mPASS\x1b[0m ${line}`)
if (failures.length) {
  console.log(`\n\x1b[31m结构门禁失败：\x1b[0m`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  console.log(
    '\n若为有意放宽，请修改 scripts/check-structure.mjs 的阈值并在提交信息里说明原因；' +
      '\n否则说明又有该抽的块了（见 docs/AUDIT-2026-09-14.md §四）。',
  )
  process.exit(1)
}
console.log(`\n\x1b[32mstructure check: OK\x1b[0m (${files.length} files scanned)\n`)
