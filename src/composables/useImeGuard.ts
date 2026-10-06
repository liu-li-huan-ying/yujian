import { onBeforeUnmount, onMounted } from 'vue'
import { createImeGuard, type ImeKeyInput } from '../utils/imeGuard'

/**
 * 中文输入法（IME）守卫的**接线层**（2026-10-04）。
 *
 * ## 动机
 *
 * 项目主打中文排版（`UI-DESIGN.md` 整个设计体系围着中文转），却从未处理 IME 组字。
 * 候选词上屏期间按下的键**属于输入法而非编辑器**，此时应用抢键的典型症状：
 *
 * - `Ctrl+S` / `Ctrl+B` 被当成用户命令 → **「拼音打了一半被保存 / 被加粗」**
 * - `Ctrl+K` / `Ctrl+Shift+P` → **命令面板凭空弹出**
 * - `Enter` 被抢 → **按回车没换行，而是选了候选词**
 *
 * 这对每天用中文写东西的用户是**每天都在经历**的，不是边缘场景。
 *
 * ## 为什么必须接在**捕获阶段**
 *
 * `App.vue` 的两个快捷键入口都在捕获阶段抢键（先于编辑器 keymap 拿到事件）。
 * 捕获阶段一旦 `preventDefault()`，输入法就收不到有效输入 —— 故必须**先问 IME**、
 * 决定放行之后再谈拦截顺序。「拦的时候再说」在这里是错的。
 *
 * ## 为什么要拆成接线层
 *
 * 这段逻辑约 30 行，若留在 App.vue 会把它的行数推到上限之外（当时已 1490/1500）。
 * 且它是**纯接线**（注册监听 + 维护状态），不含任何业务判断 —— 判断都在
 * `utils/imeGuard.ts`（可单测）。故这里只做「绑定 / 解绑」，不写判断。
 */
export interface ImeGuardBinding {
  /** 供快捷键处理函数查询：此刻是否应让开（true = 放行给输入法） */
  shouldYield: (e: ImeKeyInput & { keyCode?: number; isComposing?: boolean }) => boolean
}

export function useImeGuard(): ImeGuardBinding {
  const guard = createImeGuard()

  // 捕获阶段监听：部分输入法场景下 composition 事件不冒泡到 window。
  // 只维护状态、不做任何拦截（拦截判定在 shouldYield，由调用方在自己的流程里做）。
  const onStart = () => guard.onCompositionStart()
  const onEnd = () => guard.onCompositionEnd()
  // ⚠️ 失焦兜底复位：某些输入法在窗口失焦时**不触发** compositionend，
  // 于是 composing 永远为 true → 用户切回来后所有快捷键失效，
  // 表现像「编辑器坏了」。这是输入法集成最常见的一类「玄学 bug」。
  const onBlur = () => guard.reset()

  onMounted(() => {
    window.addEventListener('compositionstart', onStart, true)
    window.addEventListener('compositionend', onEnd, true)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    // 必须与注册时**完全对称**（含捕获标志）：漏解绑会导致 HMR 后重复注册，
    // 一次按键触发多次快捷键动作 —— 极难排查。
    window.removeEventListener('compositionstart', onStart, true)
    window.removeEventListener('compositionend', onEnd, true)
    window.removeEventListener('blur', onBlur)
  })

  return { shouldYield: (e) => guard.shouldYield(e) }
}
