import type { EditorView } from '@milkdown/prose/view'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'

/**
 * 所见即所得模式的文件内查找（ProseMirror / Milkdown）。
 *
 * 与源码模式（CodeMirror Decoration）保持一致的视觉语义：
 * - 用 ProseMirror 的 `Decoration.inline` 把**全部命中**常驻高亮（`.pm-find`），
 *   当前命中再加 `.pm-find--current` 强化（实强调色底 + 反相文字），
 *   满屏内容里一眼能看到所有命中位置，无需自行肉眼扫描。
 * - 装饰是视图层、不进文档模型，所以不影响 Markdown 往返保真（存档不写装饰）。
 * - 仅收集「完全落在同一 text 节点内」的匹配，保证可安全选中和替换；
 *   跨节点的边界匹配（极少见）不参与，避免破坏文档结构。
 *
 * 状态走插件（仿 zen 模式）：EditorHost 经 `tr.setMeta(findDecoKey, {ranges,current})`
 * 更新；文档变更时 ranges 经 `tr.mapping` 自动跟随，命中高亮不脱节。
 */

export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface WysiwygMatch {
  from: number
  to: number
}

/** 查找装饰插件的当前状态 */
interface FindDecoState {
  ranges: { from: number; to: number }[]
  current: number
}

export const findDecoKey = new PluginKey<FindDecoState>('yujian-find-deco')

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

/**
 * 选中某一命中并滚动到可见，同时刷新高亮装饰（当前命中强化）。
 * 合并为单次 dispatch：选区定位 + 装饰 meta + scrollIntoView，避免闪烁。
 */
export function applyFind(view: EditorView, matches: WysiwygMatch[], current: number): void {
  const idx = matches.length ? Math.max(0, Math.min(current, matches.length - 1)) : 0
  const tr = view.state.tr
  if (matches.length) {
    const m = matches[idx]
    tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to))
  }
  tr.setMeta(findDecoKey, { ranges: matches, current: idx })
  tr.scrollIntoView()
  view.dispatch(tr)
}

/** 清除查找高亮装饰（不改动选区/文档） */
export function clearFindDeco(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findDecoKey, { ranges: [], current: 0 }))
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

/** 查找装饰插件：常驻高亮全部命中，当前命中强化 */
export function createFindDecoPlugin(): Plugin {
  return new Plugin<FindDecoState>({
    key: findDecoKey,
    state: {
      init: () => ({ ranges: [], current: 0 }),
      apply(tr: Transaction, value: FindDecoState) {
        const meta = tr.getMeta(findDecoKey) as FindDecoState | undefined
        if (meta) return meta
        // 文档变更（替换/编辑/重渲染）时让命中跟随位置变化，避免高亮脱节
        if (!value.ranges.length) return value
        const mapped = value.ranges
          .map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }))
          .filter((r) => r.from < r.to)
        return { ranges: mapped, current: Math.min(value.current, Math.max(0, mapped.length - 1)) }
      }
    },
    props: {
      decorations(state) {
        const data = findDecoKey.getState(state)
        if (!data || data.ranges.length === 0) return DecorationSet.empty
        const decos = data.ranges.map((r, i) =>
          Decoration.inline(
            r.from,
            r.to,
            { class: i === data.current ? 'pm-find pm-find--current' : 'pm-find' }
          )
        )
        return DecorationSet.create(state.doc, decos)
      }
    }
  })
}
