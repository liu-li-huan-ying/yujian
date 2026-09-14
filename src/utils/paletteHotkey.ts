/** 命令面板 / 快速打开的显示模式；null = 关闭 */
export type PaletteMode = 'commands' | 'files' | null

/** 判定所需的按键字段（与 KeyboardEvent 的四个相关字段同形，便于直接传事件） */
export interface PaletteKeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * 判定命令面板 / 快速打开的热键，返回**应该切换到的模式**。
 *
 * 返回 `undefined` 表示「这个键不归我管」，调用方应放行（不 preventDefault、
 * 不 stopPropagation），否则会吞掉正常的编辑器按键。
 *
 * 键位规划：Ctrl+Shift+P = 命令面板；Ctrl+K = 快速打开笔记。
 * 不把命令面板放 Ctrl+K，是因为搜索框已显示该提示，抢键会让用户困惑。
 *
 * 切换规则（VS Code 行为）：
 * - 未开 → 按哪个就开哪个；
 * - 已开 → **按同一个键是关闭**，按另一个键是切换过去（而不是一律关闭）。
 *
 * ⚠️ 这里修掉了一个实现与原意不符的缺陷：原先写成「已开时按任一键都关闭」，
 * 于是命令面板开着时按 Ctrl+K 会整个关掉、而不是切到快速打开，
 * 与上方注释声明的「再按同键 = 关闭」并不一致。
 */
export function resolvePaletteHotkey(
  e: PaletteKeyInput,
  current: PaletteMode,
): PaletteMode | undefined {
  if (!(e.ctrlKey || e.metaKey)) return undefined
  const k = e.key.toLowerCase()
  const wantCommands = k === 'p' && e.shiftKey
  const wantFiles = k === 'k' && !e.shiftKey
  if (!wantCommands && !wantFiles) return undefined

  // 当前未开 → 打开对应面板；已开且是同一个键 → 关闭；已开但是另一个键 → 切过去
  if (current === null) return wantCommands ? 'commands' : 'files'
  if (wantCommands) return current === 'commands' ? null : 'commands'
  return current === 'files' ? null : 'files'
}
