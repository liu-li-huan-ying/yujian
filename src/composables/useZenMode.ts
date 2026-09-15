import { ref } from 'vue'
import { setZenPrefs } from '../editor/zen'
import type { ZenPrefs } from '../../electron/shared/ipc-channels'

/** 凝神模式需要的编辑器能力 */
export interface ZenEditorLike {
  /** 进入/退出凝神：编辑器据此调窄正文列、加长滚动余量 */
  setZen: (on: boolean) => void
}

export interface ZenHooks {
  /** 编辑器宿主；null 表示尚未就绪 */
  host: () => ZenEditorLike | null
  /** 轻退栏「切换文档」：复用标签激活逻辑（先落盘脏数据，单实例换内容） */
  activateTab: (path: string) => void
}

/**
 * 凝神偏好默认值。**必须保留为具名常量**：启动时要用它兜底旧版本 session
 * （老 session 里没有 `zenPrefs` 字段），散在各处写一遍就会漂移。
 */
export const DEFAULT_ZEN_PREFS: ZenPrefs = {
  anchor: 1 / 3,
  fog: 'mid',
  scroll: 0.16,
  fullscreen: false,
  retreatBar: true,
  blockZoom: true,
}

/**
 * 凝神 2.0（见 `docs/FOCUS-MODE-2.0-DESIGN.md`）：激活态 + 轻退栏 + 设置面板 + 偏好。
 *
 * 为什么收进一个 composable：这套状态有一条**跨模块的联动链** ——
 * 切凝神要同时 ①通知编辑器 `setZen` ②按偏好转/还原全屏 ③落 session
 * ④退出时收帘。散在 App.vue 里改一处漏一处（尤其「只还原自己转的全屏、
 * 不碰用户手动 F11」这种条件分支），归拢后边界只有一处。
 */
export function useZenMode(hooks: ZenHooks) {
  /** 凝神是否激活（状态栏 / 模板 / Esc 状态机都读它） */
  const focusMode = ref(false)
  /** 轻退栏是否掀起（Esc 掀帘 / 再按或点编辑区收帘） */
  const retreatOpen = ref(false)
  const zenSettingsOpen = ref(false)
  const zenPrefs = ref<ZenPrefs>({ ...DEFAULT_ZEN_PREFS })
  /** 本次凝神是否因偏好自动全屏 —— 退出时只还原自己转的全屏，不碰用户手动 F11 */
  let autoFullscreen = false

  /** 切换凝神模式：同步编辑器 + 按偏好转/还原全屏 + 持久化 */
  function onToggleFocus(): void {
    focusMode.value = !focusMode.value
    hooks.host()?.setZen(focusMode.value)
    if (!focusMode.value) retreatOpen.value = false
    if (focusMode.value && zenPrefs.value.fullscreen) {
      autoFullscreen = true
      void window.api.setFullscreen(true)
    } else if (!focusMode.value && autoFullscreen) {
      autoFullscreen = false
      void window.api.setFullscreen(false)
    }
    void window.api.patchSession({ focusMode: focusMode.value })
  }

  /**
   * 设置面板改即生效：合并 → 应用（雾化档位写 CSS 变量 / 其余进 zen 模块）→ 持久化。
   * ⚠️ `setZenPrefs` 不可省：只改 ref 不会让编辑器生效。
   */
  function onZenPrefsChange(patch: Partial<ZenPrefs>): void {
    zenPrefs.value = { ...zenPrefs.value, ...patch }
    setZenPrefs(zenPrefs.value)
    void window.api.patchSession({ zenPrefs: zenPrefs.value })
  }

  function onZenSettings(): void {
    retreatOpen.value = false
    zenSettingsOpen.value = true
  }

  /** 轻退栏「切换文档」：先收帘再切，避免切换后帘子留在屏上 */
  function onZenActivateTab(path: string): void {
    retreatOpen.value = false
    hooks.activateTab(path)
  }

  /** 点编辑区收帘（capture 捕获编辑区内任意点击） */
  function onEditorClick(): void {
    if (retreatOpen.value) retreatOpen.value = false
  }

  /**
   * 启动时从 session 恢复偏好：合并默认值兜底旧 session，并**立即应用**
   * （雾化档位要写进 CSS 变量，否则重启后凝神雾化档位丢失）。
   */
  function restoreZen(prefs: Partial<ZenPrefs> | undefined): void {
    zenPrefs.value = { ...DEFAULT_ZEN_PREFS, ...(prefs ?? {}) }
    setZenPrefs(zenPrefs.value)
  }

  return {
    focusMode,
    retreatOpen,
    zenSettingsOpen,
    zenPrefs,
    onToggleFocus,
    onZenPrefsChange,
    onZenSettings,
    onZenActivateTab,
    onEditorClick,
    restoreZen,
  }
}
