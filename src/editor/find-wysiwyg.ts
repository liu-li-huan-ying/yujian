import type { EditorView } from '@milkdown/prose/view'
import { TextSelection } from '@milkdown/prose/state'

/**
 * 所见即所得模式的文件内查找（ProseMirror / Milkdown）。
 *
 * 设计纪律（绝不破坏编辑器红线）：
 * - 不向 Crepe 注入任何 decoration plugin —— 仅用 ProseMirror 原生的
 *   TextSelection 把「当前命中」设为选区（编辑器天然高亮选区），
 *   并 scrollIntoView 定位 + 计数 + 替换，零侵入、零风险。
 * - 只收集「完全落在同一 text 节点内」的匹配，保证可安全选中和替换；
 *   跨节点的边界匹配（极少见）不参与，避免破坏文档结构。
 */

export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface WysiwygMatch {
  from: number
  to: number
}

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

/** 遍历文档收集所有「同 text 节点内」的命中位置 */
export function findMatchesInDoc(
  view: EditorView,
  query: string,
  opts: FindOptions
): WysiwygMatch[] {
  const re = buildRegex(query, opts)
  if (!re) return []
  const matches: WysiwygMatch[] = []
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      const from = pos + m.index
      const to = from + m[0].length
      matches.push({ from, to })
    }
  })
  return matches
}

/** 选中某一命中并滚动到可见 */
export function selectMatch(view: EditorView, match: WysiwygMatch): void {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to))
  tr.scrollIntoView()
  view.dispatch(tr)
}

/** 替换单个命中（空串视为删除） */
export function replaceMatch(view: EditorView, match: WysiwygMatch, replacement: string): void {
  const { schema } = view.state
  const tr = replacement
    ? view.state.tr.replaceWith(match.from, match.to, schema.text(replacement))
    : view.state.tr.delete(match.from, match.to)
  view.dispatch(tr)
}

/** 从后往前替换全部命中，返回数量（单次 dispatch，位置稳定） */
export function replaceAllInDoc(
  view: EditorView,
  query: string,
  opts: FindOptions,
  replacement: string
): number {
  const matches = findMatchesInDoc(view, query, opts)
  if (!matches.length) return 0
  let tr = view.state.tr
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    tr =
      replacement === ''
        ? tr.delete(m.from, m.to)
        : tr.replaceWith(m.from, m.to, view.state.schema.text(replacement))
  }
  view.dispatch(tr)
  return matches.length
}
