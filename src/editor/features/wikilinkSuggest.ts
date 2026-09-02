import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

/**
 * `[[` 自动补全的触发检测插件（Phase 3 批次二收尾项）。
 *
 * 职责单一：只负责「光标前是否存在一个未闭合的 `[[查询词`」，把触发范围、查询词与
 * `[[` 的视口坐标报给渲染层（Vue 浮层），并把手感相关的按键（↑↓ / Enter / Tab / Esc）
 * 交由渲染层裁决。**不碰候选数据、不碰 DOM 浮层** —— 与 find-wysiwyg 同源的分层约定。
 *
 * 触发判定刻意保守：
 *   - 只在空选区（光标）时触发，选中替换期间不打扰；
 *   - 代码块内不触发（`[[` 在代码里就该是字面量）；
 *   - 触发串里一旦出现 `]`（用户已敲出 `]]`）即交回给 wikiLinkInputRule 转节点；
 *   - 最多回溯 120 字符，避免长段落里匹配到很远之前的 `[[`。
 */

export interface WikiSuggestTrigger {
  /** `[[` 起始文档位置（含） */
  from: number
  /** 触发串结尾（即光标位置；`]]` 尚未敲出） */
  to: number
  /** 已输入的查询词 */
  query: string
  /** `[[` 在视口中的坐标（浮层用 position: fixed 定位，故直接用视口坐标） */
  x: number
  y: number
}

export interface WikiSuggestHandlers {
  /** 触发状态变化（null 表示应关闭浮层） */
  onState(t: WikiSuggestTrigger | null): void
  /** 浮层打开期间拦截按键；返回 true 表示已被浮层消费 */
  onKey(e: KeyboardEvent): boolean
}

export const wikiSuggestKey = new PluginKey('yjWikiSuggest')

/** 回溯窗口：足够覆盖一个笔记名，又不至于在长段落里误命中很远的 `[[` */
const MAX_LOOKBACK = 120
/** 查询词上限：超过就不是在补笔记名了（可能是误敲或粘贴长串） */
const MAX_QUERY = 80

/** 读取当前光标前的触发串；不构成触发返回 null */
function readTrigger(view: EditorView): Omit<WikiSuggestTrigger, 'x' | 'y'> | null {
  const { selection } = view.state
  if (!selection.empty) return null
  const $pos = selection.$from
  const parent = $pos.parent
  // code_block / 行内代码等带 code 标记的节点内不触发
  if (parent.type.spec.code) return null

  const start = Math.max(0, $pos.parentOffset - MAX_LOOKBACK)
  const text = parent.textBetween(start, $pos.parentOffset, undefined, '￼')
  const idx = text.lastIndexOf('[[')
  if (idx < 0) return null

  const frag = text.slice(idx + 2)
  if (frag.includes(']') || frag.length > MAX_QUERY) return null

  // `text` 以光标结尾，故 `[[` 距光标的距离就是 text.length - idx
  return { from: selection.from - (text.length - idx), to: selection.from, query: frag }
}

/**
 * 创建 `[[` 自动补全插件。
 * 仅在「触发签名」变化时才回调 onState —— 否则每敲一个字符都会重算坐标、触发 Vue 更新。
 */
export function createWikiSuggestPlugin(handlers: WikiSuggestHandlers): Plugin {
  let signature: string | null = null

  const sync = (view: EditorView): void => {
    const t = readTrigger(view)
    const sig = t ? `${t.from}:${t.to}:${t.query}` : null
    if (sig === signature) return
    signature = sig
    if (!t) {
      handlers.onState(null)
      return
    }
    let coords: { left: number; bottom: number }
    try {
      coords = view.coordsAtPos(t.from)
    } catch {
      handlers.onState(null)
      return
    }
    handlers.onState({ ...t, x: coords.left, y: coords.bottom })
  }

  return new Plugin({
    key: wikiSuggestKey,
    view(view) {
      sync(view)
      return {
        update(v) {
          sync(v)
        },
        destroy() {
          signature = null
          handlers.onState(null)
        }
      }
    },
    props: {
      handleKeyDown(_view, event) {
        if (signature === null) return false
        return handlers.onKey(event)
      }
    }
  })
}
