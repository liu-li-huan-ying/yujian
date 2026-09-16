import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createSnapshot, deleteSnapshot, listSnapshots, HISTORY_DIR_NAME } from './snapshots'
import { resolveVaultRoot } from './vault/context'
import { reportSoftError } from './softError'

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
): Promise<boolean> {
  try {
    if (!shouldBackup(prevContent)) return false
    // 不备份历史目录自身（理论上不会发生：`.yujian-history` 内不含 .md 之外的写目标）
    if (filePath.includes(`${HISTORY_DIR_NAME}`)) return false
    const vault = await resolveVaultRoot(filePath)
    if (!vault) return false

    const prev = await listSnapshots(vault, filePath)
    const autos = prev.filter((s) => s.note === AUTO_NOTE)
    // 与最近一份自动备份内容相同 → 无新信息，跳过（避免连续自动保存堆同一份内容）
    if (autos.length > 0 && autos[0].contentHash === sha1(prevContent)) return false

    await createSnapshot(vault, filePath, prevContent, AUTO_NOTE)
    await pruneAutoBackups(vault, filePath)
    return true
  } catch (e) {
    // 备份失败绝不能阻断保存本身——本次保存照常进行，但必须留痕（否则用户以为有安全网）
    reportSoftError('autoBackup', e, 'warn')
    return false
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

/** 导出常量供测试与 UI 复用 */
export const AUTO_BACKUP_NOTE = AUTO_NOTE
export const AUTO_BACKUP_LIMIT = MAX_AUTO_BACKUPS

/** 读取磁盘原文（不存在 → 空串，表示「新文件、无需备份」） */
export async function readPrevContent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}
