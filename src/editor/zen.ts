/**
 * 凝神模式 2.0（打字机 + 禅 融合）：所见即所得下的「当前块微光 + 雾化衰减 + 纸卷滚动」。
 * 设计规格：docs/FOCUS-MODE-2.0-DESIGN.md。
 *
 * 实现：
 * - ProseMirror `Decoration.node` 按顶层块距给块加 `.zen-active`（当前块）/ `.zen-dim-1..5`
 *   （五档衰减，档位由 --fog-1..5 CSS 变量承载，设置面板换档只改变量）。
 *   非破坏性（不改文档内容，只改渲染类），切走即还原。
 * - 「雾感」只走 opacity——大文档逐块 blur 必掉帧；上下羽化由 shell 级 .editor 遮罩承担。
 * - 纸卷滚动：rAF lerp 追随（k 可调三档平滑度），只在「脏」时拉锚——选区/文档变化由
 *   plugin update 标脏，用户手动滚轮浏览不被强行拉回；粘贴大段单帧限幅 120px，
 *   lerp 自带缓出「轻轻刹住」。
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

/** 雾化衰减五档（当前块外第 1..5+ 块的 opacity），对应设置面板 快/中/慢 */
export const ZEN_FOG_PRESETS = {
  fast: [0.45, 0.28, 0.2, 0.17, 0.16],
  mid: [0.55, 0.38, 0.28, 0.22, 0.18],
  slow: [0.66, 0.5, 0.4, 0.32, 0.26]
} as const

export type ZenFogLevel = keyof typeof ZEN_FOG_PRESETS

export interface ZenPrefs {
  /** 锚点：光标行中心钉在视口高度的比例（0.333 偏上1/3 / 0.382 黄金分割 / 0.5 正中） */
  anchor: number
  /** 雾化衰减档 */
  fog: ZenFogLevel
  /** 滚动平滑度：lerp 系数（0.16 跟手 / 0.10 平滑 / 0.06 极平滑） */
  scroll: number
}

const DEFAULT_PREFS: ZenPrefs = { anchor: 1 / 3, fog: 'mid', scroll: 0.16 }

/** 模块级开关与偏好：供源码模式 `isZenActive()`、plugin `view.update` 与设置面板读写 */
const zenState = { active: false }
let prefs: ZenPrefs = { ...DEFAULT_PREFS }

export function setZenActive(value: boolean): void {
  zenState.active = value
}

export function isZenActive(): boolean {
  return zenState.active
}

/**
 * 应用凝神偏好（锚点 / 雾化 / 平滑度）：
 * 雾化档位写为根节点 CSS 变量（editor.css 的 .zen-dim-* 消费），其余存模块变量。
 */
export function setZenPrefs(next: Partial<ZenPrefs>): void {
  prefs = { ...prefs, ...next }
  const fog = ZEN_FOG_PRESETS[prefs.fog] ?? ZEN_FOG_PRESETS.mid
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    fog.forEach((o, i) => root.style.setProperty(`--fog-${i + 1}`, String(o)))
  }
}

/**
 * 依据光标 head 找到顶层块索引，按块距生成 .zen-active / .zen-dim-1..5 装饰。
 * 距离在全部顶层块上度量（含表格等非文本块），类只挂在文本块上——
 * 视觉密度与阅读距离一致，跳过一个高表格时淡化不会「漏档」。
 */
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
      const d = Math.abs(i - activeIndex)
      const cls = d === 0 ? 'zen-active' : `zen-dim-${Math.min(d, 5)}`
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: cls }))
    }
    i++
  })
  return DecorationSet.create(doc, decos)
}

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

/* ── 纸卷滚动：rAF lerp 追随 ───────────────────────────
   只在「脏」（选区/文档变化）时拉锚，收敛即停——用户滚轮浏览不被抢滚动条；
   粘贴大段时单帧限幅 120px，先匀速补偿再由 lerp 自然减速刹住。 */

let scrollRaf = 0
let scrollDirty = false

/** 光标行中心到达锚点所需的 scrollTop 目标值 */
function anchorScrollTop(view: EditorView, pane: HTMLElement): number {
  const coords = view.coordsAtPos(view.state.selection.head)
  const paneRect = pane.getBoundingClientRect()
  const lineCenter = coords.top + (coords.bottom - coords.top) / 2
  return pane.scrollTop + (lineCenter - paneRect.top) - pane.clientHeight * prefs.anchor
}

function scrollStep(view: EditorView): void {
  scrollRaf = 0
  if (!zenState.active || !scrollDirty) return
  const pane = scrollContainer(view.dom as HTMLElement)
  if (!pane) return
  const target = anchorScrollTop(view, pane)
  let delta = target - pane.scrollTop
  if (Math.abs(delta) > 120) delta = 120 * Math.sign(delta)
  const next = pane.scrollTop + delta * prefs.scroll
  pane.scrollTop = Math.abs(target - next) < 0.5 ? target : next
  if (Math.abs(target - pane.scrollTop) >= 0.5) {
    scrollRaf = requestAnimationFrame(() => scrollStep(view))
  } else {
    scrollDirty = false
  }
}

/**
 * 标脏并启动纸卷循环（幂等）：选区/文档变化、进入凝神时调用。
 * 保留旧名 centerZenLine 以兼容既有调用点。
 */
export function centerZenLine(view: EditorView): void {
  if (!zenState.active) return
  scrollDirty = true
  if (!scrollRaf) scrollRaf = requestAnimationFrame(() => scrollStep(view))
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
          if (
            prev.selection.head !== view.state.selection.head ||
            prev.doc !== view.state.doc
          ) {
            centerZenLine(view)
          }
        }
      }
    }
  })
}
