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
        // 从光标位置向上找最近的文本块（段落 / 标题 / 列表项段落…）——
        // O(深度) 而非原实现的 O(块数)：大文档下避免每次事务遍历整篇文档。
        const $head = tr.doc.resolve(head)
        let block: { from: number; to: number } | null = null
        for (let d = $head.depth; d > 0; d--) {
          if ($head.node(d).isTextblock) {
            block = { from: $head.before(d), to: $head.after(d) }
            break
          }
        }
        const decos: Decoration[] = []
        if (block) decos.push(Decoration.node(block.from, block.to, { class: 'focus-block' }))
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
