import { ref } from 'vue'
import type { ViewKey } from '../components/ActivityBar.vue'

/** 左列停靠块：库级面板（与目录上下并列） */
export type LeftDockPanel = 'none' | 'tags' | 'moc'
/** 右列停靠块：文档级面板（与大纲上下并列） */
export type RightDockPanel = 'none' | 'backlinks' | 'snapshot'

export interface PkmPanelHooks {
  /** 活动栏「目录」→ 切换左列上块（目录栏）可见性 */
  toggleSidebar: () => void
  /** 活动栏「大纲」→ 切换右列上块（大纲栏）可见性 */
  toggleOutline: () => void
  /** 打开快照面板时刷新列表（需要当前库/文档上下文，由调用方提供） */
  onSnapshotShown: () => void
}

/**
 * 左缘活动栏驱动的「双栏 2×2 停靠布局」状态。
 *
 * 左右两列各自独立、可同时开（满足「同屏看标签 + 反链」），故这里只维护两个 bottom 槽位，
 * 不做任何全局互斥。抽出为 composable 是为了让 App.vue 只留模板绑定（见 CODE-REVIEW §2.2(1)）。
 */
export function usePkmPanels(hooks: PkmPanelHooks) {
  /** 左列底部停靠面板：库级（标签 / 内容地图），与目录上下并列；与右列独立，可同时开 */
  const leftBottom = ref<LeftDockPanel>('none')
  /** 右列底部停靠面板：文档级（反链 / 快照），与大纲上下并列；与左列独立，可同时开 */
  const rightBottom = ref<RightDockPanel>('none')

  /** 同键再点即收起（每次只影响本列，另一列不受牵动） */
  function toggleLeft(panel: Exclude<LeftDockPanel, 'none'>): void {
    leftBottom.value = leftBottom.value === panel ? 'none' : panel
  }
  function toggleRight(panel: Exclude<RightDockPanel, 'none'>): void {
    rightBottom.value = rightBottom.value === panel ? 'none' : panel
  }

  /**
   * 左缘活动栏点击：上块 = 目录 / 大纲（切栏可见性），下块 = 库级 / 文档级面板
   * （左右两列各自独立、可同时开，互不互斥）。
   */
  function onViewToggle(key: ViewKey): void {
    if (key === 'files') {
      hooks.toggleSidebar()
    } else if (key === 'outline') {
      hooks.toggleOutline()
    } else if (key === 'tags') {
      toggleLeft('tags')
    } else if (key === 'moc') {
      toggleLeft('moc')
    } else if (key === 'backlinks') {
      toggleRight('backlinks')
    } else if (key === 'snapshot') {
      toggleRight('snapshot')
      // 只有「展开」时才需要拉取，收起时不必空跑一次刷新
      if (rightBottom.value === 'snapshot') hooks.onSnapshotShown()
    }
  }

  return { leftBottom, rightBottom, onViewToggle }
}
