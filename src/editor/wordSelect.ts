/**
 * 双击选词（中文分词）—— 批次四「中文分词」
 *
 * 背景：ProseMirror 的双击选词按「词字符 / 空白」切分，而中文**词间没有空格**，
 * 于是双击中文往往整段选中（`#标签` 识别、`双击选词` 这类操作都因此不顺手）。
 * 这里只对 **CJK** 接管选词，西文完全交给编辑器默认逻辑（它做得更好）。
 *
 * 设计要点：
 * - **只在单个文本节点内选词**，不跨 inline 节点（wikilink / 数学公式 / emoji 等）。
 *   这既符合「选词不该跨越节点边界」的直觉，也绕开了「文本偏移 ≠ 文档位置」的错位风险
 *   （inline 节点可能占 1 个位置却对应多字符）。
 * - 分词交给 `src/utils/cjk-segment.ts`（浏览器原生 `Intl.Segmenter`），本文件不含词典。
 * - 光标落在 CJK 标点 / 全角符号上时（不属于任何词），选中**该字符本身**——
 *   比整段选中可预测得多。
 * - 三击选段落（`handleTripleClick`）保持默认，不动。
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { ResolvedPos } from '@milkdown/prose/model'
import { isCjkChar, wordRangeAt } from '../utils/cjk-segment'

interface TextSpot {
  /** 该文本节点的文本 */
  text: string
  /** 文本首字符在文档中的位置 */
  start: number
  /** 光标落在第几个字符上（保证 0 <= offset < text.length） */
  offset: number
}

/**
 * 定位光标所在的**文本节点及字符下标**。
 * 找不到（光标在 inline 节点上 / 块内无文本）时返回 null，交由默认行为处理。
 */
function textSpotAt($pos: ResolvedPos): TextSpot | null {
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const at = $pos.parentOffset

  const after = parent.childAfter(at)
  if (after.node && after.node.isText && after.node.text) {
    const text = after.node.text
    let offset = at - after.offset
    // 光标正好落在该文本节点末尾边界：取最后一个字符
    if (offset === text.length) offset = text.length - 1
    if (offset >= 0 && offset < text.length) {
      return { text, start: $pos.start() + after.offset, offset }
    }
  }
  return null
}

export function createWordSelectPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('yujian-word-select'),
    props: {
      handleDoubleClick(view, pos) {
        const spot = textSpotAt(view.state.doc.resolve(pos))
        // 非文本节点，或光标处不是 CJK —— 一律交回默认（西文选词本来就好用）
        if (!spot || !isCjkChar(spot.text[spot.offset])) return false
        const word = wordRangeAt(spot.text, spot.offset)
        // 落在标点 / 全角符号上（不属于任何词）→ 选中该字符本身
        const from = spot.start + (word ? word.start : spot.offset)
        const to = spot.start + (word ? word.end : spot.offset + 1)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
        return true
      },
    },
  })
}
