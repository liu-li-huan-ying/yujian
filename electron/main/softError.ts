/**
 * 软错误（soft error）上报 —— 给「已知可容忍的失败」一个出口。
 *
 * 【为什么需要它】
 * 主进程里有大量 `catch { /* 注释 *\/ }`：某次 IO 失败不该让编辑器崩，这个策略是对的。
 * 但「可容忍」不等于「该消失」——当前这些错误**完全没有出口**，后果是：
 *   - 索引落盘失败 → 用户以为索引正常，实际每次启动都在全量重建（越用越慢）；
 *   - 历史迁移失败 → 快照静默留在旧哈希桶，恢复时找不到；
 *   - `.assets` 搬运失败 → 图片静默裂图，用户只能看到「图没了」。
 * 这类故障不会抛异常、不会进 UI、不会被测试发现，只能靠人偶然察觉。
 *
 * 【设计约束】
 *  1. **零 Electron 依赖**：纯 Node，便于 esbuild→mjs 后在 Node 直接断言（同 vaultIndex 的理由）。
 *  2. **绝不改变控制流**：调用方仍是「吞掉错误继续」，只是顺手上报。上报自身绝不抛异常。
 *  3. **分级**：`warn` = 意外失败，值得用户知道；`debug` = 预期内的降级（如回收站不可用回退 rm、
 *     chmod 尽力而为），属于正常路径，收集但不在 UI 上算作问题——否则告警会被噪音淹没。
 *  4. **有界**：固定容量环，永不无界增长（长时间运行也不吃内存）。
 */

import type { SoftErrorEntry, SoftErrorLevel, SoftErrorSummary } from '../shared/ipc-channels'

export type { SoftErrorEntry, SoftErrorLevel, SoftErrorSummary }

/** 环容量：留足排查窗口，又不至于让 IPC 负载失控 */
const CAPACITY = 200

const ring: SoftErrorEntry[] = []
let seq = 0
let sink: ((entry: SoftErrorEntry) => void) | null = null

/** 主进程启动时可注册转发（如推给渲染进程），测试里不需要 */
export function setSoftErrorSink(fn: ((entry: SoftErrorEntry) => void) | null): void {
  sink = fn
}

/**
 * 是否打印到控制台。默认按 NODE_ENV 推断，但打包后的 Electron 主进程里 NODE_ENV 常为 undefined，
 * 故由调用方在启动时用 app.isPackaged 显式设定（见 electron/main/index.ts）。
 */
let verbose = process.env.NODE_ENV !== 'production'

export function setSoftErrorVerbose(on: boolean): void {
  verbose = on
}

/** 把任意抛出物收敛成一行可读摘要（Error / 字符串 / 对象都能吃） */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    return code ? `${err.name}[${code}]: ${err.message}` : `${err.name}: ${err.message}`
  }
  if (typeof err === 'string') return err
  if (err === null) return 'null'
  if (err === undefined) return 'undefined'
  try {
    // describeError 边界：JSON.stringify(Symbol) 不抛但返回 undefined，故必须判类型再采用
    const json = JSON.stringify(err)
    if (typeof json === 'string') return json
  } catch {
    /* 循环引用等 → 落到下面的兜底 */
  }
  try {
    return String(err)
  } catch {
    // 连 toString 都抛（极端对象）→ 只求不把错误抛给调用方
    return Object.prototype.toString.call(err)
  }
}

/**
 * 上报一次「已知可容忍失败」。**调用方仍应吞掉该错误继续执行**。
 *
 * @param scope 故障点，建议 `域.动作` 形式（如 `index.save`）
 * @param err   原始抛出物
 * @param level 默认 `warn`（意外失败）；预期内降级请显式传 `'debug'`
 */
export function reportSoftError(scope: string, err: unknown, level: SoftErrorLevel = 'warn'): void {
  let entry: SoftErrorEntry
  try {
    entry = { seq: ++seq, scope, level, message: describeError(err), at: Date.now() }
  } catch {
    return // 连构造都失败：宁可丢一条记录，也不能影响主流程
  }

  ring.push(entry)
  if (ring.length > CAPACITY) ring.splice(0, ring.length - CAPACITY)

  if (verbose) {
    console.warn(`[soft:${level}] ${scope} — ${entry.message}`)
  }

  if (sink) {
    try {
      sink(entry)
    } catch {
      /* 观测通道自身故障绝不能再抛，否则会把「可容忍」变成「致命」 */
    }
  }
}

/** 读取已收集的软错误（按发生顺序，最新在最后） */
export function getSoftErrors(opts?: { level?: SoftErrorLevel; limit?: number }): SoftErrorEntry[] {
  let out = ring
  if (opts?.level) out = out.filter((e) => e.level === opts.level)
  const limit = opts?.limit
  if (limit !== undefined && limit >= 0 && out.length > limit) out = out.slice(out.length - limit)
  return out.map((e) => ({ ...e })) // 返回值，防止调用方改到内部状态
}

/** 按 scope 归并计数，便于面板上「哪类失败反复出现」一眼可见 */
export function summarizeSoftErrors(): SoftErrorSummary[] {
  const map = new Map<string, SoftErrorSummary>()
  for (const e of ring) {
    const key = `${e.level}:${e.scope}`
    const cur = map.get(key)
    if (cur) {
      cur.count++
      cur.lastAt = e.at
      cur.lastMessage = e.message
    } else {
      map.set(key, { scope: e.scope, level: e.level, count: 1, lastAt: e.at, lastMessage: e.message })
    }
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/** 仅统计 warn 级（面板上「问题数」用它，避免 debug 噪音被当成故障） */
export function countSoftErrors(level: SoftErrorLevel = 'warn'): number {
  let n = 0
  for (const e of ring) if (e.level === level) n++
  return n
}

/** 清空（用户点「我已了解」或修复后调用）。返回清掉的条数。 */
export function clearSoftErrors(): number {
  const n = ring.length
  ring.length = 0
  return n
}

/** 仅供测试：重置序号，让断言可预期 */
export function resetSoftErrorSeqForTest(): void {
  seq = 0
}
