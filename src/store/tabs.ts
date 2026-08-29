import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 多文档标签状态。
 *
 * 设计要点（守住 Milkdown 单实例红线）：
 * - 本 store 只管理「打开的路径集合 + 当前激活路径」，不持有任何编辑器内容。
 * - 文档内容 / 脏状态 / 自动保存由唯一的 EditorHost 单实例负责。
 * - 切换标签时由 App 先 `host.save()`（落盘脏数据）再 `activePath` 变更，
 *   EditorHost 监听 activePath 调 `load(newPath)` —— 永远是「单实例换内容」。
 */
export interface TabItem {
  path: string
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([])
  const activePath = ref<string | null>(null)

  const activeIndex = computed(() =>
    activePath.value ? tabs.value.findIndex((t) => t.path === activePath.value) : -1
  )

  function has(path: string): boolean {
    return tabs.value.some((t) => t.path === path)
  }

  /** 打开文档：未打开则加入列表并激活；已打开则仅激活（不重复添加） */
  function open(path: string): void {
    if (!has(path)) tabs.value.push({ path })
    activePath.value = path
  }

  /** 激活已存在的标签（不存在则忽略） */
  function activate(path: string): void {
    if (!has(path)) return
    activePath.value = path
  }

  /**
   * 关闭一个标签：若关闭的是激活项，激活相邻项（优先右侧，否则左侧）。
   * 返回被关闭的路径，供调用方决定是否需保存该文档。
   */
  function close(path: string): string | null {
    const idx = tabs.value.findIndex((t) => t.path === path)
    if (idx === -1) return null
    tabs.value.splice(idx, 1)
    if (activePath.value === path) {
      if (tabs.value.length === 0) {
        activePath.value = null
      } else {
        const nextIdx = Math.min(idx, tabs.value.length - 1)
        activePath.value = tabs.value[nextIdx].path
      }
    }
    return path
  }

  /** 关闭除指定标签外的全部（保留顺序） */
  function closeOthers(path: string): void {
    tabs.value = tabs.value.filter((t) => t.path === path)
    activePath.value = path
  }

  /** 关闭指定标签及其右侧全部 */
  function closeToRight(path: string): void {
    const idx = tabs.value.findIndex((t) => t.path === path)
    if (idx === -1) return
    tabs.value = tabs.value.slice(0, idx + 1)
    if (activePath.value && !tabs.value.some((t) => t.path === activePath.value)) {
      activePath.value = path
    }
  }

  /** 从持久化恢复（启动会话重建） */
  function restore(paths: string[], active: string | null): void {
    tabs.value = paths.map((p) => ({ path: p }))
    activePath.value = active && has(active) ? active : (tabs.value[0]?.path ?? null)
  }

  /** 当前打开标签的路径数组（用于会话持久化） */
  const paths = computed(() => tabs.value.map((t) => t.path))

  return {
    tabs,
    activePath,
    activeIndex,
    paths,
    has,
    open,
    activate,
    close,
    closeOthers,
    closeToRight,
    restore
  }
})
