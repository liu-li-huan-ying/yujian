/** 笔记库生命周期：列树 / 监听 / 搜索替换 / 断链检查 / 索引重建 / 完整性自检 / 备份恢复。 */

import { app, ipcMain } from 'electron'
import { copyFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  IPC,
  type IntegrityAction,
  type SearchOptions,
  type VaultChange,
} from '../../shared/ipc-channels'
import {
  checkLinks,
  listTree,
  replaceInVault,
  searchVault,
  stopWatching,
  watchVault,
} from '../vault'
import * as VaultBackup from '../vaultBackup'
import * as VaultIndex from '../vaultIndex'
import * as VaultIntegrity from '../vaultIntegrity'
import { reportSoftError } from '../softError'
import { getMainWindow } from '../window'

export function registerVaultIpc(): void {
  // ── 笔记库 ──

  /**
   * 空库欢迎文档：全新空库首次打开时，自动放入随包发布的《使用说明》。
   * 仅当库根不存在「使用说明.md」且没有任何 .md 笔记时播种，
   * 既保证「安装即自带」，又绝不污染已有笔记文件夹、也尊重用户的删除。
   */
  async function seedWelcomeDoc(root: string): Promise<void> {
    try {
      const target = join(root, '使用说明.md')
      if (existsSync(target)) return
      const entries = await readdir(root)
      if (entries.some((n) => /\.(md|markdown)$/i.test(n))) return
      const candidates = [
        join(process.resourcesPath, 'resources', '使用说明.md'),
        join(app.getAppPath(), 'resources', '使用说明.md'),
      ]
      const src = candidates.find((p) => existsSync(p))
      if (!src) return
      await copyFile(src, target)
    } catch (e) {
      reportSoftError('welcome.seed', e)
      // 播种失败静默忽略，绝不影响正常使用
    }
  }

  ipcMain.handle(IPC.VAULT_LIST, async (_event, root: string) => listTree(root))

  ipcMain.handle(IPC.VAULT_WATCH, (_event, root: string) => {
    watchVault(root, (change: VaultChange) => {
      getMainWindow()?.webContents.send(IPC.VAULT_CHANGE, change)
    })
    void seedWelcomeDoc(root)
  })

  ipcMain.handle(IPC.VAULT_UNWATCH, () => stopWatching())

  ipcMain.handle(
    IPC.VAULT_SEARCH,
    (_event, root: string, query: string, opts?: SearchOptions, file?: string) =>
      searchVault(root, query, opts, file),
  )

  ipcMain.handle(
    IPC.VAULT_REPLACE,
    (
      _event,
      root: string,
      query: string,
      replacement: string,
      opts?: SearchOptions,
      file?: string,
    ) => replaceInVault(root, query, replacement, opts, file),
  )

  ipcMain.handle(IPC.VAULT_CHECK_LINKS, async (_event, root: string) => checkLinks(root))

  // 统一索引层：手动重建（自检 / 用户触发）。索引是「可重建缓存」，丢失本会静默自动重建，此通道供显式重建。
  ipcMain.handle(IPC.VAULT_INDEX_REBUILD, async (_event, root: string) => {
    const built = await VaultIndex.buildIndex(root)
    await VaultIndex.saveIndex(root, built)
    return { ok: true, files: Object.keys(built.files).length }
  })

  // 完整性自检：扫描索引/磁盘不一致、孤儿快照、缺失附件、断链（详见 vaultIntegrity.ts）。
  ipcMain.handle(IPC.VAULT_INTEGRITY_CHECK, async (_event, root: string) =>
    VaultIntegrity.runIntegrityCheck(root),
  )

  // 一键修复：重建索引 / 删除孤儿快照（破坏性动作由前端二次确认后传入）。
  ipcMain.handle(IPC.VAULT_INTEGRITY_REPAIR, async (_event, root: string, actions: string[]) =>
    VaultIntegrity.repairIntegrity(root, actions as IntegrityAction[]),
  )

  // 整库备份：打包为 zip 到用户选定的目标路径（排除 .mdeditor 缓存）。
  ipcMain.handle(IPC.VAULT_BACKUP, async (_event, root: string, destZip: string) =>
    VaultBackup.backupVault(root, destZip),
  )

  // 整库恢复：从 zip 解包到目标根（默认当前 vault 根，覆盖同名文件；含 zip-slip 防护）。
  ipcMain.handle(IPC.VAULT_RESTORE, async (_event, zipPath: string, targetRoot: string) =>
    VaultBackup.restoreVault(zipPath, targetRoot),
  )
}
