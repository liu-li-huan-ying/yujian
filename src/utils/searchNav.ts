/**
 * 搜索结果导航 / 当前行推导的纯逻辑。
 *
 * 为什么单独成文件：这些判断原本埋在 `Sidebar.vue` 的搜索块里，无法断言。
 * 刻意保持**零依赖**（不 import vue、不碰 IPC），这样 `scripts/test-core.mjs`
 * 直接 `bundle()` 就能测，不必牵出组件与 i18n。
 */
import type { SearchFileResult } from '../../electron/shared/ipc-channels'

/** 把任意序号折算成 `[0, len)` 内的合法下标（负数与超界都循环回绕） */
export function wrapIndex(i: number, len: number): number {
  if (len <= 0) return 0
  return ((i % len) + len) % len
}

/** 下一处：未选中（-1）时从头开始，末尾回绕到首个 */
export function nextIndex(current: number, len: number): number {
  if (len <= 0) return -1
  return wrapIndex(current < 0 ? 0 : current + 1, len)
}

/** 上一处：未选中（-1）时从末尾开始（符合「向上找」直觉），首个回绕到末尾 */
export function prevIndex(current: number, len: number): number {
  if (len <= 0) return -1
  return wrapIndex(current < 0 ? len - 1 : current - 1, len)
}

/**
 * 重新推导「当前命中行」。
 *
 * 替换会改写文件，行号可能整体偏移，替换前记下的行号随之失效——若沿用旧值，
 * 编辑器会高亮到一个已经不存在的命中位置。故替换后重新取一个仍然有效的命中：
 * 优先当前活动文档的首个命中（用户视线所在），否则首个文件的首个命中，都没有则清空。
 */
export function pickCurrentLine(
  results: SearchFileResult[],
  activePath: string | null | undefined,
): number | undefined {
  const inActive = activePath ? results.find((r) => r.path === activePath) : undefined
  const target = inActive ?? results[0]
  return target && target.hits.length ? target.hits[0].line : undefined
}
