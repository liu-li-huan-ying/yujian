import { StateField, StateEffect, type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

/** 源码模式搜索高亮状态：由统一搜索的 query / 选项驱动，currentLine 标记当前结果所在行 */
export interface SourceFindState {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  currentLine?: number
}

/** 侧栏经 EditorHost 把当前搜索状态推给 CodeMirror；传 null 即清空高亮 */
export const setSourceFind = StateEffect.define<SourceFindState | null>()

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRegex(query: string, caseSensitive: boolean, wholeWord: boolean): RegExp {
  let pattern = escapeRegExp(query)
  if (wholeWord) pattern = `\\b${pattern}\\b`
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi')
}

/** 扫描整篇文档，给每个命中区间打上 .cm-find；当前结果所在行的命中额外加 .cm-find--current */
function buildDecos(state: EditorState, st: SourceFindState): DecorationSet {
  if (!st.query) return Decoration.none
  const re = buildRegex(st.query, st.caseSensitive, st.wholeWord)
  const doc = state.doc
  const marks: Range<Decoration>[] = []
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    // 逐行扫描：命中索引基于行文本，映射到文档绝对偏移
    while ((m = re.exec(line.text))) {
      const from = line.from + m.index
      const to = from + m[0].length
      if (to > line.to) break
      const isCurrent = st.currentLine !== undefined && st.currentLine === i
      marks.push(
        Decoration.mark({
          class: isCurrent ? 'cm-find cm-find--current' : 'cm-find'
        }).range(from, to)
      )
      if (m[0].length === 0) re.lastIndex++ // 零宽匹配防护，避免死循环
    }
  }
  return Decoration.set(marks, true)
}

/** 源码模式搜索高亮字段：纯视图层装饰，不进文档，对 Markdown 往返保真零影响 */
export const sourceFindField = StateField.define<{ decos: DecorationSet; st: SourceFindState | null }>({
  create() {
    return { decos: Decoration.none, st: null }
  },
  update(value, tr) {
    const eff = tr.effects.find((e) => e.is(setSourceFind))
    if (eff) {
      const st = eff.value as SourceFindState | null
      if (!st || !st.query) return { decos: Decoration.none, st: null }
      return { decos: buildDecos(tr.state, st), st }
    }
    // 文档被编辑时，若已有高亮则跟随文本重算（经 tr.mapping 等价效果）
    if (value.st && tr.docChanged) {
      return { decos: buildDecos(tr.state, value.st), st: value.st }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos)
})
