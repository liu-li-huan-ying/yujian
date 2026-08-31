import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SnapshotInfo } from '../../electron/shared/ipc-channels'

/** 主线分支名，与主进程 snapshots.ts 的 MAIN_BRANCH 保持一致 */
export const MAIN_BRANCH = 'main'

/**
 * 版本快照前端状态。
 *
 * 只缓存「当前文档」的快照列表与选中项；不持有文档内容。
 * - 列表由主进程从 `<vault>/.yujian-history/<hash>/` 读取（按时间倒序）。
 * - 创建/删除均走主进程：创建按内容哈希去重（blob 跨分支共享）；删除走系统回收站。
 * - 恢复/读取内容均经 `snapshotRestore`（主进程只读返回，不写盘）——由 EditorHost 把内容
 *   灌入编辑器并标脏，遵守「Markdown 往返保真」红线：快照即用户原文，自动保存一字不改写回。
 * - 轻量草稿分支：分支名直接存在每条快照上，分支清单由列表派生（无需额外 IPC）。
 */
export const useSnapshotsStore = defineStore('snapshots', () => {
  const list = ref<SnapshotInfo[]>([])
  const loading = ref(false)
  const selectedId = ref<string | null>(null)
  /** 当前查看的分支（默认主线） */
  const activeBranch = ref<string>(MAIN_BRANCH)

  /** 分支清单（含每份数），由列表派生；主线永远排最前 */
  const branches = computed<{ name: string; count: number }[]>(() => {
    const map = new Map<string, number>()
    for (const s of list.value) {
      const b = s.branch || MAIN_BRANCH
      map.set(b, (map.get(b) ?? 0) + 1)
    }
    const out = [...map.entries()].map(([name, count]) => ({ name, count }))
    return out.sort((a, b) => {
      if (a.name === MAIN_BRANCH) return -1
      if (b.name === MAIN_BRANCH) return 1
      return a.name.localeCompare(b.name)
    })
  })

  /** 当前分支内的快照（按时间倒序） */
  const branchList = computed<SnapshotInfo[]>(() =>
    list.value.filter((s) => (s.branch || MAIN_BRANCH) === activeBranch.value)
  )

  /** 重新拉取当前文档的快照列表 */
  async function refresh(vaultPath: string | null, filePath: string | null): Promise<void> {
    if (!vaultPath || !filePath) {
      list.value = []
      selectedId.value = null
      activeBranch.value = MAIN_BRANCH
      return
    }
    loading.value = true
    try {
      list.value = await window.api.snapshotList(vaultPath, filePath)
      // 兜底：当前分支若已不存在（被删空 / 切了文档），回落主线
      const names = new Set(list.value.map((s) => s.branch || MAIN_BRANCH))
      if (!names.has(activeBranch.value)) activeBranch.value = MAIN_BRANCH
    } finally {
      loading.value = false
    }
  }

  /** 保存一份快照（note / tags / branch 可选）；内容相同则主进程按哈希去重 */
  async function create(
    vaultPath: string | null,
    filePath: string | null,
    content: string,
    note?: string,
    tags?: string[],
    branch?: string
  ): Promise<void> {
    if (!vaultPath || !filePath) return
    await window.api.snapshotCreate(vaultPath, filePath, content, note, tags, branch)
    await refresh(vaultPath, filePath)
  }

  /** 更新某快照的命名标签（git tag 思想） */
  async function setTags(
    vaultPath: string | null,
    filePath: string | null,
    id: string,
    tags: string[]
  ): Promise<void> {
    if (!vaultPath || !filePath) return
    await window.api.snapshotSetTags(vaultPath, filePath, id, tags)
    await refresh(vaultPath, filePath)
  }

  /** 删除快照（主进程走回收站） */
  async function remove(vaultPath: string | null, filePath: string | null, id: string): Promise<void> {
    if (!vaultPath || !filePath) return
    await window.api.snapshotDelete(vaultPath, filePath, id)
    if (selectedId.value === id) selectedId.value = null
    await refresh(vaultPath, filePath)
  }

  /** 读取某快照内容（只读返回，用于恢复或 diff 预览） */
  async function read(
    vaultPath: string | null,
    filePath: string | null,
    id: string
  ): Promise<string | null> {
    if (!vaultPath || !filePath) return null
    try {
      return await window.api.snapshotRestore(vaultPath, filePath, id)
    } catch {
      return null
    }
  }

  return {
    list,
    loading,
    selectedId,
    activeBranch,
    branches,
    branchList,
    refresh,
    create,
    remove,
    read,
    setTags
  }
})
