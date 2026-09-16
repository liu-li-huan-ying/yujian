/**
 * 模态焦点陷阱的**纯逻辑层** —— 只做「取可聚焦元素」与「按方向取下一个」，
 * 不碰 Vue、不碰 IPC，故能被 `scripts/lib/bundle.mjs` 打包后用最小 DOM 桩测试。
 *
 * ## 为什么需要它
 * 站内所有对话框（ConfirmDialog / MoveDialog / CompilePanel / ConflictDialog /
 * 命令面板）此前都只是渲染了一个 `role="dialog" aria-modal="true"` 的盒子：
 * 打开时焦点仍留在背后的编辑器或侧栏，Tab 会一路走出对话框跳到背景按钮，
 * 关闭后焦点也不归还触发元素 —— 键盘用户开完一个框就得重新找焦点在哪。
 *
 * ## 为什么把「取元素」和「接事件」分开
 * 取元素的规则（哪些算可聚焦、怎么回绕）是纯函数，值得断言锁住；
 * 而监听 keydown、记录并归还 `document.activeElement` 必须与组件生命周期绑定，
 * 那部分在 `src/composables/useFocusTrap.ts`。
 */

/**
 * 可聚焦元素选择器。
 * 说明：
 *  - 显式排掉 `disabled`（原生 disabled 的元素本就不可聚焦，且 :not() 已过滤）；
 *  - 排掉 `type="hidden"` 的 input（永远不可聚焦）；
 *  - `[tabindex]` 单独收口，但排掉 `tabindex="-1"`（只能脚本聚焦，不进 Tab 序列）；
 *    这一条很重要 —— 命令面板的列表项就是 `tabindex="-1"`（由 aria-activedescendant 驱动），
 *    若不排除，Tab 会跳进列表导致方向键失效。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 取容器内所有「此刻可聚焦」的元素，按 DOM 顺序。
 * 过滤掉 `[hidden]` 与 `aria-hidden="true"`（对读屏与键盘都不可见的元素不该被聚焦）。
 * 找不到或容器为空时返回空数组 —— 调用方须据此降级为「不劫持 Tab」，而不是报错。
 */
export function getFocusable(root: ParentNode | null): HTMLElement[] {
  if (!root) return []
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return all.filter((el) => {
    // 用 getAttribute 而非 hasAttribute：最小 DOM 桩只需实现前者，便于单测
    if (el.getAttribute('hidden') !== null) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    return true
  })
}

/**
 * 在可聚焦列表里按方向取下一个（到头回绕）。
 * - 列表为空 → null（调用方让它降级）
 * - `current` 不在列表里（初次进入 / 焦点在容器外）→ 正向取第一个、反向取最后一个
 */
export function nextFocusable(
  list: HTMLElement[],
  current: Element | null | undefined,
  backwards = false,
): HTMLElement | null {
  if (list.length === 0) return null
  const idx = current ? list.indexOf(current as HTMLElement) : -1
  if (idx === -1) return backwards ? list[list.length - 1] : list[0]
  const step = backwards ? -1 : 1
  return list[(idx + step + list.length) % list.length] ?? null
}
