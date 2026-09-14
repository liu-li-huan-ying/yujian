/**
 * 结构诊断（**只读**，不设阈值、全部列出）—— 回答「这次该抽哪一块」。
 *
 * 与 `check-structure.mjs` 的分工：那个是**门禁**（有阈值、超标即 CI 失败）；
 * 本脚本是**体检报告**（信息完整、供人判断）。
 * 两者共用 `lib/depgraph.mjs`，确保规则不分叉。
 *
 * 输出顺序按「架构坏味道 → 可动手清单」排列：循环依赖 → 分层越界 →
 * 上帝模块 / Hub → 胖文件分布。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, buildGraph } from './lib/depgraph.mjs'

const { files, deps, metrics, cycles, selfLoops, violations } = buildGraph()
const edges = [...deps.values()].reduce((a, b) => a + b.length, 0)

const out = []
const say = (s = '') => out.push(s)

say('# 结构分析（只读诊断）\n')
say(`扫描 ${metrics.length} 个文件 · 内部依赖边 ${edges} 条\n`)

say('## 1. 循环依赖（Tarjan 强连通分量）\n')
if (!cycles.length && !selfLoops.length) {
  say('✅ 无循环依赖\n')
} else {
  for (const c of cycles) {
    say(`### 环（${c.length} 个文件）`)
    for (const f of c) {
      const inner = deps.get(f).filter((d) => c.includes(d))
      say(`- \`${f}\` → ${inner.map((x) => '`' + x + '`').join(', ')}`)
    }
    say('')
  }
  for (const f of selfLoops) say(`- 自环：\`${f}\``)
  say('')
}

say('## 2. 分层越界\n')
if (!violations.length) say('✅ 无越界\n')
else {
  for (const v of violations) say(`- [${v.rule}]\n  \`${v.from}\` → \`${v.to}\``)
  say('')
}

const table = (title, list, head) => {
  say(`### ${title}`)
  say(`| ${head[0]} | 文件 | ${head[1]} |`)
  say('| --- | --- | --- |')
  for (const m of list) say(`| ${head[2](m)} | \`${m.file}\` | ${head[3](m)} |`)
  say('')
}

say('## 3. 上帝模块 / Hub 排行\n')
table('行数 Top 20', [...metrics].sort((a, b) => b.lines - a.lines).slice(0, 20), [
  '行数',
  '导出 / 扇入 / 扇出',
  (m) => m.lines,
  (m) => `${m.expCount} / ${m.fanIn} / ${m.fanOut}`,
])
table(
  '扇入 Top 12（被依赖最多 = 真实核心）',
  [...metrics].sort((a, b) => b.fanIn - a.fanIn).slice(0, 12),
  ['扇入', '行数', (m) => m.fanIn, (m) => m.lines],
)
table(
  '扇出 Top 12（依赖最多 = 最易受牵连）',
  [...metrics].sort((a, b) => b.fanOut - a.fanOut).slice(0, 12),
  ['扇出', '行数', (m) => m.fanOut, (m) => m.lines],
)
table(
  '单文件导出符号 Top 12（接口面过宽 = 未分层）',
  [...metrics].sort((a, b) => b.expCount - a.expCount).slice(0, 12),
  ['导出数', '行数', (m) => m.expCount, (m) => m.lines],
)

say('### 文件数 ≥ 8 的目录（是否已分层）')
const byDir = new Map()
for (const m of metrics) {
  const d = m.file.slice(0, m.file.lastIndexOf('/'))
  if (!byDir.has(d)) byDir.set(d, [])
  byDir.get(d).push(m)
}
for (const [d, ms] of [...byDir].sort((a, b) => b[1].length - a[1].length)) {
  if (ms.length < 8) continue
  const tot = ms.reduce((a, b) => a + b.lines, 0)
  say(`- \`${d}/\`：${ms.length} 文件 / ${tot} 行 / 最大 ${Math.max(...ms.map((x) => x.lines))} 行`)
}
say('')

say('## 4. 胖文件分布（≥600 行）\n')
const fat = metrics.filter((m) => m.lines >= 600).sort((a, b) => b.lines - a.lines)
say(`共 ${fat.length} 个（占 ${metrics.length} 文件的 ${Math.round((fat.length / metrics.length) * 100)}%）\n`)
say('| 行数 | 文件 |')
say('| --- | --- |')
for (const m of fat) say(`| ${m.lines} | \`${m.file}\` |`)

const report = out.join('\n')
const target = join(ROOT, 'docs', '_structure-analysis.md')
writeFileSync(target, report + '\n', 'utf-8')
console.log(report)
console.log(`\n（已写入 docs/_structure-analysis.md，${files.length} 文件）`)
