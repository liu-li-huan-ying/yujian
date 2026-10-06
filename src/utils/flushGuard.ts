/**
 * 失焦 / 隐藏时的保存策略（纯逻辑层，无 vue / 无 DOM，可被 `bundle()` 直测）。
 *
 * ## 为什么需要它
 *
 * 自动保存靠 `setTimeout(…, 800)` 定时器。Electron 默认 `backgroundThrottling: true`，
 * 窗口**失焦或隐藏**时 Chromium 会把定时器限流到约 1 次/秒 —— 于是：
 *
 * - 用户切到浏览器查资料（写作场景极常见）→ 自动保存被推迟；
 * - 极端情况下（系统休眠唤醒前）可能一直不触发 → 关窗口丢内容。
 *
 * 有三种解法：
 *  1. 全局 `backgroundThrottling: false` —— 简单，但**后台一直满负荷渲染**，耗电；
 *  2. 失焦即保存（本方案）—— 精准、代价小，且语义正确（用户离开编辑器 = 可能要保存）；
 *  3. 等节流自己恢复 —— 最省事但不可靠。
 *
 * 故选 2。**不选 1**，因为「省几行代码」不值得让所有用户在后台烧 CPU。
 *
 * ## 为什么监听两个事件
 *
 * - `visibilitychange`：标签页/窗口被隐藏（切到别的应用、最小化）时触发；
 * - `blur`：窗口失焦但仍可见时触发。
 * 二者部分重叠（隐藏必然先失焦），故靠 `flushOnce` 保证**幂等** ——
 * 短时间内的重复触发只保存一次，不做无意义的重复 IO。
 */
/**
 * 事件目标与可见性查询的最小接口（注入而非直接用 `window` / `document`）。
 *
 * 为什么要注入：纯逻辑层一旦直接摸 `window`，就无法被 `bundle()` 直测
 * （Node 环境无 window），只能靠起浏览器测 —— 那会让「幂等 / 闸门」这类
 * 纯逻辑的断言无从下手。本项目的惯例正是如此（如 `paletteHotkey` 只收事件字段）。
 */
export interface FlushTarget {
  addEventListener: (type: string, fn: () => void, capture?: boolean) => void
  removeEventListener: (type: string, fn: () => void, capture?: boolean) => void
  /** 当前是否不可见 */
  isHidden: () => boolean
}

/** 默认目标：真实浏览器环境 */
export function browserTarget(): FlushTarget {
  return {
    addEventListener: (t, fn) => window.addEventListener(t, fn),
    removeEventListener: (t, fn) => window.removeEventListener(t, fn),
    isHidden: () => document.visibilityState === 'hidden',
  }
}

export type FlushReason = 'hidden' | 'blur'

export interface FlushGuard {
  /** 绑定事件；返回解绑函数 */
  attach: (onFlush: (reason: FlushReason) => void, target: FlushTarget, minGapMs?: number) => () => void
  /** 清空节流闸门（切文档时调用：新文档不该被上一文档的节流窗口挡掉） */
  reset: () => void
}

/**
 * @param minGapMs 两次保存之间的最小间隔。取值要略大于自动保存的 800ms，
 *   否则「blur 紧接一次 auto-save」会变成连续两次写盘。
 */
export function createFlushGuard(minGapMs = 1200): FlushGuard {
  let last = 0
  // 当前生效的闸门。attach 的 gap 参数**覆盖**它（允许调用方单独调整），
  // 而不是与创建时的值取小 —— 后者会让「传更小的间隔」被夹大，成为传了没用的假 API。
  let gap = minGapMs

  const flushOnce = (reason: FlushReason, onFlush: (r: FlushReason) => void): void => {
    const now = Date.now()
    if (now - last < gap) return
    last = now
    onFlush(reason)
  }

  return {
    attach(onFlush, target, gapMs) {
      if (gapMs != null) gap = gapMs
      // hidden 与 blur 部分重叠（隐藏必然先失焦）→ 靠 flushOnce 保证幂等
      const onVis = () => {
        if (target.isHidden()) flushOnce('hidden', onFlush)
      }
      const onBlur = () => flushOnce('blur', onFlush)
      target.addEventListener('visibilitychange', onVis)
      target.addEventListener('blur', onBlur)
      // 必须与注册时完全对称，否则 HMR 后重复注册 → 重复保存
      return () => {
        target.removeEventListener('visibilitychange', onVis)
        target.removeEventListener('blur', onBlur)
      }
    },
    reset() {
      last = 0
    },
  }
}
