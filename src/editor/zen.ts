/**
 * 凝神模式（打字机 + 禅 融合）：所见即所得下的「当前块高亮 + 其余淡化 + 当前行居中」。
 *
 * 实现：
 * - 用 ProseMirror 的 `Decoration.node` 给顶层块加 `.zen-active`（当前块）/ `.zen-dim`（其余块），
 *   非破坏性（不改动文档内容，只改渲染类），切走即还原。
 * - 居中滚动走 `.milkdown` 滚动容器，把光标所在行顶到视口约 1/3 处（偏上，符合打字机观感）。
 * - 开关是「插件状态」：EditorHost 经 `view.dispatch(tr.setMeta(zenKey, value))` 切换。
 *   用 meta 而非模块级标志 + 空事务，是因为「空事务」可能被视图派发链路当作无变化而跳过，
 *   导致装饰不重算、凝神看起来「无效」；meta 事务必定触发 plugin.apply → 重建装饰，稳定生效。
 *
 * 为什么用 plugin 而不是 CSS 选区：CSS 无法根据光标位置给「除当前块外的所有块」加类，
 * 行级/块级淡化必须借助 PM 装饰。这与批次一查找刻意不注入 plugin（仅靠选区高亮）不同——
 * 查找高亮可复用编辑器原生选区，而淡化是原生选区做不到的，故此处合规引入一个 plugin。
 */

import { Plugin, PluginKey, type Transaction } from '@milkdown/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view'
import type { EditorState } from '@milkdown/prose/state'
import type { Node as PMNode } from '@milkdown/prose/model'

export const zenKey = new PluginKey<ZenValue>('yujian-zen')

interface ZenValue {
  active: boolean
  decos: DecorationSet
}

/**
 * 模块级开关：供源码模式下 SourceEditor 的 `isZenActive()` 与 plugin 的 `view.update`
 * 读取（源码模式没有 PM 装饰，淡化在 WYSIWYG 才生效，但居中在两种模式都跑）。
 */
const zenState = { active: false }

export function setZenActive(value: boolean): void {
  zenState.active = value
}

export function isZenActive(): boolean {
  return zenState.active
}

/** 依据光标 head 找到顶层块索引，并为每个顶层文本块生成 .zen-active / .zen-dim 装饰 */
function buildDecorations(doc: PMNode, head: number): DecorationSet {
  const decos: Decoration[] = []
  let activeIndex = -1
  let i = 0
  doc.forEach((node, offset) => {
    if (offset <= head && head <= offset + node.nodeSize) activeIndex = i
    i++
  })
  i = 0
  doc.forEach((node, offset) => {
    if (node.isTextblock) {
      const cls = i === activeIndex ? 'zen-active' : 'zen-dim'
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: cls }))
    }
    i++
  })
  return DecorationSet.create(doc, decos)
}

let raf = 0

/** 向上找到真正承载滚动的祖先（优先 overflow:auto/scroll 且内容溢出的元素） */
function scrollContainer(dom: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = dom.parentElement
  while (el) {
    const s = getComputedStyle(el)
    const scrollable = /auto|scroll/.test(s.overflowY) || /auto|scroll/.test(s.overflow)
    if (scrollable && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return dom.closest('.milkdown') as HTMLElement | null
}

/**
 * 把光标所在行在滚动容器里垂直居中（偏上 1/3）。
 * rAF 节流；失焦由调用方决定是否调用（plugin 的 update 里已做 hasFocus 守卫）。
 */
export function centerZenLine(view: EditorView): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    if (!zenState.active) return
    const pane = scrollContainer(view.dom as HTMLElement)
    if (!pane) return
    const coords = view.coordsAtPos(view.state.selection.head)
    const paneRect = pane.getBoundingClientRect()
    const lineCenter = coords.top + (coords.bottom - coords.top) / 2
    const target = lineCenter - paneRect.top - pane.clientHeight * 0.33
    pane.scrollTo({ top: pane.scrollTop + target, behavior: 'smooth' })
  })
}

export function createZenPlugin(): Plugin {
  return new Plugin({
    key: zenKey,
    state: {
      init: () => ({ active: false, decos: DecorationSet.empty }),
      apply(tr: Transaction, value: ZenValue) {
        const meta = tr.getMeta(zenKey)
        const active = meta === undefined ? value.active : !!meta
        if (!active) return { active: false, decos: DecorationSet.empty }
        // 仅在活跃态切换 / 文档或选区变化时重建装饰，避免每次事务无谓重算
        if (active === value.active && !tr.docChanged && !tr.selectionSet) {
          return value
        }
        return { active: true, decos: buildDecorations(tr.doc, tr.selection.head) }
      }
    },
    props: {
      decorations(state) {
        return zenKey.getState(state as EditorState)?.decos
      }
    },
    view() {
      return {
        update(view, prev) {
          if (!zenState.active) return
          if (!view.hasFocus()) return
          if (prev.selection.head !== view.state.selection.head) {
            centerZenLine(view)
          }
        }
      }
    }
  })
}
