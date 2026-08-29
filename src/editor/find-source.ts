import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'

/**
 * 源码模式的文件内查找（CodeMirror 6）。
 *
 * 用 StateField + Decoration 渲染命中高亮：当前命中用 `cm-find--current`，
 * 其余用 `cm-find`，样式在 editor.css 里统一（呼应玉质/玻璃体系）。
 * 替换从后往前执行，避免位置偏移；selection 变化不触发文档更新事件。
 */

export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

interface FindState {
  ranges: { from: number; to: number }[]
  current: number
}

const setFind = StateEffect.define<FindState>()

/** 注册到 SourceEditor 的 EditorView，承载查找高亮装饰 */
export const findField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setFind)) {
        const { ranges, current } = e.value
        const builder = new RangeSetBuilder<Decoration>()
        ranges.forEach((r, i) => {
          const cls = i === current ? 'cm-find cm-find--current' : 'cm-find'
          builder.add(r.from, r.to, Decoration.mark({ class: cls }))
        })
        deco = builder.finish()
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

function buildRegex(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null
  let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (opts.wholeWord) pattern = `\\b${pattern}\\b`
  const flags = opts.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function collectRanges(text: string, query: string, opts: FindOptions): { from: number; to: number }[] {
  const re = buildRegex(query, opts)
  const ranges: { from: number; to: number }[] = []
  if (!re) return ranges
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    ranges.push({ from: m.index, to: m.index + m[0].length })
  }
  return ranges
}

/**
 * 执行查找：高亮全部命中并选中 current 处。返回命中总数。
 */
export function findInView(
  view: EditorView,
  query: string,
  opts: FindOptions,
  current: number
): number {
  const ranges = collectRanges(view.state.doc.toString(), query, opts)
  const idx = ranges.length ? Math.max(0, Math.min(current, ranges.length - 1)) : 0
  view.dispatch({ effects: setFind.of({ ranges, current: idx }) })
  if (ranges.length) {
    const r = ranges[idx]
    view.dispatch({
      selection: { anchor: r.from, head: r.to },
      scrollIntoView: true
    })
  }
  return ranges.length
}

/** 跳转到指定序号的命中（重算并定位，保持与 findInView 一致） */
export function gotoInView(
  view: EditorView,
  query: string,
  opts: FindOptions,
  current: number
): void {
  findInView(view, query, opts, current)
}

/** 替换当前命中，返回替换后剩余命中总数 */
export function replaceOneInView(
  view: EditorView,
  query: string,
  opts: FindOptions,
  current: number,
  replacement: string
): number {
  const ranges = collectRanges(view.state.doc.toString(), query, opts)
  if (!ranges.length) return 0
  const idx = Math.max(0, Math.min(current, ranges.length - 1))
  const r = ranges[idx]
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: replacement },
    selection: { anchor: r.from + replacement.length }
  })
  return collectRanges(view.state.doc.toString(), query, opts).length
}

/** 从后往前替换全部命中，返回替换数量（避免位置偏移） */
export function replaceAllInView(
  view: EditorView,
  query: string,
  opts: FindOptions,
  replacement: string
): number {
  const ranges = collectRanges(view.state.doc.toString(), query, opts)
  if (!ranges.length) return 0
  for (let i = ranges.length - 1; i >= 0; i--) {
    view.dispatch({
      changes: { from: ranges[i].from, to: ranges[i].to, insert: replacement }
    })
  }
  return ranges.length
}

/** 清除查找高亮 */
export function clearFindInView(view: EditorView): void {
  view.dispatch({ effects: setFind.of({ ranges: [], current: 0 }) })
}
