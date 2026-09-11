import { diffLines } from 'diff'

/**
 * 快照 diff 引擎（纯函数）。
 *
 * 从 SnapshotPanel.vue 抽出：hunk 聚合里的「行号累计」（baseOld / baseNew 推进）
 * 与并排配对是最易错的一段逻辑，原先是组件内 computed、零覆盖。
 * 抽成纯模块后可脱离 Vue 单测（见 scripts/test-core.mjs 的 [I] 段）。
 * 本文件不得引入任何 Vue / Electron 依赖。
 */

export type DiffRowType = 'add' | 'del' | 'ctx'

export interface DiffRow {
  type: DiffRowType
  /** 模板不重算，直接显式带上前缀字符 */
  prefix: string
  text: string
}

export interface DiffHunk {
  rows: DiffRow[]
  /** B 侧（快照 / 对比中的 B）新增或修改的内容；纯删除段为空 */
  pickText: string
  kind: 'add' | 'del' | 'mod'
  end: number
  oldStart: number
  newStart: number
  oldSpan: number
  newSpan: number
}

export interface SplitRow {
  left: { type: 'del' | 'ctx'; text: string } | null
  right: { type: 'add' | 'ctx'; text: string } | null
}

/** 把两段文本摊平成「逐行」diff 列表，便于模板渲染。任一侧为 null 视为无 diff。 */
export function buildDiffRows(a: string | null, b: string | null): DiffRow[] {
  if (a == null || b == null) return []
  const parts = diffLines(a, b)
  const out: DiffRow[] = []
  for (const p of parts) {
    const body = p.value.endsWith('\n') ? p.value.slice(0, -1) : p.value
    const type: DiffRowType = p.added ? 'add' : p.removed ? 'del' : 'ctx'
    const prefix = p.added ? '+' : p.removed ? '-' : ' '
    for (const line of body.split('\n')) out.push({ type, prefix, text: line })
  }
  return out
}

/** 是否存在实际变更（非纯上下文） */
export function hasChanges(rows: DiffRow[]): boolean {
  return rows.some((r) => r.type !== 'ctx')
}

/** 增 / 删行数统计 */
export function diffStats(rows: DiffRow[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const r of rows) {
    if (r.type === 'add') add++
    else if (r.type === 'del') del++
  }
  return { add, del }
}

/**
 * 把扁平 diff 按「变更段」聚合成 hunks（相邻变更合并、±1 行上下文、边界不重叠）。
 * 每个 hunk 的 pickText = B 侧新增或修改的内容——即「从旧版/对比方摘一段回来」
 * 要插入当前文档的原文。纯删除段没有可摘取的来源，pickText 为空。
 */
export function buildHunks(rows: DiffRow[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].type === 'ctx') {
      i++
      continue
    }
    let j = i
    while (j < rows.length && rows[j].type !== 'ctx') j++
    let start = Math.max(0, i - 1)
    const end = Math.min(rows.length, j + 1)
    if (hunks.length && start < hunks[hunks.length - 1].end) start = hunks[hunks.length - 1].end
    const slice = rows.slice(start, end)
    const pickLines = slice.filter((r) => r.type === 'add').map((r) => r.text)
    const pickText = pickLines.length ? `${pickLines.join('\n')}\n` : ''
    const hasAdd = slice.some((r) => r.type === 'add')
    const hasDel = slice.some((r) => r.type === 'del')
    const kind: DiffHunk['kind'] = hasAdd && hasDel ? 'mod' : hasAdd ? 'add' : 'del'
    // hunk 起始行号 = 该 hunk 之前各侧累计行数 + 1（GitHub `@@ -old,span +new,span @@`）。
    // 旧实现把 slice 内的上下文行重复计入 baseOld/baseNew，导致行号整体偏大——已修正。
    let oldStart = 1
    let newStart = 1
    for (let k = 0; k < start; k++) {
      const t = rows[k].type
      if (t !== 'add') oldStart++
      if (t !== 'del') newStart++
    }
    const oldSpan = slice.filter((r) => r.type !== 'add').length
    const newSpan = slice.filter((r) => r.type !== 'del').length
    hunks.push({ rows: slice, pickText, kind, end, oldStart, newStart, oldSpan, newSpan })
    i = j
  }
  return hunks
}

/** 并排视图（GitHub split）：把连续 del/add 配对，ctx 两侧对齐 */
export function splitPairs(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.type === 'ctx') {
      out.push({ left: { type: 'ctx', text: r.text }, right: { type: 'ctx', text: r.text } })
      i++
    } else if (r.type === 'del') {
      let j = i
      while (j < rows.length && rows[j].type === 'del') j++
      let k = j
      while (k < rows.length && rows[k].type === 'add') k++
      const dels = rows.slice(i, j)
      const adds = rows.slice(j, k)
      const n = Math.max(dels.length, adds.length)
      for (let m = 0; m < n; m++) {
        out.push({
          left: dels[m] ? { type: 'del', text: dels[m].text } : null,
          right: adds[m] ? { type: 'add', text: adds[m].text } : null
        })
      }
      i = k
    } else {
      out.push({ left: null, right: { type: 'add', text: r.text } })
      i++
    }
  }
  return out
}
