/**
 * 库上下文：当前库根路径 + 「程序化改动抑制窗」。
 *
 * 抑制窗的存在理由：主进程自己 create/rename/move/delete 时，每文件 add/unlink 事件
 * 已增量维护索引，此时再全量 reconcile 纯属冗余且在大库上很重。仅抑制程序化改动，
 * 外部改动（资源管理器里建/删）仍照常 reconcile，不丢一致性。
 */

import { dirname, join } from 'node:path'
import { HISTORY_DIR_NAME } from '../snapshots'
import { INDEX_DIR_NAME } from '../vaultIndex'
import { exists } from './fsUtils'

/**
 * 当前笔记库根（由 watchVault 写入）。移动 / 删除文档时需要它来定位
 * `<root>/.yujian-history/<sha1(文档绝对路径)>` 历史目录，使历史随文档一起迁移 / 清理。
 */
let vaultRoot: string | null = null

/**
 * 程序化改动抑制窗：主进程自己执行 create / rename / move / delete 时置位，
 * 让 watchVault 的 addDir/unlinkDir 不再触发昂贵的全量 reconcileIndex（每文件 add/unlink
 * 事件已增量维护索引，全量 reconcile 纯属冗余且在大库上很重）。仅抑制「程序化」改动，
 * 外部改动（资源管理器里建/删）仍会照常 reconcile，不丢索引一致性。
 */
let progSuppressUntil = 0
/**
 * 解析「库根」——关联数据（`.assets` / `.yujian-history/<sha1>`）随迁的定位基准。
 *
 * 优先用 watchVault 记录的值；未记录时从给定路径向上找库根标记（`.yujian-history` / `.mdeditor`）。
 * 为什么要兜底：这些操作只该在库内发生，但一旦库根为空就会**静默跳过迁移**，
 * 快照留在旧哈希桶里变成孤儿、附件留在旧名字上——且没有任何痕迹。
 * 而两个标记恰好只在「确实有东西要迁移」时才存在，故向上查找是可靠的。
 */
export async function resolveVaultRoot(fromPath: string): Promise<string | null> {
  if (vaultRoot) return vaultRoot
  let dir = dirname(fromPath)
  for (;;) {
    if ((await exists(join(dir, HISTORY_DIR_NAME))) || (await exists(join(dir, INDEX_DIR_NAME)))) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}
export function markProgrammaticChange(windowMs = 1500): void {
  progSuppressUntil = Date.now() + windowMs
}

/** 写入当前库根（由 watchVault 调用）——关联数据随迁的定位基准 */
export function setVaultRoot(root: string): void {
  vaultRoot = root
}

/** 是否处于程序化改动抑制窗内（供目录级 reconcile 判断是否可跳过） */
export function isProgrammaticSuppressed(): boolean {
  return Date.now() < progSuppressUntil
}
