import { InputRule } from '@milkdown/kit/prose/inputrules'
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

/** 只读装饰：把文本里的 `:name:` 显示为 emoji 部件，原文本隐藏 */
export function emojiDecorationPlugin(): Plugin {
  return new Plugin({
    key: emojiDecoKey,
    props: {
      decorations(state) {
        const decos: Decoration[] = []
        state.doc.descendants((node, pos) => {
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
        return DecorationSet.create(state.doc, decos)
      }
    }
  })
}
