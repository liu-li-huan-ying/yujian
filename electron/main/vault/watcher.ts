/**
 * 目录监听：外部改动推送给渲染层的同时增量维护统一索引（增改重解析 / 删除移除 /
 * 目录变动防抖全量对齐）。此处是库根被写入的唯一入口。
 */

import { basename } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import type { VaultChange, VaultChangeKind } from '../../shared/ipc-channels'
import { shouldSkipDir } from '../vaultIndex'
import { reportSoftError } from '../softError'
import { setVaultRoot } from './context'
import { deindexFile, ensureIndex, invalidateMaps, reindexFile, scheduleReconcile } from './indexStore'

/* ── 目录监听 ───────────────────────────────── */

let watcher: FSWatcher | null = null

/**
 * 监听笔记库变化。外部改动（别的编辑器保存、Git 切分支、资源管理器里改名）
 * 都会推送给渲染层，让文件树始终与磁盘一致；同时增量维护统一索引层。
 */
export function watchVault(root: string, onChange: (change: VaultChange) => void): void {
  stopWatching()
  setVaultRoot(root)

  // 惰性建立 / 载入索引（不阻塞监听启动；搜索与后续维护会用到）
  void ensureIndex(root).catch(() => {})

  watcher = chokidarWatch(root, {
    // 根目录自身不能被自己的忽略规则排除掉
    ignored: (p: string) => p !== root && shouldSkipDir(basename(p)),
    ignoreInitial: true,
    // 保存是「写临时文件 + rename」，等落盘稳定再上报，避免读到半截内容
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  })

  const emit =
    (kind: VaultChangeKind) =>
    (path: string): void => {
      onChange({ kind, path })
      // 增量维护索引：增改重解析、删除移除、目录变动防抖全量对齐（禁任何全库周期重算）
      if (kind === 'add' || kind === 'change') {
        void reindexFile(root, path)
      } else if (kind === 'unlink') {
        deindexFile(root, path)
      } else if (kind === 'addDir' || kind === 'unlinkDir') {
        invalidateMaps()
        scheduleReconcile(root)
      }
    }

  watcher
    .on('add', emit('add'))
    .on('unlink', emit('unlink'))
    .on('addDir', emit('addDir'))
    .on('unlinkDir', emit('unlinkDir'))
    .on('change', emit('change'))
    .on('error', (e) => {
      // 监听失败（例如库所在磁盘被拔出）不该让应用崩掉，但必须留痕
      reportSoftError('vault.watch', e, 'debug')
    })
}

export function stopWatching(): void {
  if (!watcher) return
  void watcher.close().catch(() => {})
  watcher = null
}
