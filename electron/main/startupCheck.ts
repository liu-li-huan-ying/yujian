import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { listTmpResidue, type TmpResidue } from './tmpResidue'
import { notifySafety } from './safetyEvents'
import { getSoftErrors } from './softError'

/**
 * 启动自检：**只做 O(1) 探针**，发现「这台机器上安全网不工作」就报告。
 *
 * ## 为什么需要
 *
 * 三条已修复的静默失效（备份失败 / 读不到原文 / 回收站不可用）此前都是
 * **只有用户主动打开完整性面板才看得见**。若用户的库放在网络盘 / U 盘 /
 * 只读目录上，那么「保存必失败」「删除必永久执行」从第一次使用就成立，
 * 而用户完全不知情 —— 直到某天真的丢了内容。
 *
 * ## 铁律：启动绝不跑全库扫描
 *
 * `vaultIntegrity` 明确规定「自检只在用户显式触发时运行」（断链 / 损坏检测要
 * `readFile` 全库正文，大库上会让启动卡顿到不可用）。本模块**只做常数级探针**，
 * 且不读取任何用户正文。把它当「后台周期性全库自检」是错的用法。
 */

export interface StartupFinding {
  kind:
    | 'vault-not-writable'
    | 'trash-unavailable'
    | 'tmp-residue'
    | 'soft-error-warn'
  level: 'error' | 'warn'
  message: string
  paths?: string[]
}

/**
 * 探针依赖。**必须注入** —— Windows 上 `chmod 0o500` 不会真让写入失败，
 * 靠真实文件操作无法在 CI（Linux/macOS/Windows）复现「报红」，
 * 注入才能让「探针失败必被发现」这条规则有牙齿。
 */
export interface StartupProbes {
  /** 探针：库根是否可写（实现应写一个探针文件再删） */
  probeWritable: (root: string) => Promise<void>
  /** 探针：回收站是否可用（实现应对探针文件调一次 trashItem） */
  probeTrash: (root: string) => Promise<void>
  /** 崩溃残留（只读扫描，有界） */
  listTmp?: (root: string) => Promise<TmpResidue[]>
  /** 已有 warn 级软错误（只读内存环） */
  readWarnSoftErrors?: () => { scope: string; message: string }[]
}

export const PROBE_FILE = '.yujian-selftest-probe'

/** 默认探针实现：真写一个探针文件再删（这是唯一可靠的「可写」判定） */
export function makeDefaultProbes(): StartupProbes {
  return {
    async probeWritable(root: string) {
      const p = join(root, PROBE_FILE)
      await writeFile(p, 'probe', 'utf-8')
      await unlink(p).catch(() => {})
    },
    async probeTrash(root: string) {
      const p = join(root, PROBE_FILE)
      await writeFile(p, 'probe', 'utf-8')
      const { trashItem } = await import('./trash')
      try {
        await trashItem(p)
      } finally {
        // 回收站失败时会走永久删除；无论成败都不能把探针文件留在库里
        await unlink(p).catch(() => {})
      }
    },
    listTmp: (root: string) => listTmpResidue(root),
  }
}

/**
 * 执行启动自检。**永不抛错** —— 启动期任何异常都不能挡住应用打开。
 */
export async function runStartupSelfCheck(
  vaultPath: string,
  probes: StartupProbes,
): Promise<StartupFinding[]> {
  const findings: StartupFinding[] = []

  try {
    await probes.probeWritable(vaultPath)
  } catch (e) {
    findings.push({
      kind: 'vault-not-writable',
      level: 'error',
      message: `笔记库无法写入（${errCode(e)}）——保存可能失败，自动备份也会失效`,
      paths: [vaultPath],
    })
  }

  try {
    await probes.probeTrash(vaultPath)
  } catch (e) {
    findings.push({
      kind: 'trash-unavailable',
      level: 'error',
      message: `回收站不可用（${errCode(e)}）——删除将不可撤销地永久执行`,
      paths: [vaultPath],
    })
  }

  if (probes.listTmp) {
    try {
      const res = await probes.listTmp(vaultPath)
      if (res.length > 0) {
        findings.push({
          kind: 'tmp-residue',
          level: 'warn',
          message: `发现 ${res.length} 个上次未完成的临时文件（可能是未保存的新版本）`,
          paths: res.map((r) => r.tmpPath),
        })
      }
    } catch {
      // 扫描失败不是数据安全问题，不打扰
    }
  }

  if (probes.readWarnSoftErrors) {
    try {
      const warns = probes.readWarnSoftErrors()
      if (warns.length > 0) {
        findings.push({
          kind: 'soft-error-warn',
          level: 'warn',
          message: `存在 ${warns.length} 条历史安全告警，可在完整性面板查看`,
        })
      }
    } catch {
      // 同上，不打扰
    }
  }

  // 同步进安全事件流（渲染层挂载后会补拉）
  for (const f of findings) {
    notifySafety('startup-check', f.paths ?? [], f.message)
  }
  return findings
}

function errCode(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : 'unknown'
}

/** 默认软错误读取（只读内存环） */
export function defaultWarnSoftErrors(): { scope: string; message: string }[] {
  return getSoftErrors({ level: 'warn' }).map((e) => ({ scope: e.scope, message: e.message }))
}
