import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 窄窗软收起阈值（px）：仅影响显示、不改持久偏好，加宽后恢复用户选择。
 * 两列阈值不同是刻意的——目录比大纲更常用，故允许它更早出现。
 */
const SIDEBAR_MIN_WIDTH = 460
const OUTLINE_MIN_WIDTH = 720

/** 侧栏默认宽度（首启动 / session 缺失时兜底） */
const DEFAULT_SIDEBAR_WIDTH = 224

/** 拖宽是高频事件，合并后再落盘 */
const WIDTH_PERSIST_DEBOUNCE_MS = 250

/**
 * 窗口布局：窄窗软收起 + 停靠列显隐 + 侧栏宽度持久化。
 *
 * 为什么收进一个 composable：这三件事共享**同一个 `window` resize 监听与同一个防抖定时器**，
 * 而「监听注册 / 注销」「定时器清理」分居组件 `onMounted` / `onBeforeUnmount` 两端——
 * 散着写最容易只加不删（加了监听忘了 removeEventListener）。归拢后生命周期与逻辑同处一文件。
 */
export function useWindowLayout() {
  const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
  const sidebarVisible = ref(true)
  const outlineVisible = ref(true)
  const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH)

  /** 窄窗软收起：仅影响显示，不改持久偏好，加宽后恢复用户选择 */
  const sidebarShown = computed(
    () => sidebarVisible.value && windowWidth.value >= SIDEBAR_MIN_WIDTH,
  )
  const outlineShown = computed(
    () => outlineVisible.value && windowWidth.value >= OUTLINE_MIN_WIDTH,
  )

  let widthTimer: ReturnType<typeof setTimeout> | null = null

  function onResize(): void {
    windowWidth.value = window.innerWidth
  }

  function onToggleSidebar(): void {
    sidebarVisible.value = !sidebarVisible.value
    void window.api.patchSession({ sidebarVisible: sidebarVisible.value })
  }

  function onToggleOutline(): void {
    outlineVisible.value = !outlineVisible.value
    void window.api.patchSession({ outlineVisible: outlineVisible.value })
  }

  /** 启动时从 session 恢复（三项一并回填，避免组件里散写三行各漏一处） */
  function restoreLayout(session: {
    sidebarWidth: number
    sidebarVisible: boolean
    outlineVisible: boolean
  }): void {
    sidebarWidth.value = session.sidebarWidth
    sidebarVisible.value = session.sidebarVisible
    outlineVisible.value = session.outlineVisible
  }

  watch(sidebarWidth, (width) => {
    if (widthTimer) clearTimeout(widthTimer)
    widthTimer = setTimeout(
      () => void window.api.patchSession({ sidebarWidth: width }),
      WIDTH_PERSIST_DEBOUNCE_MS,
    )
  })

  onMounted(() => window.addEventListener('resize', onResize))
  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    if (widthTimer) clearTimeout(widthTimer)
  })

  return {
    sidebarVisible,
    outlineVisible,
    sidebarWidth,
    sidebarShown,
    outlineShown,
    onToggleSidebar,
    onToggleOutline,
    restoreLayout,
  }
}
