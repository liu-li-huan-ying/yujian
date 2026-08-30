/**
 * 外观（皮肤 + 明暗）状态管理
 *
 * 设计约束（见 docs/UI-DESIGN.md §11）：
 * - 根节点挂 data-skin / data-mode 两个属性，CSS 变量随之切换
 * - 切换皮肤不需要重建编辑器实例（Crepe 只读 CSS 变量）
 * - 选择持久化到 localStorage（轻量、随用户、跨会话保留）
 * - 提供「跟随系统」：data-mode 由 prefers-color-scheme 驱动
 */
export type SkinKey = 'celadon' | 'sky' | 'moon' | 'dai' | 'amber'
export type ModeKey = 'dark' | 'light' | 'system'

export interface SkinMeta {
  key: SkinKey
  /** 设置面板里展示的标签 key（在 i18n 中取 ui.skinXxx） */
  labelKey: `skin${Capitalize<SkinKey>}`
}

/** 五套皮肤，顺序即设置面板里的展示顺序（青瓷默认打头） */
export const SKINS: SkinMeta[] = [
  { key: 'celadon', labelKey: 'skinCeladon' },
  { key: 'sky', labelKey: 'skinSky' },
  { key: 'moon', labelKey: 'skinMoon' },
  { key: 'dai', labelKey: 'skinDai' },
  { key: 'amber', labelKey: 'skinAmber' }
]

const STORAGE_KEY = 'yujian.appearance'

interface AppearanceState {
  skin: SkinKey
  mode: ModeKey
}

const DEFAULT_STATE: AppearanceState = { skin: 'celadon', mode: 'dark' }

let mediaQuery: MediaQueryList | null = null

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

/** 把用户选择的 mode 解析成实际生效的 dark / light */
export function resolveMode(mode: ModeKey): 'dark' | 'light' {
  return mode === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : mode
}

export function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppearanceState>
      const skin: SkinKey =
        parsed.skin && SKINS.some((s) => s.key === parsed.skin)
          ? (parsed.skin as SkinKey)
          : DEFAULT_STATE.skin
      const mode: ModeKey =
        parsed.mode === 'dark' || parsed.mode === 'light' || parsed.mode === 'system'
          ? (parsed.mode as ModeKey)
          : DEFAULT_STATE.mode
      return { skin, mode }
    }
  } catch {
    /* 损坏的值忽略，回退默认 */
  }
  return { ...DEFAULT_STATE }
}

export function saveAppearance(state: AppearanceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式等写入失败：忽略，本次会话仍生效 */
  }
}

/** 把当前选择写到根节点，并（仅 system 模式）挂上系统主题监听 */
export function applyAppearance(state: AppearanceState): void {
  const root = document.documentElement
  root.dataset.skin = state.skin
  root.dataset.mode = resolveMode(state.mode)

  if (state.mode === 'system') {
    if (!mediaQuery) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
      mediaQuery.addEventListener('change', () => {
        const cur = loadAppearance()
        if (cur.mode === 'system') root.dataset.mode = systemPrefersLight() ? 'light' : 'dark'
      })
    }
  }

  // 让 Electron 原生控件（保存框、菜单等）跟随 app 明暗，保持整体色调一致
  syncNativeTheme(state.mode)
}

/**
 * 把 app 选中的明暗模式同步到 Electron 原生主题。
 * 原生保存框 / 系统菜单由 OS 渲染，若不主动同步，会出现「深色 app 里弹出浅色对话框、
 * 文件名文字发白看不清」的割裂感。themeSource 接受与 app 一致的 dark/light/system。
 */
function syncNativeTheme(mode: ModeKey): void {
  try {
    const api = (window as unknown as {
      api?: { setNativeTheme?: (m: string) => void }
    }).api
    api?.setNativeTheme?.(mode)
  } catch {
    /* 非 Electron 环境忽略 */
  }
}

/** 应用启动早期调用：读持久化值并落到根节点（index.html 已有青瓷+深的默认值兜底） */
export function initAppearance(): AppearanceState {
  const state = loadAppearance()
  applyAppearance(state)
  return state
}
