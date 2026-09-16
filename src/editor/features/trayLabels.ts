/**
 * 药丸托盘的「语言提示」补丁 —— 给 Crepe 自带的块操作手柄补 title / aria-label。
 *
 * ## 问题
 * Crepe 的块操作手柄（正文块左侧那个「+」与六点拖拽把手）在源码里是**裸 div**：
 *   `h('div', { class: 'operation-item' }, h(Icon, { icon }))`
 * 既无 `title` 也无 `aria-label`（对比行内工具条，它有 label / aria-keyshortcuts）。
 * 结果：鼠标悬停只有图标没有说明，读屏软件念不出任何信息——两处方药丸托盘的
 * 「语言提示」待遇不一致，正是用户反馈的点。
 *
 * ## 为什么在 DOM 上补而不是改 Crepe 配置
 * Crepe 的 BlockEdit 特性**没有**暴露手柄文案的配置项（只有 `handleAddIcon` /
 * `handleDragIcon` 两个图标字段）。手柄节点由 BlockHandleView 在 `create()` 时
 * 一次性建好、整个编辑器生命周期内复用（ProseMirror 的 plugin view），
 * 故 `create()` 之后补一次属性即可长期生效，无需 MutationObserver。
 *
 * ## 顺序约定
 * 手柄在 DOM 里的两个 `.operation-item` 固定为 [＋新增, ⠿拖拽]（见源码 setup 返回的
 * Fragment 顺序），故按下标取用；若结构变化则找不到元素、静默跳过（不抛错）。
 */

/** 手柄两枚按钮的文案（由调用方从 i18n 传入，本模块不依赖 i18n） */
export interface HandleLabels {
  /** 「＋」：在此块下方插入新块 */
  add: string
  /** 「⠿」：拖拽移动此块 */
  drag: string
}

/**
 * 给容器内所有块操作手柄补 `title` / `aria-label` / `role`。
 * 幂等：重复调用只覆盖同样的值，不会叠加。
 * @returns 被打了标签的元素个数（供测试断言）
 */
export function decorateBlockHandles(root: ParentNode | null, labels: HandleLabels): number {
  if (!root) return 0
  const items = root.querySelectorAll<HTMLElement>('.milkdown-block-handle .operation-item')
  if (items.length === 0) return 0
  const texts: Array<[number, string]> = [
    [0, labels.add],
    [1, labels.drag],
  ]
  let done = 0
  for (const [idx, text] of texts) {
    const el = items[idx]
    if (!el || !text) continue
    el.setAttribute('title', text)
    el.setAttribute('aria-label', text)
    // 手柄本就是可点的操作件，补上 button 语义让读屏能聚焦
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '-1')
    done += 1
  }
  return done
}
