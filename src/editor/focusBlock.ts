/**
 * 常态（非凝神）所见即所得下的「当前块轻聚焦」：
 * 参考 Typora / Bear 的做法——光标所在段落获得一道极轻的底色，
 * 帮助眼睛在长文档里快速锚定「我在哪」，但不像凝神那样雾化衰减，
 * 保持常态写作的信息完整与克制。纯视图装饰，不进文档，对 Markdown 往返零影响。
 *
 * 与 zen 的分工：zen 激活时本插件让位（返回空装饰），由 zen 的 .zen-active 接管，
 * 二者不叠加。开关策略沿用本仓库惯例——仅在选区 / 文档变化时重建，避免每次事务无谓重算；
 * zen 结束的那一帧强制重建一次，使焦点块在退出凝神后立刻回归。
 */
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { isZenActive } from './zen'

export const focusBlockKey = new PluginKey('yujian-focus-block')

let wasZen = false

export function createFocusBlockPlugin(): Plugin {
  return new Plugin({
    key: focusBlockKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, value) {
        const zen = isZenActive()
        if (zen) {
          wasZen = true
          return DecorationSet.empty
        }
        const zenJustEnded = wasZen
        wasZen = false
        if (!tr.docChanged && !tr.selectionSet && !zenJustEnded) return value
        const head = tr.selection.head
        const decos: Decoration[] = []
        tr.doc.descendants((node, pos) => {
          if (node.isTextblock && pos <= head && head <= pos + node.nodeSize) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'focus-block' }))
            return false
          }
          return true
        })
        return DecorationSet.create(tr.doc, decos)
      }
    },
    props: {
      decorations(state) {
        return focusBlockKey.getState(state) as DecorationSet
      }
    }
  })
}
