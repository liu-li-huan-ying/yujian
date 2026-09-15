import { computed, ref, watch } from 'vue'
import { buildDiffRows, type DiffRow } from '../utils/snapshotDiff'
import { useSnapshotsStore } from '../store/snapshots'
import { i18n } from '../i18n'

/** diff 两侧的来源形态；`none` = 当前没有可比内容（面板据此不渲染 diff 视图） */
export type DiffMode = 'ab' | 'selected' | 'none'

export interface SnapshotDiffHooks {
  vaultPath: () => string | null
  filePath: () => string | null
  /** 当前文档文本（「当前稿 ↔ 选中快照」对比要用） */
  currentText: () => string
  /** 快照时间格式化：复用面板的 fmtTime，避免两处各写一份 */
  fmtTime: (ts: number) => string
}

/**
 * 快照对比状态机：A/B 选点 → 读快照内容 → 决定 diff 两侧 → 逐行 diff。
 *
 * 为什么收进一个 composable：这是一条**异步链**——`compareA / compareB` 一变就要去主进程读
 * 快照内容，读回来才能定 `diffMode`，再由 `diffMode` 决定 diff 的两侧。四个 ref 互相牵连、
 * 各带一个 watch；散在组件里最容易出现「选了 B，diff 却还停在旧内容」这类漏接线。
 *
 * 派生值（hunks / 增删统计 / 摘取高亮）属渲染关注，留在 `SnapshotDiffView.vue`。
 */
export function useSnapshotDiff(hooks: SnapshotDiffHooks) {
  const snapshots = useSnapshotsStore()

  /** 选中快照的内容（未选中 / 读取中为 null） */
  const previewContent = ref<string | null>(null)
  watch(
    () => snapshots.selectedId,
    async (id) => {
      previewContent.value = null
      if (!id) return
      previewContent.value = await snapshots.read(hooks.vaultPath(), hooks.filePath(), id)
    },
  )

  /* ── A / B 任意两点对比（可跨分支）── */
  const compareA = ref<string | null>(null)
  const compareB = ref<string | null>(null)
  const contentA = ref<string | null>(null)
  const contentB = ref<string | null>(null)
  function toggleA(id: string): void {
    compareA.value = compareA.value === id ? null : id
  }
  function toggleB(id: string): void {
    compareB.value = compareB.value === id ? null : id
  }
  watch(compareA, async (id) => {
    contentA.value = id ? await snapshots.read(hooks.vaultPath(), hooks.filePath(), id) : null
  })
  watch(compareB, async (id) => {
    contentB.value = id ? await snapshots.read(hooks.vaultPath(), hooks.filePath(), id) : null
  })

  /** 清空 A/B 对比（面板「清空对比」按钮） */
  function clearCompare(): void {
    compareA.value = null
    compareB.value = null
  }

  const diffMode = computed<DiffMode>(() => {
    if (compareA.value && compareB.value && contentA.value != null && contentB.value != null) {
      return 'ab'
    }
    if (snapshots.selectedId && previewContent.value != null) return 'selected'
    return 'none'
  })

  /** 参与 diff 的两侧文本：A↔B 对比 或 当前稿↔选中快照 */
  const diffSides = computed<[string | null, string | null]>(() => {
    if (diffMode.value === 'ab') return [contentA.value, contentB.value]
    if (diffMode.value === 'selected') return [hooks.currentText(), previewContent.value]
    return [null, null]
  })

  /** 摊平成「逐行」列表，便于模板渲染（纯逻辑见 src/utils/snapshotDiff） */
  const diffRows = computed<DiffRow[]>(() => buildDiffRows(...diffSides.value))

  /** 摘取来源标注（让用户清楚「摘的是哪一侧」） */
  const diffSource = computed<string>(() => {
    if (diffMode.value === 'ab') {
      const b = snapshots.branchList.find((s) => s.id === compareB.value)
      return b ? b.note || hooks.fmtTime(b.createdAt) : i18n.ui.snapshotSetB
    }
    const cur = snapshots.branchList.find((s) => s.id === snapshots.selectedId)
    return cur ? cur.note || hooks.fmtTime(cur.createdAt) : ''
  })

  return {
    compareA,
    compareB,
    toggleA,
    toggleB,
    diffMode,
    diffRows,
    diffSource,
    clearCompare,
  }
}
