import { readFile } from 'node:fs/promises'
import { atomicWrite } from './atomicWrite'
import { backupBeforeSave, readPrevContent } from './autoBackup'
import { notifySafety } from './safetyEvents'
import {
  planBulkReplaceCore,
  writeAllSequentially,
  type BulkWriteResult,
  type ReplacePlanItem,
} from './safeWriteCore'

/**
 * **唯一安全写原语** —— 保存与批量替换都必须经过它。
 *
 * 为什么要有这一层：2026-10-04 审计发现，保存路径（`ipc/files.ts`）有完整的
 * 「读旧 → 备份 → 原子写」，而批量替换路径（`vault/search.ts`）却直接裸 `writeFile` ——
 * **非原子写 + 无备份 + 可作用于全库**。同一件事两套实现、两套安全等级，
 * 迟早会有人改错一处、而另一处悄悄失去保护。
 *
 * 把安全网收进单一原语后，「两处实现漂移」从「可能」变成「结构上不可能」：
 * 新增任何写路径时，唯一正确的做法就是调这里。
 *
 * 依赖方向红线（违反即 `check-structure` 的 Tarjan SCC 门禁报红）：
 * **本模块依赖索引，但 `atomicWrite.ts` 必须保持零索引依赖。**
 * 否则 `vaultIndex/rewrites → atomicWrite → vaultIndex/rewrites` 成环。
 * 故 reindex 放在这里，而不是塞进 atomicWrite。
 */

/** 本次写入的安全网降级情况（`undefined` = 安全网完整生效） */
export type WriteDegraded = 'prev-unreadable' | 'backup-failed'

export interface SafeWriteResult {
  ok: true
  /** 留档的路径（用于「已备份」类提示；无降级时为 true） */
  backedUp: boolean
  degraded?: WriteDegraded
}

export interface SafeWriteOptions {
  /** 显式关闭留档（仅用于自愈修复等「写入的是已知正确内容」的场景） */
  backup?: boolean
  /** 写完后主动触发索引更新（默认开；见下方 noteFileWritten 说明） */
  reindex?: boolean
}

/**
 * 安全写一个文件：读旧 → 留档 → 原子写。
 *
 * 关键取舍 —— **读失败绝不阻断保存**：若因为读不到原文就拒绝写，用户的内容会直接丢，
 * 那比「这次没有回滚点」严重得多。正确做法是照常写、同时让用户知道这一版没有安全网。
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  opts: SafeWriteOptions = {},
): Promise<SafeWriteResult> {
  const prev = await readPrevContent(filePath)
  let degraded: WriteDegraded | undefined
  let backedUp = false

  if (!prev.ok) {
    // 文件存在但读不到（被锁 / 权限 / 云盘同步中）→ 本次覆盖没有回滚点
    degraded = 'prev-unreadable'
    notifySafety('prev-unreadable', [filePath], `读不到原文（${prev.reason}），本次覆盖没有回滚点`)
  } else if (opts.backup !== false && prev.content !== content) {
    const r = await backupBeforeSave(filePath, prev.content)
    if (r.ok) {
      backedUp = true
    } else if (r.degraded === 'backup-failed') {
      degraded = 'backup-failed'
    }
    // empty / duplicate / outside-vault / history-dir 都不是「安全网坏了」：
    // 分别是「本来就没内容」「重复内容无新信息」「不在库内」「历史目录自身」，无需打扰。
  }

  await atomicWrite(filePath, content)

  // 主动 reindex：chokidar 有 awaitWriteFinish(120ms) + 事件延迟，
  // 「刚保存完立刻查反链」仍会拿到旧关系。写方主动更新可消除这个窗口。
  if (opts.reindex !== false) {
    const { noteFileWritten } = await import('./vault/indexStore')
    await noteFileWritten(filePath).catch((e: unknown) => {
      // 索引失败绝不能阻断保存；watcher 会兜底重扫
      void e
    })
  }

  return { ok: true, backedUp, degraded }
}

/** 批量写的结果。`failed` 逐条列出，供 UI 显示精确清单（而不是只报一个数字）。 */
export type { BulkWriteResult } from './safeWriteCore'

/**
 * 顺序写多个文件，**失败不中断** —— 用户的核心诉求是「知道到底哪些没改成」，
 * 中途中断反而让状态更难判断。
 *
 * 写入必须用 `atomicWrite` 而非 `writeFile`：裸写崩溃会留下截断文件，
 * 而这是唯一一条「程序自动批量改写用户内容」的路径。
 *
 * 编排逻辑在 `safeWriteCore.writeAllSequentially`（纯逻辑、可被 bundle 直测），
 * 本函数只负责把「真实写盘动作」注入进去。
 */
export async function safeWriteMany(
  entries: ReadonlyArray<{ path: string; content: string }>,
): Promise<BulkWriteResult> {
  return writeAllSequentially(entries, atomicWrite)
}

/** 生产用的预检：读盘用 fs，其余委托纯逻辑层 */
export async function planBulkReplace(
  paths: readonly string[],
  compute: (content: string) => string,
): Promise<{ plan: ReplacePlanItem[]; unreadable: string[] }> {
  return planBulkReplaceCore(
    paths,
    (p: string) => readFile(p, 'utf-8'),
    compute,
  )
}

