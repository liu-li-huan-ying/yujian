import { InputRule } from '@milkdown/kit/prose/inputrules'
import type { Node as PMNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { EMOJI_MAP } from '../../export/domUtils'

/**
 * Emoji 短代码（`:smile:` 等）自动转换。
 *
 * 三处协同：
 * 1) emojiInputRule —— 输入时敲完 `:name:` 立刻替换成 emoji 字符（文档模型里即存 emoji）。
 * 2) emojiDecorationPlugin —— 对已存在 / 粘贴进来的 `:name:` 文本，用只读装饰把 `:name:`
 *    原位显示为 emoji，不改动源码（所见即所得观感一致）。输入规则转换后的字符不再匹配，互不冲突。
 * 3) replaceEmojiInHtml（见 export/domUtils）—— 导出副本时把残留的 `:name:` 替换成 emoji
 *    （装饰不进 innerHTML，故导出需单独处理；跳过 <code>/<pre> 以免破坏代码）。
 */

/** 短代码名称：字母数字下划线加号减号 */
const NAME_RE = /[a-z0-9_+-]{1,50}/

/** 输入规则：在光标处匹配尾随的 `:name:` 并替换 */
export const emojiInputRule = new InputRule(
  new RegExp(`:(${NAME_RE.source}):$`),
  (state, match, start, end) => {
    const name = match[1]
    const emoji = EMOJI_MAP[name]
    if (!emoji) return null
    return state.tr.insertText(emoji, start, end)
  }
)

const emojiDecoKey = new PluginKey('yujian-emoji')

/**
 * 装饰结果按「文档对象身份」记忆化：
 * `props.decorations(state)` 在每次渲染时都会被调用，而**纯选区事务（点选 / 方向键 / 滚动）
 * 复用同一个 `doc` 对象**。原实现每次调用都全量 `doc.descendants` 扫描 + 建装饰，在大文档下
 * 是随文档长度增长的重复开销。缓存后，只有文档真正变化（新 doc 对象）时才重算——
 * 行为完全不变，仅去掉重复扫描。
 * （编辑器为单实例，故模块级单槽缓存安全；换语言重建实例时 doc 对象变化，自然失效重算。）
 */
let cachedDoc: unknown = null
let cachedSet: DecorationSet = DecorationSet.empty

function emojiDecorations(doc: PMNode): DecorationSet {
  if (doc === cachedDoc) return cachedSet
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text
    const re = new RegExp(`:(${NAME_RE.source}):`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const name = m[1]
      const emoji = EMOJI_MAP[name]
      if (!emoji) continue
      const from = pos + m.index
      const to = from + m[0].length
      const widget = document.createElement('span')
      widget.className = 'emoji-glyph'
      widget.textContent = emoji
      widget.setAttribute('contenteditable', 'false')
      decos.push(Decoration.widget(from, widget, { side: 0, key: `emoji-${from}` }))
      decos.push(Decoration.inline(from, to, { style: 'display:none' }))
    }
  })
  cachedDoc = doc
  cachedSet = DecorationSet.create(doc, decos)
  return cachedSet
}

/** 只读装饰：把文本里的 `:name:` 显示为 emoji 部件，原文本隐藏 */
export function emojiDecorationPlugin(): Plugin {
  return new Plugin({
    key: emojiDecoKey,
    props: {
      decorations(state) {
        return emojiDecorations(state.doc)
      }
    }
  })
}
