/**
 * 阅读进度条的核心判定（纯函数，供 `components/ReadingProgress.vue` 使用，可 Node 单测）
 *
 * 进度 = scrollTop / (scrollHeight - clientHeight)。麻烦全在**分母**：
 * 开关侧栏 / 大纲、窗口缩放、字体变化都会让内容重排、scrollHeight 变化，
 * 而用户根本没滚动——若照单全收，进度条就会「点个按钮 / 看眼大纲」莫名跳一下。
 *
 * 判定原则：**只有滚动位置（top）变了才算用户滚动**；仅高度（max）变化属布局回流，
 * 保持刻度不动，直到用户真正滚动（届时按新布局重算，位置自然正确）。
 */

/** 进度死区（百分比）：真实滚动中的像素级抖动小于此值时不重绘，避免刻度抖 */
export const MIN_PROGRESS_STEP = 0.15

/** 由滚动位置算百分比（0..100，越界夹紧）。max <= 0 视为不可滚动 */
export function progressPercent(top: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.max(0, (top / max) * 100))
}

export interface ProgressSample {
  /** 本次采样的滚动位置 */
  top: number
  /** 本次采样的可滚动高度（scrollHeight - clientHeight） */
  max: number
  /** 上次采纳的滚动位置 */
  lastTop: number
  /** 上次采纳的可滚动高度 */
  lastMax: number
  /** 当前显示的进度（百分比） */
  prev: number
  /** 强制采纳（换文档 / 拖拽跳转等显式意图） */
  force?: boolean
}

/**
 * 判定本次采样是否应改写进度刻度。
 * - 不可滚动（max <= 1）→ 采纳（调用方据此回落 0 并隐藏）；
 * - force → 采纳；
 * - 只有高度变了、位置没变（纯布局回流）→ 不采纳；
 * - 变化小于死区且不在两端 → 不采纳（滤掉亚像素抖动）；
 * - 其余（位置确实变了）→ 采纳。
 */
export function acceptProgress(a: ProgressSample): boolean {
  if (a.max <= 1) return true
  if (a.force) return true
  const topChanged = a.top !== a.lastTop
  const maxChanged = a.max !== a.lastMax
  if (!topChanged && maxChanged) return false
  const next = progressPercent(a.top, a.max)
  if (Math.abs(next - a.prev) < MIN_PROGRESS_STEP && next > 0 && next < 100) return false
  return true
}
