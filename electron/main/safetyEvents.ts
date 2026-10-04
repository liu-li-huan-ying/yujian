import { reportSoftError } from './softError'
import type { SafetyKind, SafetyNoticePayload } from '../shared/safety'
/**
 * 「安全网降级」事件流 —— 与 softError 同构，但**语义完全不同**。
 *
 * 为什么需要它：softError 的设计哲学是「可容忍失败 → 记一笔 → 继续」（见 softError.ts 头部），
 * 它服务的是**可用性**。但数据安全上的「可容忍失败」是**不能容忍**的：
 * 备份失败、读不到原文、回收站不可用 —— 这些都意味着「用户以为有网，实则没有」，
 * 而 softError 只在用户主动打开完整性面板时可见，**不打扰 = 等于没有告警**。
 *
 * 所以这里另开一条流：**面向用户、必须被打扰**。判定标准不是「有多严重」，
 * 而是「用户是否有理由知道自己正处在无保护状态」。
 *
 * 明确不做的事：把全局 debug 一律提为 warn。`vault.chmod` / `index.reparse`
 * 这类属正常降级，全局提级会让真正的信号被噪音淹没 —— 那等于没做告警。
 */

// 降级类型定义在 electron/shared/safety.ts（共享契约的唯一真源），
// 此处只 re-export 便于主进程内部引用。
export type { SafetyKind, SafetyNoticePayload }

/** 内存环容量：够看完一轮，又不会在长会话里无限增长 */
const CAPACITY = 100

const ring: SafetyNoticePayload[] = []
let seq = 0
let sink: ((n: SafetyNoticePayload) => void) | null = null

/**
 * 注册渲染层转发器。主进程在 app ready 前产生的事件不会被丢——
 * 渲染层挂载时会用 `listSafetyNotices()` 补拉一次（见 preload）。
 */
export function setSafetySink(fn: ((n: SafetyNoticePayload) => void) | null): void {
  sink = fn
}

/**
 * 上报一条安全网降级。
 *
 * 同时打一条软错误：这样「完整性面板」仍能查到全部历史（它是诊断入口），
 * 而新事件流负责「当下就让用户知道」。两者不重复负担。
 */
export function notifySafety(
  kind: SafetyKind,
  paths: string[],
  detail: string,
): SafetyNoticePayload {
  const n: SafetyNoticePayload = { id: ++seq, kind, paths, detail, at: Date.now() }
  ring.push(n)
  if (ring.length > CAPACITY) ring.splice(0, ring.length - CAPACITY)
  // 软错误只记 scope 与首条路径，detail 过长会挤爆面板
  reportSoftError(`safety.${kind}`, new Error(detail), 'warn')
  sink?.(n)
  return n
}

export function listSafetyNotices(): SafetyNoticePayload[] {
  return ring.slice()
}

export function clearSafetyNotices(): void {
  ring.length = 0
}
