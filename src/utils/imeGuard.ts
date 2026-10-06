/**
 * 中文输入法（IME）守卫 —— 纯逻辑层（无 DOM / 无 vue，可被 `bundle()` 直测）。
 *
 * ## 要解决的问题（不是"少个功能"，是核心人群每天都在经历）
 *
 * 候选词上屏期间（`compositionstart` → `compositionend`），按下的按键
 * **属于输入法而非编辑器**。若此时应用抢键，会出现两类糟糕体验：
 *
 *  1. **快捷键误触**：候选词列表里恰好有 b/i/k 等字母时，
 *     Ctrl+B / Ctrl+I 会把候选上屏打断、却仍执行了加粗/斜体
 *     —— 用户得到「字打了一半，格式被改了」。
 *  2. **中英文混输被打断**：CapsLock、Enter、方向键在候选期间都有输入法语义，
 *     抢走就是「按了回车没换行，而是选了个候选」。
 *
 * ## 为什么不能靠「禁用所有快捷键」
 *
 * 用户在候选期间**可能**就是想切别的窗口、或按 Esc 取消候选 ——
 * 一刀切拦截会变成「输入法卡死」。正确做法：**只放过安全键**，
 * 其余全部放行给输入法。
 *
 * ## 为什么必须拦，而不是「不处理」
 *
 * `App.vue` 的命令面板/快速打开是在**捕获阶段**拦截的（先于编辑器 keymap 拿到事件）。
 * 捕获阶段抢键的代价是「它一定会被吃掉」——即使事件随后被输入法处理，
 * `preventDefault()` 也已经让编辑器收不到有效输入了。故必须在拦之前**先问 IME**。
 */

/** 守卫所需的最小字段集合（与 KeyboardEvent 同形，便于直接传事件） */
export interface ImeKeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * 候选词上屏期间**允许穿透**的键（放行给输入法/系统，绝不拦截）。
 *
 * 逐条理由：
 *  - `Escape` / `Enter` / `Tab` / 方向键 / Backspace / Delete：
 *    输入法自己的确认/取消/选词操作，抢掉等于「候选词点不动」。
 *  - 无修饰的**单字符**（含字母）：候选期间几乎一定是选词，
 *    判据统一交给 `key.length === 1`。
 *  - `Shift` / `Control` / `Alt` 本身：只是按住修饰键，不构成快捷键。
 */
function isSafeDuringComposition(e: ImeKeyInput): boolean {
  // ⚠️ 组字期间**一切带 Ctrl/Alt/Meta 的组合键都让开**。
  // 原因：候选词列表里就含 b/i/k/p 等字母，用户按 Ctrl+B / Ctrl+Shift+P 是在**选词**
  // （部分输入法支持用 Ctrl+字母跳选候选），不是要执行应用命令。
  // 若不挡，用户会得到「字打了一半，格式被改了 / 命令面板凭空弹出」。
  if (e.ctrlKey || e.metaKey || e.altKey) return true

  if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return true
  if (e.key === 'Backspace' || e.key === 'Delete') return true
  if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') return true
  if (e.key === 'PageUp' || e.key === 'PageDown') return true
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return true
  // 候选期间的普通字符：输入法在选词，放行
  if (e.key.length === 1) return true
  return false
}

/**
 * 快捷键是否应被**放行**（不拦截）—— 即「此刻是 IME 状态，别抢」。
 *
 * ⚠️ 返回值语义（曾因命名与语义相反而误读，务必看清）：
 * - `true`  = **放行**，不要 preventDefault / stopPropagation，交给输入法
 * - `false` = 不归 IME 管，按正常快捷键继续处理
 *
 * 用法（在捕获阶段拦截前）：
 * ```ts
 * if (shouldIgnoreDuringIme(e, composing)) return   // 放行，不 preventDefault
 * ```
 */
export function shouldIgnoreDuringIme(e: ImeKeyInput, composing: boolean): boolean {
  if (!composing) return false
  return isSafeDuringComposition(e)
}

/**
 * 从事件里读出「当前是否在输入法组字」。
 *
 * ⚠️ 为什么不用 `event.isComposing`：它在部分平台的 `keydown` 阶段仍是 false
 * （Chrome 的 keydown 早于 compositionstart）。故**必须同时看 `keyCode === 229`**
 * —— 229 是各浏览器/输入法统一的「这是组字期间的按键」标记，
 * 与 `isComposing` 互补，两者任一为真即视为组字中。
 */
export function isComposingEvent(e: {
  isComposing?: boolean
  keyCode?: number
}): boolean {
  return e.isComposing === true || e.keyCode === 229
}

/**
 * IME 守卫的状态机（渲染层持有）。
 *
 * 只记一个布尔量即可：`compositionstart` / `compositionend` 天然配对，
 * 而「keydown 时读 isComposing」不可靠（见上），故用事件对维护显式状态。
 */
export function createImeGuard() {
  let composing = false

  return {
    get composing() {
      return composing
    },
    /** 绑定到编辑区容器的 compositionstart / compositionend / blur */
    onCompositionStart(): void {
      composing = true
    },
    onCompositionEnd(): void {
      composing = false
    },
    /**
     * 失焦时兜底复位。
     * 为什么需要：某些输入法在窗口失焦时**不触发** compositionend，
     * 于是 composing 永远为 true → 用户切回来后所有快捷键失效（看起来像"编辑器坏了"）。
     */
    reset(): void {
      composing = false
    },
    /**
     * 快捷键处理入口：**返回 true = 放行**（别抢这个键）。
     * 命名与语义对齐靠前缀动词：should → 该不该「让开」。
     */
    shouldYield(e: ImeKeyInput & { keyCode?: number; isComposing?: boolean }): boolean {
      // 双保险：状态量 + 事件自带的 229 标记，任一命中即视为组字中
      return shouldIgnoreDuringIme(e, composing || isComposingEvent(e))
    },
  }
}
