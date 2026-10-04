import { onBeforeUnmount, ref } from 'vue'

export type ToastType = 'ok' | 'err' | 'info'
export interface Toast {
  msg: string
  type: ToastType
}

/** 默认停留时长（ms）：够看清一句话，又不至于挡视线 */
const DEFAULT_DURATION = 2600

/**
 * 顶部轻提示：同一时刻只显示一条，新的覆盖旧的。
 *
 * 为什么独立成 composable：定时器的生命周期必须与组件对齐。原先由调用方各自持有
 * `let toastTimer`，组件卸载时若忘了 `clearTimeout`，回调会去改一个已销毁组件的状态
 * （Vue 会告警，且是「换个环境才复现」的那类问题）。收进这里后，清理只有一处、
 * 不可能被漏掉。
 */
export function useToast() {
  const toast = ref<Toast | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  /**
   * 显示一条提示；同一条消息重复触发会重新计时（不是叠加两条）。
   *
   * `duration = 0` 表示**常驻**（sticky）：不排定时器，由调用方 `clearToast()` 收起。
   * 用于「保存失败」这类必须让用户看见、且不该自己消失的消息 ——
   * 若沿用默认 2.6s 自动消失，用户盯着编辑器很可能错过，
   * 而「以为已保存、实际没落盘」正是最需要避免的结果。
   */
  function showToast(msg: string, type: ToastType = 'info', duration = DEFAULT_DURATION): void {
    toast.value = { msg, type }
    if (timer) clearTimeout(timer)
    timer = null
    if (duration > 0) timer = setTimeout(() => (toast.value = null), duration)
  }

  /**
   * 立即收起并取消计时。
   * 供「预览浮层 / 模态面板已接管界面」时调用，避免提示悬在后开的浮层之下。
   */
  function clearToast(): void {
    if (timer) clearTimeout(timer)
    timer = null
    toast.value = null
  }

  onBeforeUnmount(clearToast)

  return { toast, showToast, clearToast }
}
