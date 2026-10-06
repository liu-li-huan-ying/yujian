import type { SafetyKind } from '../../electron/shared/safety'

/**
 * 安全网降级事件的**文案映射**（纯逻辑，无 IO / 无 vue，可被 `bundle()` 直测）。
 *
 * 为什么单独成文件：降级类型 ↔ 用户可读文案的映射是「文案与枚举必须同步」的典型 ——
 * 加了 kind 忘了补文案，用户就会看到一句 `undefined`。
 * 故把映射抽出来，并在测试里断言**每个 SafetyKind 都有对应文案**（防漏）。
 *
 * ⚠️ 文案不含具体文件名/路径：调用方拼接文件名时**不做 i18n**（路径是数据不是文案），
 * 但前后缀必须走本表，否则英文界面会漏出中文。
 */

/** i18n 键前缀：实际文案由 locales 提供，此处只给键 */
export const SAFETY_I18N_KEYS = {
  'prev-unreadable': 'safetyPrevUnreadable',
  'backup-failed': 'safetyBackupFailed',
  'bulk-too-large': 'safetyBulkTooLarge',
  'replace-partial': 'safetyReplacePartial',
  'trash-fallback': 'safetyTrashFallback',
  'atomic-write-degraded': 'safetyAtomicDegraded',
  'startup-check': 'safetyStartupCheck',
  'tmp-residue': 'safetyTmpResidue',
} as const satisfies Record<SafetyKind, string>

/** 键的联合类型：让 `L[key]` 在编译期受检 —— 新增 kind 忘了加文案会**编译报红**，而非运行时 undefined */
export type SafetyI18nKey = (typeof SAFETY_I18N_KEYS)[SafetyKind]

/** 全部降级类型（测试用它断言「无遗漏」） */
export const ALL_SAFETY_KINDS = Object.keys(SAFETY_I18N_KEYS) as SafetyKind[]

/**
 * 取展示标题的 i18n 键。
 * 未知 kind 退回 startup-check 而非 undefined —— 宁可显示通用标题，
 * 也不给用户看 `undefined`（那会让人以为是 bug）。
 * 实际因为返回类型是联合类型，传入非法 kind 在编译期就会被拦下。
 */
export function safetyTitleKey(kind: SafetyKind): SafetyI18nKey {
  return SAFETY_I18N_KEYS[kind] ?? SAFETY_I18N_KEYS['startup-check']
}

/** 是否属于「error 级」（需用户立刻介入）vs「warn 级」（知情即可） */
export function isErrorLevel(kind: SafetyKind): boolean {
  return kind === 'prev-unreadable' || kind === 'backup-failed' || kind === 'trash-fallback'
}

/** 路径过长时中间省略：与 TabBar 的处理一致，避免长路径撑破面板 */
export function middleTruncatePath(p: string, max = 42): string {
  if (p.length <= max) return p
  const head = Math.ceil((max - 1) * 0.6)
  const tail = max - 1 - head
  return p.slice(0, head) + '…' + (tail > 0 ? p.slice(p.length - tail) : '')
}

/** 最多展示几条路径，超出折叠为「还有 N 个」 */
export const MAX_VISIBLE_PATHS = 3

/**
 * 折叠路径清单：短的全展示，长的只展示前 N 条 + 计数。
 *
 * 为什么要有上限：批量替换失败可能有 200 个文件，全列会把面板撑到滚动地狱，
 * 而用户真正要的是「**大致规模 + 能否定位**」，不是逐条核对。
 */
export function foldPaths(
  paths: readonly string[],
  max = MAX_VISIBLE_PATHS,
): { visible: string[]; rest: number } {
  const p = paths.map((x) => middleTruncatePath(x))
  return { visible: p.slice(0, max), rest: Math.max(0, p.length - max) }
}
