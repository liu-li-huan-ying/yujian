import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SnapshotInfo } from '../../electron/shared/ipc-channels'

/**
 * 版本快照前端状态。
 *
 * 只缓存「当前文档」的快照列表与选中项；不持有文档内容。
 * - 列表由主进程从 `<vault>/.yujian-history/<hash>/` 读取（按时间倒序）。
 * - 创建/删除均走主进程：创建自动去重（与最新一份相同则复用）；删除走系统回收站。
 * - 恢复/读取内容均经 `snapshotRestore`（主进程只读返回，不写盘）——由 EditorHost 把内容
 *   灌入编辑器并标脏，遵守「Markdown 往返保真」红线：快照即用户原文，自动保存一字不改写回。
 */
export const useSnapshotsStore = defineStore('snapshots', () => {
  const list = ref<SnapshotInfo[]>([])
  const loading = ref(false)
  const selectedId = ref<string | null>(null)

  /** 重新拉取当前文档的快照列表 */
  async function refresh(vaultPath: string | null, filePath: string | null): Promise<void> {
    if (!vaultPath || !filePath) {
      list.value = []
      selectedId.value = null
      return
    }
    loading.value = true
    try {
      list.value = await window.api.snapshotList(vaultPath, filePath)
    } finally {
      loading.value = false
    }
  }

  /** 保存一份快照（note / tags 可选）；内容相同则主进程按哈希去重 */
  async function create(
    vaultPath: string | null,
    filePath: string | null,
    content: string,
    note?: string,
    tags?: string[]
  ): Promise<void> {
    if (!vaultPath || !filePath) return
    await window.api.snapshotCreate(vaultPath, filePath, content, note, tags)
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

  return { list, loading, selectedId, refresh, create, remove, read, setTags }
})
