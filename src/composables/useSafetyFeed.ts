import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { SafetyKind, SafetyNoticePayload } from '../../electron/shared/safety'
import { isErrorLevel } from '../utils/safetyNotice'

/**
 * 安全网降级事件订阅（2026-10-04 补链路的一跳）。
 *
 * ## 为什么这个 composable 存在
 *
 * 主进程侧的降级上报（`safetyEvents.ts`）、IPC 通道、preload 暴露在上一轮已就绪，
 * 但**渲染层零消费** —— 表现为「备份失败过 3 次，用户永远看不到」。
 * 本 composable 把最后一跳接上。
 *
 * ## 两个来源都要（缺一不可）
 *
 *  1. **补拉**（`getSafetyNotices`）：覆盖「窗口 ready 之前」发生的降级。
 *     例：启动自检探针、开库时发现库不可写 —— 都在渲染层挂载前就发生了。
 *  2. **订阅**（`onSafetyNotice`）：接住挂载之后的实时事件。备份失败是保存时才发生的。
 *
 * 只做 1 会漏掉运行期事件；只做 2 会漏掉启动期。**两个都必须有。**
 */

/** 渲染层保留条数：与主进程环同量级，够看完一轮又不无限涨 */
const CAPACITY = 100

export interface SafetyFeed {
  /** 按时间倒序（最新在前，便于面板直接渲染） */
  notices: Ref<SafetyNoticePayload[]>
  /** 是否有未读（error 级优先计数） */
  hasUnread: Ref<boolean>
  /** 是否有 error 级（供状态栏用更醒目的红点） */
  hasError: ComputedRef<boolean>
  markRead: () => void
  clear: () => void
}

export function useSafetyFeed(): SafetyFeed {
  const notices = ref<SafetyNoticePayload[]>([])
  const hasUnread = ref(false)
  const hasErrorLevel = ref(false)
  const hasError = computed(() => hasErrorLevel.value)

  function accept(n: SafetyNoticePayload): void {
    notices.value = [n, ...notices.value].slice(0, CAPACITY)
    hasUnread.value = true
    // error 级永久挂红点，直到用户主动 markRead —— 与 toast 的自动消失策略相反：
    // 「数据安全出问题」不该自己消失。
    if (isErrorLevel(n.kind)) hasErrorLevel.value = true
  }

  // 1) 补拉：窗口 ready 之前的事件
  void window.api
    .getSafetyNotices()
    .then((list) => {
      if (list.length) {
        // 主进程是正序（追加），此处倒序渲染；补拉**不**标记未读：
        // 这些是「启动时就有」的历史，用户还没看，但不该立刻闪红点
        notices.value = [...list].reverse().slice(0, CAPACITY)
      }
    })
    .catch(() => {
      // 拿不到就退化为「只显示运行期事件」，绝不打断启动
    })

  // 2) 订阅：运行期事件
  const unsubscribe = window.api.onSafetyNotice(accept)

  onBeforeUnmount(() => {
    unsubscribe()
  })

  return {
    notices,
    hasUnread,
    hasError,
    markRead: () => {
      hasUnread.value = false
      hasErrorLevel.value = false
    },
    clear: () => {
      notices.value = []
      hasUnread.value = false
      hasErrorLevel.value = false
    },
  }
}

/** 降级类型 → i18n 键（透出便于组件内联使用，不引整个 utils） */
export type { SafetyKind }
