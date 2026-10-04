import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createSnapshot, deleteSnapshot, listSnapshots, HISTORY_DIR_NAME } from './snapshots'
import { resolveVaultRoot } from './vault/context'
import { notifySafety } from './safetyEvents'

/**
 * 「保存前自动备份」保命防线 —— 自动保存覆盖磁盘前，把**上一版内容**留进版本历史。
 *
 * 为什么必须有这一层：编辑器的序列化是破坏性的（Crepe 把 `---` 变 `***`、`[[x]]` 变 `\[\[x]]`、
 * 吃掉 frontmatter），一旦这类 bug 再次漏网，**被写坏的内容就成了新的磁盘原文，无法自愈**——
 * 用户只能靠外部脚本抢救。有了保存前备份，任何一次覆盖都留得下上一版，可一键回滚。
 *
 * 设计取舍：
 *  - **只在库内生效**：库外单文件（无 `.yujian-history` / `.mdeditor` 标记）不做备份——
 *    否则会在用户任意目录里凭空造出历史目录，且那些目录未必归本编辑器管。
 *  - **只备份「有效正文」**：空文件 / 纯空白不备份（新建文档的首次写入会命中这条，
 *    避免每次新建都留一份空快照污染历史）。
 *  - **内容哈希去重**：与上一份自动备份内容相同则不重复留档（连续自动保存同一内容只留一份）。
 *  - **有界保留**：每个文档的自动备份最多保留 `MAX_AUTO_BACKUPS` 份，超出按时间删最旧的
 *    （走回收站，见 snapshots.deleteSnapshot）；**绝不触碰手工快照**。
 *  - **永不阻断保存**：任何失败都只记软错误，不向调用方抛——备份是安全网，不是保存的前置条件。
 */

/** 自动备份备注（同时是它与手工快照的区分标记） */
const AUTO_NOTE = '自动备份'

/**
 * 每个文档保留的自动备份份数上限。
 * 取 50：足够覆盖「连续几十次自动保存」这种踩坑窗口（每次编辑间隔数十秒，
 * 50 份约等于几十分钟到几小时的时间机器）；再多则历史目录体积失控。
 */
const MAX_AUTO_BACKUPS = 50

/** 内容 sha1 —— 与 snapshots.ts 同算法（内容寻址去重的键） */
function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

/**
 * 是否值得备份：内容非空且含非空白字符。
 * 新建文档的首次落盘（''）与「全选删除后保存」这类瞬间态都不值得留档。
 */
export function shouldBackup(content: string): boolean {
  return content.trim().length > 0
}

/** 路径是否位于库内（含主进程记录的库根，或向上能找到库标记） */
export async function resolveBackupVault(filePath: string): Promise<string | null> {
  return resolveVaultRoot(filePath)
}

/** 备份结果。`degraded` 非空即表示「安全网本次没起作用」，上层必须告知用户。 */
export interface BackupResult {
  ok: boolean
  /** 未留档的**具体原因**（无降级时为 undefined） */
  degraded?: 'empty' | 'outside-vault' | 'duplicate' | 'backup-failed' | 'history-dir'
}

/**
 * 保存前备份：把 `prevContent` 留进该文档的版本历史。
 *
 * @param filePath 文档绝对路径
 * @param prevContent 覆盖前的磁盘原文
 * @returns 是否真的留了一份新备份（内容重复 / 空内容 / 库外 → false）
 */
export async function backupBeforeSave(
  filePath: string,
  prevContent: string,
): Promise<BackupResult> {
  try {
    if (!shouldBackup(prevContent)) return { ok: false, degraded: 'empty' }
    // 不备份历史目录自身（理论上不会发生：`.yujian-history` 内不含 .md 之外的写目标）
    if (filePath.includes(`${HISTORY_DIR_NAME}`)) return { ok: false, degraded: 'history-dir' }
    const vault = await resolveVaultRoot(filePath)
    if (!vault) return { ok: false, degraded: 'outside-vault' }

    const prev = await listSnapshots(vault, filePath)
    const autos = prev.filter((s) => s.note === AUTO_NOTE)
    // 与最近一份自动备份内容相同 → 无新信息，跳过（避免连续自动保存堆同一份内容）
    if (autos.length > 0 && autos[0].contentHash === sha1(prevContent)) {
      return { ok: false, degraded: 'duplicate' }
    }

    await createSnapshot(vault, filePath, prevContent, AUTO_NOTE)
    await pruneAutoBackups(vault, filePath)
    return { ok: true }
  } catch (e) {
    // 备份失败绝不能阻断保存本身——本次保存照常进行，但必须让用户知道（原先只记软错误，
    // 而软错误要用户主动开面板才看得到，等于「有网实则无网」）。
    const err = e as NodeJS.ErrnoException
    notifySafety('backup-failed', [filePath], `自动备份失败（${err?.code ?? 'unknown'}），本次覆盖没有回滚点`)
    return { ok: false, degraded: 'backup-failed' }
  }
}

/**
 * 批量替换前的**一次性留档**。
 *
 * 为什么不能逐文件调 `backupBeforeSave`：
 *  1. 配额 —— `pruneAutoBackups` 只修剪**该文档**的自动备份，故 50 份上限不会被一次性打满；
 *     但每次 `backupBeforeSave` 都要 3 读 2 写（listSnapshots×2 + createSnapshot + prune），
 *     500 个文件 = 1500 读 + 1000 写，且 `deleteSnapshot` 走回收站 → 可能弹 500 次系统回收站。
 *  2. 配额偷跑 —— 批量留的那份会占掉该文档 1/50 的自动备份份额。
 *  3. 体积 —— N 个文件 × 1 份全文。
 *
 * 故走**独立 note**：与自动备份池物理分离（`pruneAutoBackups` 按 `note === AUTO_NOTE` 过滤，
 * 天然互不干扰），且**绝不调 prune**（没有东西需要修剪）。
 *
 * 上限 `BULK_BACKUP_LIMIT`：超出则**整批不备份并明确告知**（degraded='bulk-too-large'）——
 * 宁可少留档，也不静默不留，更不能把主进程卡住几十秒。
 */
export const BULK_BACKUP_LIMIT = 200

/** 批量替换留档的备注（第三类，区别于自动备份与手工快照） */
const BULK_NOTE = '批量替换前'

export interface BulkBackupResult {
  ok: boolean
  backedUp: number
  degraded?: 'bulk-too-large' | 'backup-failed' | 'outside-vault'
}

export async function backupBeforeBulkWrite(
  entries: ReadonlyArray<{ path: string; content: string }>,
): Promise<BulkBackupResult> {
  if (entries.length === 0) return { ok: true, backedUp: 0 }
  if (entries.length > BULK_BACKUP_LIMIT) {
    notifySafety(
      'bulk-too-large',
      [],
      `批量替换涉及 ${entries.length} 个文件，超过留档上限 ${BULK_BACKUP_LIMIT}，本次未留档`,
    )
    return { ok: false, backedUp: 0, degraded: 'bulk-too-large' }
  }
  let backedUp = 0
  try {
    for (const { path, content } of entries) {
      if (!shouldBackup(content)) continue
      if (path.includes(`${HISTORY_DIR_NAME}`)) continue
      const vault = await resolveVaultRoot(path)
      if (!vault) continue
      // 独立 note，不进自动备份池、不触发 prune
      await createSnapshot(vault, path, content, BULK_NOTE)
      backedUp++
    }
    return { ok: true, backedUp }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    notifySafety('backup-failed', [], `批量留档部分失败（${err?.code ?? 'unknown'}）`)
    return { ok: false, backedUp, degraded: 'backup-failed' }
  }
}

/**
 * 修剪自动备份：仅保留最近 `MAX_AUTO_BACKUPS` 份。
 * 手工快照（备注不同）与其它分支完全不动。
 */
async function pruneAutoBackups(vault: string, filePath: string): Promise<void> {
  const all = await listSnapshots(vault, filePath)
  // listSnapshots 已按时间倒序 → 超出上限的都是最旧的
  const autos = all.filter((s) => s.note === AUTO_NOTE)
  for (const old of autos.slice(MAX_AUTO_BACKUPS)) {
    await deleteSnapshot(vault, filePath, old.id)
  }
}

/** 判断某条快照是否为自动备份（供 UI 区分展示） */
export function isAutoBackupNote(note?: string): boolean {
  return note === AUTO_NOTE
}

/** 判断某条快照是否为批量替换留档（UI 需明确区分：它不受 50 份自动备份上限约束） */
export function isBulkBackupNote(note?: string): boolean {
  return note === BULK_NOTE
}

/** 导出常量供测试与 UI 复用 */
export const AUTO_BACKUP_NOTE = AUTO_NOTE
export const AUTO_BACKUP_LIMIT = MAX_AUTO_BACKUPS

/**
 * 读取磁盘原文。
 *
 * ⚠️ 为什么返回结构化结果而不是裸字符串（2026-10-04 改造）：
 * 旧实现是 `catch { return '' }` —— **任何**读取失败（EACCES 文件被锁 / EBUSY 云盘同步中 /
 * EISDIR 路径恰是目录）都被当成「文件不存在」返回空串。而 `shouldBackup('')` 为 false，
 * 于是调用方 `if (prev !== content) await backupBeforeSave(...)` 会**跳过备份直接覆盖**：
 * 用户以为有安全网，实际这一版覆盖**没有任何回滚点**。这是典型的静默失效。
 *
 * 现在把「真的没有这个文件」与「有文件但读不到」区分开 —— 前者是正常的新建，
 * 后者必须让上层知道安全网失效了。
 *
 * 注意：读失败**不阻断保存**（否则内容会丢，那是更糟的结果），只上报 `ok:false`。
 */
export type ReadPrevResult =
  | { ok: true; content: string }
  | { ok: false; reason: string }

export async function readPrevContent(filePath: string): Promise<ReadPrevResult> {
  try {
    return { ok: true, content: await readFile(filePath, 'utf-8') }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    // ENOENT = 真的没有这个文件（新文档首次保存），属正常，不是降级
    if (err?.code === 'ENOENT') return { ok: true, content: '' }
    return { ok: false, reason: err?.code ?? 'read-failed' }
  }
}
