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

  /** 显示一条提示；同一条消息重复触发会重新计时（不是叠加两条） */
  function showToast(msg: string, type: ToastType = 'info', duration = DEFAULT_DURATION): void {
    toast.value = { msg, type }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (toast.value = null), duration)
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
