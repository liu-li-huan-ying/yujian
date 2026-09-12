/**
 * 中文排版（CJK Typography）状态管理
 *
 * 依据：W3C《中文排版需求》§3.2.2、GB/T 15834—2011；规格见 docs/PHASE3-UI-DESIGN.md §5。
 *
 * 设计约束：
 * - **纯渲染层，绝不改写源文件**（Markdown 往返保真红线）——所有效果只作用于显示。
 * - 优先用标准 CSS：`text-autospace`（中英/中数自动 ¼ em 间距）与 `text-spacing-trim`
 *   （标点挤压）自 Chromium 140 起原生支持，Electron 44（Chromium ≫140）已满足 →
 *   **无需任何 JS 装饰插件**，由排版引擎直接插入间距，零性能开销、零 DOM 污染、
 *   导出天然不受影响。故本模块只持有开关状态，不触碰编辑器文档模型。
 * - 开关写到根节点 `data-cjk-*` 属性，CSS 随之生效；选择持久化到 localStorage（随用户跨会话）。
 *
 * 对应的样式在 `src/styles/editor.css`「中文排版」段。
 */

export interface TypographyState {
  /** 总开关；关闭后所有子项失效 */
  enabled: boolean
  /** 汉字 ↔ 拉丁字母 / 数字 自动补 ¼ em 间距 */
  space: boolean
  /** 中文强调：禁用斜体，改用强调色 */
  emphasis: boolean
  /** 标点挤压 + 避头尾（全角标点收紧） */
  punct: boolean
  /** 中文段落间距 +4px（补偿全角标点的视觉密度） */
  paraGap: boolean
}

const STORAGE_KEY = 'yujian.typography'

export const DEFAULT_TYPOGRAPHY: TypographyState = {
  enabled: true,
  space: true,
  emphasis: true,
  punct: true,
  paraGap: true
}

const BOOL_KEYS: (keyof TypographyState)[] = ['enabled', 'space', 'emphasis', 'punct', 'paraGap']

/** 把任意来源（localStorage / 旧版本 / 损坏值）收敛成完整合法的 TypographyState —— 纯函数，可单测 */
export function normalizeTypography(raw: unknown): TypographyState {
  const out = { ...DEFAULT_TYPOGRAPHY }
  if (raw && typeof raw === 'object') {
    const src = raw as Record<string, unknown>
    for (const k of BOOL_KEYS) {
      if (typeof src[k] === 'boolean') out[k] = src[k] as boolean
    }
  }
  return out
}

/**
 * 可注入的存储后端：默认 localStorage；无 localStorage 的环境（Node 测试）可换桩。
 * 与 `trash.ts` 的 `setTrashImpl` 同法，便于在 Node 里断言持久化往返。
 */
export interface TypographyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

let storage: TypographyStorage | null =
  typeof localStorage !== 'undefined' ? localStorage : null

export function setTypographyStorage(impl: TypographyStorage | null): void {
  storage = impl
}

export function loadTypography(): TypographyState {
  if (!storage) return { ...DEFAULT_TYPOGRAPHY }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return raw ? normalizeTypography(JSON.parse(raw)) : { ...DEFAULT_TYPOGRAPHY }
  } catch {
    return { ...DEFAULT_TYPOGRAPHY }
  }
}

export function saveTypography(state: TypographyState): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式等写入失败：忽略，本次会话仍生效 */
  }
}

/** 把状态落到根节点 data-* 属性（CSS 依据）；无 document 时静默跳过（Node 测试可跑） */
export function applyTypography(state: TypographyState): void {
  if (typeof document === 'undefined') return
  const on = state.enabled
  const root = document.documentElement
  root.dataset.cjk = on ? 'on' : 'off'
  root.dataset.cjkSpace = on && state.space ? 'on' : 'off'
  root.dataset.cjkEmph = on && state.emphasis ? 'on' : 'off'
  root.dataset.cjkPunct = on && state.punct ? 'on' : 'off'
  root.dataset.cjkGap = on && state.paraGap ? 'on' : 'off'
}

/** 应用启动早期调用：读持久化值并落到根节点（index.html 无默认值时首帧即生效） */
export function initTypography(): TypographyState {
  const state = loadTypography()
  applyTypography(state)
  return state
}
