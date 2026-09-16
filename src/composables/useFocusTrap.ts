import { onBeforeUnmount, watch, type Ref } from 'vue'
import { getFocusable, nextFocusable } from '../utils/focusTrap'

/**
 * 模态焦点陷阱：打开时把焦点送进对话框、Tab 循环困在容器内、关闭时归还焦点。
 *
 * 用法（对话框通常 `v-if` 渲染，故容器 ref 可能晚一拍才有值）：
 * ```ts
 * const box = ref<HTMLElement | null>(null)
 * useFocusTrap({ container: box, active: () => props.open })
 * ```
 *
 * 设计取舍：
 * - **只管 Tab 循环，不管 Esc**。Esc 是「上下文相关的退出」，各对话框已有自己的处理
 *   （且有的还要先关子面板），这里再拦一次会打架。真要补 Esc 请在该组件内补。
 * - **打开即聚焦首个可聚焦元素**（可用 `initial` 覆盖，比如命令面板要聚焦输入框）。
 *   若容器里一个可聚焦元素都没有，就什么都不做 —— 绝不把焦点抢到一个空壳上。
 * - **关闭时归还**到打开前的 `document.activeElement`。那个元素可能已被 v-if 销毁，
 *   故做了 `isConnected` 判断，销毁了就放弃归还（免得聚焦到一个脱离文档的节点）。
 * - 用 `flush: 'post'` 是因为容器常在 `active` 变 true 之后才渲染出来。
 */
export function useFocusTrap(opts: {
  /** 对话框根元素 */
  container: Ref<HTMLElement | null>
  /** 是否处于打开态（传 getter，便于对 `props.open` 之类的响应式值取最新值） */
  active: () => boolean
  /** 打开后优先聚焦的元素（默认取容器内第一个可聚焦元素） */
  initial?: () => HTMLElement | null
  /**
   * Esc 回调（**可选**）。默认不处理 Esc —— 因为 Esc 在站内是「上下文相关的退出」，
   * 有的对话框要按 Esc 先关子面板，统一拦截会打架。需要 Esc 关闭的组件显式传进来。
   */
  onEscape?: () => void
}): void {
  /** 打开前的焦点所在，关闭时归还 */
  let restoreTo: HTMLElement | null = null

  function focusFirst(): void {
    const root = opts.container.value
    if (!root) return
    const preferred = opts.initial?.() ?? null
    const target = preferred ?? getFocusable(root)[0] ?? null
    target?.focus()
  }

  function release(): void {
    const prev = restoreTo
    restoreTo = null
    // 触发元素可能已随 v-if 一起销毁（例如从右键菜单打开的确认框），此时不归还
    if (prev && prev.isConnected) prev.focus()
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!opts.active()) return
    if (e.key === 'Escape' && opts.onEscape) {
      e.preventDefault()
      opts.onEscape()
      return
    }
    if (e.key !== 'Tab') return
    const root = opts.container.value
    if (!root) return
    const list = getFocusable(root)
    // 一个可聚焦元素都没有时放行 Tab，别把键盘用户彻底困死
    if (list.length === 0) return
    e.preventDefault()
    nextFocusable(list, document.activeElement, e.shiftKey)?.focus()
  }

  watch(
    () => opts.active(),
    (open) => {
      if (open) {
        // 记下触发者：只在尚未记录时记（避免重复 watch 覆盖成对话框内部元素）
        if (!restoreTo) restoreTo = document.activeElement as HTMLElement | null
        focusFirst()
      } else {
        release()
      }
    },
    { immediate: true, flush: 'post' },
  )

  document.addEventListener('keydown', onKeydown, true)
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown, true)
    release()
  })
}
