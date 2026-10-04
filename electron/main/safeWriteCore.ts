import { errMsg } from '../../electron/shared/error'

/**
 * 批量安全写的**纯逻辑层**（不含 IO，可被 `bundle()` 直测）。
 *
 * 为什么要从 safeWrite.ts 抽出来：项目铁律是「纯逻辑（不 import vue、不碰 IPC）
 * 单独成文件才能被测试」。而这三段恰好是**最容易出错、也最该被断言**的：
 * ① 顺序写失败不中断、失败清单精确到路径；② 预检只挑「内容真会变」的文件；
 * ③ 计数与路径只统计**成功**的文件。
 *
 * 抽取后 IO 只剩「怎么写」，而「写什么、算不算成功、失败了怎么报」全在这里 —— 可直测。
 */

/** 批量写的结果。`failed` 逐条列出，供 UI 显示精确清单（而不是只报一个数字）。 */
export interface BulkWriteResult {
  written: number
  failed: { path: string; reason: string }[]
}

/** 实际写盘动作（由调用方注入，便于测试用桩制造磁盘满 / 只读等错误） */
export type WriterFn = (path: string, content: string) => Promise<void>

/**
 * 顺序写多个文件，**失败不中断**。
 *
 * 为什么不能中断：用户的核心诉求是「知道到底哪些没改成」。一旦中途 abort，
 * 用户面对的是「不知道改到哪了」的中间态，比「拿到完整清单」糟糕得多。
 */
export async function writeAllSequentially(
  entries: ReadonlyArray<{ path: string; content: string }>,
  write: WriterFn,
): Promise<BulkWriteResult> {
  const result: BulkWriteResult = { written: 0, failed: [] }
  for (const { path, content } of entries) {
    try {
      await write(path, content)
      result.written++
    } catch (e) {
      result.failed.push({ path, reason: errMsg(e) })
    }
  }
  return result
}

/** 预检项：只有 `next !== content` 的文件才需要写与留档 */
export interface ReplacePlanItem {
  path: string
  before: string
  after: string
}

/** 预检所需的读能力（注入以便测试；生产传 `readFile(path,'utf-8')`） */
export type ReaderFn = (path: string) => Promise<string>

/**
 * 预检：对每个目标算出替换后内容，**不写任何文件**。
 *
 * 为什么必须先预检：替换是本项目唯一「不可撤销 + 可批量改写全库」的操作。
 * 若中途才发现某些文件读不到，用户已处在「一半改了、一半没改」的中间态且难以回退。
 * 预检把「能不能改」这个判断**前置到动手之前**。
 *
 * 读不到的文件不静默丢弃：进 `unreadable` 由上层并入失败清单告知用户。
 */
export async function planBulkReplaceCore(
  paths: readonly string[],
  read: ReaderFn,
  compute: (content: string) => string,
): Promise<{ plan: ReplacePlanItem[]; unreadable: string[] }> {
  const plan: ReplacePlanItem[] = []
  const unreadable: string[] = []
  for (const path of paths) {
    let content: string
    try {
      content = await read(path)
    } catch {
      unreadable.push(path)
      continue
    }
    const after = compute(content)
    if (after === content) continue
    plan.push({ path, before: content, after })
  }
  return { plan, unreadable }
}

/** 预检阶段读不到的文件 → 统一进失败清单（reason 固定为可读文案） */
export function unreadableToFailed(paths: readonly string[]): { path: string; reason: string }[] {
  return paths.map((path) => ({ path, reason: '文件无法读取' }))
}

/** 替换统计：匹配数与路径**只**统计成功写入的文件（失败的不算"已替换"） */
export interface ReplaceStats {
  replaced: number
  files: number
  paths: string[]
}

/**
 * 统计替换结果。
 *
 * 关键点：`count` 必须是注入的（生产传 `before.match(re)?.length`），
 * 而 `failedPaths` 用于**排除**失败文件 —— 否则会出现
 * 「A 文件没改成，但提示说全库已替换 3 处」这种比静默更糟的假成功。
 */
export function summarizeReplace(
  plan: readonly ReplacePlanItem[],
  failedPaths: readonly string[],
  countMatches: (before: string) => number,
): ReplaceStats {
  const failed = new Set(failedPaths)
  const paths: string[] = []
  let replaced = 0
  for (const p of plan) {
    if (failed.has(p.path)) continue
    replaced += countMatches(p.before)
    paths.push(p.path)
  }
  return { replaced, files: paths.length, paths }
}

/** 合并「预检读不到」与「写失败」两类失败，去重且保持稳定顺序 */
export function mergeFailed(
  unreadable: readonly string[],
  writeFailed: readonly { path: string; reason: string }[],
): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const f of unreadableToFailed(unreadable)) {
    if (!seen.has(f.path)) {
      seen.add(f.path)
      out.push(f)
    }
  }
  for (const f of writeFailed) {
    if (!seen.has(f.path)) {
      seen.add(f.path)
      out.push(f)
    }
  }
  return out
}
