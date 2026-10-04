/**
 * 库级 fs 帮手：存在性判断、权限错误识别、只读属性递归清除、回收站优先删除、递归收集文档。
 * 全部为「无状态工具」，不持有库根，故不依赖 context（依赖方向单向：context → fsUtils）。
 */

import { access, chmod, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMarkdown, shouldSkipDir } from '../vaultIndex'
import { trashItem } from '../trash'
import { reportSoftError } from '../softError'
import { notifySafety } from '../safetyEvents'

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** 递归收集目录树下全部 Markdown 文档绝对路径（与 listTree 同跳过规则，跳过 .yujian-history 等） */
export async function collectMarkdownPaths(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch (e) {
      // 目录不可读 → 其内部文档会被整体漏掉（关联数据迁移不完整），留痕便于排查
      reportSoftError('vault.readdir', e, 'warn')
      return
    }
    for (const entry of entries) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        await walk(full)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(dir)
  return out
}

/** 递归清除目标树内所有只读属性（Windows 上目录/文件只读会让 rm/scandir 抛 EPERM，外部盘/云同步常见） */
export async function clearReadOnlyRecursive(p: string): Promise<void> {
  let st
  try {
    st = await stat(p)
  } catch {
    return
  }
  try {
    await chmod(p, 0o777)
  } catch (e) {
    reportSoftError('vault.chmod', e, 'debug')
    // 单条失败忽略，继续处理其他条目
  }
  if (!st.isDirectory()) return
  let entries
  try {
    entries = await readdir(p, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    await clearReadOnlyRecursive(join(p, e.name))
  }
}

/**
 * 删除结果。`fellBack` 为 true 表示**回收站不可用、已改为永久删除** —— 不可撤销。
 * 2026-10-04：返回值从 void 改为结构化，调用方才能把「静默降级」告知用户。
 */
export interface TrashResult {
  /** 走了系统回收站（可恢复） */
  viaTrash: boolean
  /** 降级为永久删除（不可恢复） */
  fellBack: boolean
}

/**
 * 删除：优先进系统回收站（可恢复、且能规避多数 Windows 只读/外部盘 EPERM），失败回退 rm（清只读后）
 *
 * ⚠️ 回退 rm 意味着**不可撤销**。原实现把它记成 `debug` 级软错误 —— 而软错误要用户
 * 主动打开完整性面板才看得到，等于「悄悄永久删除、界面仍显示成功」。
 * 现改为 `warn` + 上报安全事件，由 UI 明确告知（原则：宁可打扰也不能静默）。
 */
export async function trashOrRemove(targetPath: string): Promise<TrashResult> {
  try {
    await trashItem(targetPath)
    return { viaTrash: true, fellBack: false }
  } catch (e) {
    reportSoftError('trash.fallback', e, 'warn')
    notifySafety('trash-fallback', [targetPath], '回收站不可用，已改为永久删除（无法撤销）')
  }
  if (process.platform === 'win32') {
    await clearReadOnlyRecursive(targetPath).catch(() => {})
  }
  await rm(targetPath, { recursive: true, force: true })
  return { viaTrash: false, fellBack: true }
}

/** 是否为权限类错误（Windows 上建目录/删目录常被只读属性或云盘驱动以 EPERM/EACCES 形式拦截） */
export function isPermError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EACCES'
}
