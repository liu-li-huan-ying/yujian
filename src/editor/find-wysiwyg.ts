import { Plugin, PluginKey, type EditorState } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { Node as PMNode } from '@milkdown/prose/model'
import { buildRegex } from '../utils/regex'

/**
 * 所见即所得模式搜索命中高亮（ProseMirror Decoration）。
 * 与源码模式的 CodeMirror 高亮对称：同一套 query / 选项驱动，全部命中常驻高亮，
 * 当前结果所在行（命中）额外加 .pm-find--current 强化。纯视图装饰，不进文档，
 * 对 Markdown 往返保真零影响。
 *
 * 开关是「插件状态」：经 dispatch(tr.setMeta(findKey, fs | null)) 切换。
 * 用 meta 而非模块级标志 + 空事务，是因为「空事务」可能被视图派发链路当作无变化而跳过，
 * 导致装饰不重算、高亮看起来「无效」；meta 事务必定触发 plugin.apply → 重建装饰，稳定生效。
 *
 * 文档被编辑 / 切换文档（setMarkdown 重渲染）时，tr.docChanged 命中 → 用存储的 query
 * 重新扫描当前文档，高亮自动跟随最新内容（currentLine 也重新映射）。
 *
 * 模块级 findState 作为「真相源」：即使某些事务路径把 meta 剥离或插件 value.fs 丢失，
 * 也能在 meta 事务 / 文档变更时自愈重建装饰，杜绝「偶尔不显示」的时序/复位问题。
 */
export interface WysiwygFindState {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  currentLine?: number
  /**
   * 当前结果行的源码文本。源码行号与渲染行号口径不同（Markdown 空行渲染后不产生节点，
   * 块间只算一个换行，渲染态行号被「压缩」），仅靠 currentLine 比较会标错命中。
   * 用行文本匹配命中所在文本块，可让 current 标记与源码行号严格一致。
   */
  currentLineText?: string
}

interface FindPluginValue {
  fs: WysiwygFindState | null
  decos: DecorationSet
}

export const findKey = new PluginKey<FindPluginValue | null>('yujian-find-wysiwyg')

/** 模块级高亮真相源（与 zen 的 zenState 同策略，保证跨事务/重渲染自愈） */
let findState: WysiwygFindState | null = null

/** 外部（milkdown.setFind）写入当前高亮状态，供 apply 回退 / 自愈使用 */
export function setFindState(fs: WysiwygFindState | null): void {
  findState = fs && fs.query ? fs : null
}

/**
 * 依据文档位置求「行号」：统计 [0, pos) 内的换行数（与统一搜索按文件行号计数的口径
 * 尽量一致），使 currentLine 能映射到正确的命中。
 */
function lineOfPos(doc: PMNode, pos: number): number {
  const text = doc.textBetween(0, pos, '\n', '\n')
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') n++
  }
  return n
}

/** 去掉常见 Markdown 行标记，便于源码行文本与渲染文本互相匹配 */
export function stripMd(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim()
}

/**
 * 判断命中是否属于「当前结果行」：优先用源码行文本匹配命中所在的文本块
 * （渲染态行号被压缩，直接比行号会偏），没有行文本时回退到行号比较。
 */
function isCurrentHit(doc: PMNode, pos: number, fs: WysiwygFindState): boolean {
  if (fs.currentLine === undefined) return false
  const needle = fs.currentLineText ? stripMd(fs.currentLineText) : ''
  if (!needle) return lineOfPos(doc, pos) === fs.currentLine
  const blockText = doc.resolve(pos).parent?.textContent ?? ''
  // 双向包含：源码行可能残留标记，或块文本仅为行文本的一部分
  return blockText.includes(needle) || needle.includes(blockText)
}

/**
 * 按源码行文本在渲染文档中定位：片段逐级缩短做包含匹配，容忍语法差异造成的局部不匹配。
 * 找不到返回 null，由调用方回退到行号反查。
 */
export function findPosByText(doc: PMNode, needle: string): number | null {
  const n = stripMd(needle)
  if (!n) return null
  for (let len = n.length; len >= 4; len = Math.floor(len * 0.7)) {
    const frag = n.slice(0, len)
    let hit: number | null = null
    doc.descendants((node, pos) => {
      if (hit !== null) return false
      if (node.isTextblock) {
        const i = node.textContent.indexOf(frag)
        if (i >= 0) {
          hit = pos + 1 + i
          return false
        }
      }
      return true
    })
    if (hit !== null) return hit
  }
  return null
}

/**
 * 反查「行号 → 文档位置」：与 lineOfPos 完全同一口径（均基于 textBetween 的换行统计），
 * 使所见即所得模式的定位与命中高亮的 currentLine 判定结果一致。
 * 先按文本节点顺序找到目标行所在的节点（行号单调递增），再在节点内推进若干换行取精确偏移。
 * 供搜索结果 / 断链跳转使用，避免「渲染模式无法定位行 → 被迫切源码」的体验割裂。
 */
export function findPosOfLine(doc: PMNode, target: number): number | null {
  const spans: { pos: number; text: string }[] = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) spans.push({ pos, text: node.text })
  })
  if (!spans.length) return null

  let best = spans[0]
  let bestLine = 1
  for (const s of spans) {
    const l = lineOfPos(doc, s.pos)
    if (l <= target) {
      best = s
      bestLine = l
    } else break
  }

  let need = target - bestLine
  let i = 0
  while (need > 0 && i < best.text.length) {
    if (best.text[i] === '\n') need--
    i++
  }
  return best.pos + i
}

/** 扫描整个文档文本节点，给每个命中区间打上 .pm-find；当前结果行的命中额外加 .pm-find--current */
function buildDecos(doc: PMNode, fs: WysiwygFindState): DecorationSet {
  if (!fs.query) return DecorationSet.empty
  // 部分复杂节点的文本范围可能让内联装饰计算异常；容错包裹，避免单次失败拖垮整条事务
  try {
    const re = buildRegex(fs.query, fs.caseSensitive, fs.wholeWord)
    const decos: Decoration[] = []
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      const t = node.text
      let m: RegExpExecArray | null
      re.lastIndex = 0
      while ((m = re.exec(t))) {
        const from = pos + m.index
        const to = from + m[0].length
        // 零宽匹配：仅推进指针，不生成装饰（ProseMirror 不允许零长内联装饰）
        if (to <= from) {
          re.lastIndex++
          continue
        }
        const isCurrent = isCurrentHit(doc, from, fs)
        decos.push(
          Decoration.inline(from, to, {
            class: isCurrent ? 'pm-find pm-find--current' : 'pm-find'
          })
        )
      }
    })
    return DecorationSet.create(doc, decos)
  } catch {
    return DecorationSet.empty
  }
}

export function createFindDecoPlugin(): Plugin {
  return new Plugin({
    key: findKey,
    state: {
      init: (): FindPluginValue => ({ fs: null, decos: DecorationSet.empty }),
      apply(tr, value: FindPluginValue): FindPluginValue {
        // meta 事务：设置或清空高亮状态（传 null 即清空）
        const meta = tr.getMeta(findKey) as WysiwygFindState | null | undefined
        if (meta !== undefined) {
          if (!meta || !meta.query) return { fs: null, decos: DecorationSet.empty }
          return { fs: meta, decos: buildDecos(tr.doc, meta) }
        }
        // 文档被编辑 / 切换文档：meta 被剥离或 value.fs 丢失时，回退模块级真相源自愈重建
        if (findState && findState.query && tr.docChanged) {
          return { fs: findState, decos: buildDecos(tr.doc, findState) }
        }
        return value
      }
    },
    props: {
      decorations(state: EditorState) {
        return findKey.getState(state)?.decos
      }
    }
  })
}
