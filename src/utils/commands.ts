/**
 * 命令目录 —— 命令面板的「单一事实来源」。
 *
 * 纯数据（id / 分组 / 展示键位），零运行时依赖，可进 `npm run test`（[M] 段
 * 验证分组顺序、id 唯一、键位与真实绑定一致）。标签文本由 i18n 在 `palette.cmd.*`
 * 下解析，本文件只存「键名」，不存中文串 —— 这样新增命令时若忘了加 i18n，
 * `[E]` 双语对齐测试会立刻红，不会悄悄漏翻。
 *
 * 分组顺序严格对齐 UI-DESIGN §3.5：文件 · 视图 · 知识 · 工具 · 导出 · 设置。
 * 分组内的排列就是面板初始（空查询时）的展示顺序，把高频项排前面更符合肌肉记忆。
 */

/** 分组键，顺序即展示顺序（不要随便调，UI 文档写死了） */
export type CommandGroup = 'file' | 'view' | 'knowledge' | 'tool' | 'export' | 'settings'

export interface CommandSpec {
  id: string
  group: CommandGroup
  /** 展示用快捷键；只填「当前真实绑定」的键位，未绑定则不填（不显示键帽，避免误导） */
  keys?: string
}

/** 命令面板的全部命令。 `as const satisfies` 让 id 收敛成字面量联合（CommandId），
 *  从而 App.vue 的动作映射 `Record<CommandId, () => void>` 能被 TS 强制覆盖全。 */
export const COMMANDS = [
  // ── 文件 ──
  { id: 'file.new', group: 'file' },
  { id: 'file.open', group: 'file', keys: 'Ctrl+O' },
  { id: 'file.openVault', group: 'file' },
  { id: 'file.save', group: 'file', keys: 'Ctrl+S' },
  { id: 'file.saveAs', group: 'file' },

  // ── 视图 ──
  { id: 'view.sidebar', group: 'view', keys: 'Ctrl+\\' },
  { id: 'view.outline', group: 'view', keys: 'Ctrl+Shift+\\' },
  { id: 'view.graph', group: 'view' },
  { id: 'view.focus', group: 'view' },
  { id: 'view.toggleMode', group: 'view', keys: 'Ctrl+/' },
  { id: 'view.stats', group: 'view' },

  // ── 知识 ──
  { id: 'knowledge.tags', group: 'knowledge' },
  { id: 'knowledge.moc', group: 'knowledge' },
  { id: 'knowledge.backlinks', group: 'knowledge' },
  { id: 'knowledge.snapshot', group: 'knowledge' },
  { id: 'knowledge.insertWikiLink', group: 'knowledge' },

  // ── 工具 ──
  { id: 'tool.linkCheck', group: 'tool' },
  { id: 'tool.integrity', group: 'tool' },
  { id: 'tool.backup', group: 'tool' },
  { id: 'tool.writingAids', group: 'tool' },
  { id: 'tool.imgHost', group: 'tool' },

  // ── 导出 ──
  { id: 'export.md', group: 'export' },
  { id: 'export.html', group: 'export' },
  { id: 'export.pdf', group: 'export' },
  { id: 'export.docx', group: 'export' },
  { id: 'export.latex', group: 'export' },
  { id: 'export.compile', group: 'export' },
  { id: 'export.publishImages', group: 'export' },

  // ── 设置 ──
  { id: 'settings.appearance', group: 'settings' },
  { id: 'settings.preferences', group: 'settings' },
  { id: 'settings.shortcuts', group: 'settings', keys: 'F1' },
  { id: 'settings.guide', group: 'settings' },
  { id: 'settings.toggleLocale', group: 'settings' },
] as const satisfies readonly CommandSpec[]

/** 命令 id 联合类型（动作映射用它做穷尽校验） */
export type CommandId = (typeof COMMANDS)[number]['id']

/** 分组展示顺序 */
export const GROUP_ORDER: readonly CommandGroup[] = [
  'file',
  'view',
  'knowledge',
  'tool',
  'export',
  'settings',
]

export interface CommandGroupBlock {
  group: CommandGroup
  specs: CommandSpec[]
}

/**
 * 把命令按 GROUP_ORDER 归组成有序块。纯函数，便于：
 * ①面板按分组渲染标题；②测试断言分组顺序与被覆盖。
 * 空查询时不参与打分，直接按这个顺序展示。
 */
export function groupCommands(specs: readonly CommandSpec[] = COMMANDS): CommandGroupBlock[] {
  const byGroup = new Map<CommandGroup, CommandSpec[]>()
  for (const s of specs) {
    const list = byGroup.get(s.group) ?? []
    list.push(s)
    byGroup.set(s.group, list)
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    specs: byGroup.get(group)!,
  }))
}
