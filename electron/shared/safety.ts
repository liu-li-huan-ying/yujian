/**
 * 安全网降级事件的**共享契约**（主进程 ↔ 渲染层）。
 *
 * 为什么要独立文件而不是塞进 `ipc-channels.ts`：那份文件已 666/700 行
 * （`check-structure` 上限 700），本轮还要加多个通道与 payload 类型。
 *
 * `SafetyKind` 定义在此（而非从主进程 re-export）是为了断开类型循环：
 * 主进程 `safetyEvents.ts` 要用这个类型，若反过来 shared 从 main 派生，
 * TS 会报「循环 import 别名」。
 */

/** 降级类型。新增时同步 UI 文案（i18n 键 `safety.<kind>`）。 */
export type SafetyKind =
  /** 读不到磁盘原文 → 本次覆盖没有回滚点 */
  | 'prev-unreadable'
  /** 自动备份失败 → 本次覆盖没有回滚点 */
  | 'backup-failed'
  /** 批量操作过大未留档 */
  | 'bulk-too-large'
  /** 批量替换部分文件失败 */
  | 'replace-partial'
  /** 回收站不可用，删除已改为永久执行（不可撤销） */
  | 'trash-fallback'
  /** 原子写降级（第三层 copyFile，原子性已失效） */
  | 'atomic-write-degraded'
  /** 启动自检发现的问题 */
  | 'startup-check'
  /** 崩溃残留临时文件待处理 */
  | 'tmp-residue'

export interface SafetyNoticePayload {
  id: number
  kind: SafetyKind
  /** 涉及的文件路径（可能有多个） */
  paths: string[]
  /** 纯文本补充说明（渲染层直接显示，故绝不放原始 Error 对象） */
  detail: string
  at: number
}
