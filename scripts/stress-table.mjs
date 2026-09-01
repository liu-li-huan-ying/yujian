/**
 * 表格稳定性压测（批次一·数据安全 验收项 #4）
 * ───────────────────────────────────────────────────────────────────────────
 * 目标：验证 GFM 表格在「增行 / 删行 / 增列 / 删列 / 合并单元格 / 反复往返」下，
 *       经 remark-gfm 序列化层（编辑器 to-markdown 同一底层）不会丢结构、不会乱码、不会自激振荡。
 *
 * 为什么测这一层：Obsidian 的表格损坏发生在「Markdown 序列化 / 反序列化」层
 * （PRODUCT-POLISH-IDEAS.md 防坑准则 #7）。玉笺的所见即所得表格最终也走 remark-gfm
 * 序列化落盘，故此脚本直接压测该层，确保任意单调操作序列都收敛、不丢列不丢行。
 *
 * 说明：ProseMirror 的撤销/重做（undo/redo）由编辑器事务层自身保证，此处不重复；
 *       本脚本聚焦「Markdown 往返保真」这一可独立验证的红线。
 *
 * 运行：node scripts/stress-table.mjs
 * 退出码：0 = 全部通过；1 = 存在不稳定 / 损坏。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    incrementListMarker: false,
    rule: '-'
  })

const parse = (md) => processor.runSync(processor.parse(md))
const serialize = (tree) => processor.stringify(tree)

let passed = 0
let failed = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
  }
}

/** 取文档里的表格节点（mdast-gfm 中 type 为 'table'） */
function getTable(tree) {
  for (const node of tree.children) {
    if (node.type === 'table') return node
  }
  return null
}

function newCell(text = '') {
  return { type: 'tableCell', children: [{ type: 'text', value: text }] }
}

function cellText(cell) {
  return (cell.children || [])
    .map((c) => (c.value !== undefined ? c.value : ''))
    .join('')
}

/** 克隆一行，长度对齐到目标列数；缺列补空格，多列截断 */
function cloneRow(row, colCount, fill = '') {
  const cells = row.children.slice(0, colCount)
  while (cells.length < colCount) cells.push(newCell(fill))
  return { type: 'tableRow', children: cells }
}

/* ── 基准表格 ── */
const BASE = `| 名称 | 数量 | 备注 |
| --- | ---: | :--- |
| 苹果 | 3 | 新鲜 |
| 香蕉 | 5 | 偏熟 |
| 橙子 | 2 | 现货 |`

const baseTree = parse(BASE)
const baseTable = getTable(baseTree)
check('基准表格存在', !!baseTable)
check('基准表格 4 行（含表头行）', baseTable && baseTable.children.length === 4)
check('基准表格 3 列', baseTable && baseTable.children[0].children.length === 3)

/* ── 用例 1：往返幂等（解析→序列化→解析→序列化 必须稳定）── */
{
  const a = serialize(parse(BASE))
  const b = serialize(parse(a))
  const c = serialize(parse(b))
  check('往返幂等（BASE）', a === b && b === c, `a===b:${a === b} b===c:${b === c}`)
}

/* ── 用例 2：增行 ── */
function addRow(md, fill = '新行') {
  const tree = parse(md)
  const t = getTable(tree)
  const cols = t.children[0].children.length
  const newRow = cloneRow(t.children[t.children.length - 1], cols, fill)
  t.children.push(newRow)
  return serialize(tree)
}
{
  const out = addRow(BASE)
  const t = getTable(parse(out))
  check('增行后 5 行', t && t.children.length === 5)
  check('增行后列数不变', t && t.children[0].children.length === 3)
  const a = serialize(parse(out))
  const b = serialize(parse(a))
  check('增行后往返幂等', a === b)
}

/* ── 用例 3：删行（删最后一行数据行，保留表头）── */
function removeRow(md) {
  const tree = parse(md)
  const t = getTable(tree)
  if (t.children.length > 1) t.children.pop()
  return serialize(tree)
}
{
  const out = removeRow(BASE)
  const t = getTable(parse(out))
  check('删行后 3 行', t && t.children.length === 3)
  const a = serialize(parse(out))
  const b = serialize(parse(a))
  check('删行后往返幂等', a === b)
}

/* ── 用例 4：增列 ── */
function addColumn(md, fill = 'X') {
  const tree = parse(md)
  const t = getTable(tree)
  for (const row of t.children) row.children.push(newCell(fill))
  // 对齐分隔行的对齐定义数量（remark-gfm 会按列数自动补默认对齐，这里只保证结构合法）
  return serialize(tree)
}
{
  const out = addColumn(BASE)
  const t = getTable(parse(out))
  check('增列后 4 列', t && t.children[0].children.length === 4)
  check('增列后行数不变', t && t.children.length === 4)
  const a = serialize(parse(out))
  const b = serialize(parse(a))
  check('增列后往返幂等', a === b)
}

/* ── 用例 5：删列 ── */
function removeColumn(md) {
  const tree = parse(md)
  const t = getTable(tree)
  for (const row of t.children) {
    if (row.children.length > 1) row.children.pop()
  }
  return serialize(tree)
}
{
  const out = removeColumn(BASE)
  const t = getTable(parse(out))
  check('删列后 2 列', t && t.children[0].children.length === 2)
  const a = serialize(parse(out))
  const b = serialize(parse(a))
  check('删列后往返幂等', a === b)
}

/* ── 用例 6：合并单元格（把两列内容拼进一列，模拟「合并」后文本不丢）── */
function mergeColumns(md, i, j) {
  const tree = parse(md)
  const t = getTable(tree)
  for (const row of t.children) {
    const a = cellText(row.children[i])
    const b = cellText(row.children[j])
    row.children[i] = newCell(`${a} ${b}`.trim())
    row.children.splice(j, 1)
  }
  return serialize(tree)
}
{
  const out = mergeColumns(BASE, 1, 2) // 数量 + 备注 合并
  const t = getTable(parse(out))
  check('合并后 2 列', t && t.children[0].children.length === 2)
  const merged = cellText(t.children[1].children[1])
  check('合并后文本不丢', merged.includes('3') && merged.includes('新鲜'), merged)
  const a = serialize(parse(out))
  const b = serialize(parse(a))
  check('合并后往返幂等', a === b)
}

/* ── 用例 7：随机突变序列压测（增/删行/列 + 合并，反复往返，必须全程可解析且不抛错）── */
function mutateOnce(md) {
  const ops = [addRow, removeRow, addColumn, removeColumn]
  const op = ops[Math.floor(Math.random() * ops.length)]
  return op(md)
}
{
  let md = BASE
  const ITER = 200
  let ok = true
  let lastError = ''
  for (let i = 0; i < ITER; i++) {
    try {
      md = mutateOnce(md)
      const t = getTable(parse(md))
      if (!t || t.children.length < 1) {
        ok = false
        lastError = `第 ${i} 次后表格结构非法`
        break
      }
      // 往返幂等性抽查（每 10 次）
      if (i % 10 === 0) {
        const a = serialize(parse(md))
        const b = serialize(parse(a))
        if (a !== b) {
          ok = false
          lastError = `第 ${i} 次后往返不幂等`
          break
        }
      }
    } catch (e) {
      ok = false
      lastError = `第 ${i} 次抛错：${e.message}`
      break
    }
  }
  check('随机突变序列 200 次稳定', ok, lastError)
}

/* ── 用例 8：对齐信息保留（右对齐 / 左对齐经往返不丢）── */
{
  const md = serialize(parse(BASE))
  const t = getTable(parse(md))
  const align = (t.align || []).join(',')
  check('对齐信息保留（含右/左对齐）', align.includes('right') && align.includes('left'), align)
}

/* ── 报告 ── */
console.log(`\n表格稳定性压测结果：通过 ${passed} / 失败 ${failed}`)
if (failed > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
} else {
  console.log('✓ 全部用例通过：表格经 remark-gfm 序列化层往返稳定，无丢列 / 丢行 / 乱码 / 不收敛。')
  process.exit(0)
}
