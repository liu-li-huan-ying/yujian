/** 版本快照 IPC（列表 / 创建 / 恢复 / 删除 / 打标签）。 */

import { ipcMain } from 'electron'
import { IPC, type SnapshotInfo } from '../../shared/ipc-channels'
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
  setSnapshotTags,
} from '../snapshots'

export function registerSnapshotsIpc(): void {
  // ── 版本快照（Phase 2 批次二）──

  ipcMain.handle(
    IPC.SNAPSHOT_LIST,
    async (_event, vaultPath: string, filePath: string): Promise<SnapshotInfo[]> =>
      listSnapshots(vaultPath, filePath),
  )

  ipcMain.handle(
    IPC.SNAPSHOT_CREATE,
    async (
      _event,
      vaultPath: string,
      filePath: string,
      content: string,
      note?: string,
      tags?: string[],
      branch?: string,
    ): Promise<SnapshotInfo> => createSnapshot(vaultPath, filePath, content, note, tags, branch),
  )

  ipcMain.handle(
    IPC.SNAPSHOT_RESTORE,
    async (_event, vaultPath: string, filePath: string, id: string): Promise<string> =>
      restoreSnapshot(vaultPath, filePath, id),
  )

  ipcMain.handle(
    IPC.SNAPSHOT_DELETE,
    async (_event, vaultPath: string, filePath: string, id: string): Promise<void> =>
      deleteSnapshot(vaultPath, filePath, id),
  )

  ipcMain.handle(
    IPC.SNAPSHOT_SET_TAGS,
    async (
      _event,
      vaultPath: string,
      filePath: string,
      id: string,
      tags: string[],
    ): Promise<SnapshotInfo | null> => setSnapshotTags(vaultPath, filePath, id, tags),
  )
}
