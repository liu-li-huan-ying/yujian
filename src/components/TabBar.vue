<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import { useTabsStore } from '../store/tabs'
import { useI18n } from '../i18n'

const tabs = useTabsStore()
const { t } = useI18n()
const L = t.ui

const props = defineProps<{ dirty: boolean }>()

const emit = defineEmits<{
  (e: 'activate', path: string): void
  (e: 'close', path: string): void
  (e: 'close-others', path: string): void
  (e: 'close-to-right', path: string): void
}>()

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? 'document').replace(/\.(md|markdown)$/i, '')
}

const isActive = (path: string): boolean => path === tabs.activePath
const showDot = (path: string): boolean => isActive(path) && props.dirty

/* ── 溢出折叠：以当前标签为中心的滑动窗口，超出部分收进「更多」 ──
 * 设计要点（参考 VS Code / 浏览器标签条）：
 *  - 始终保证 active 标签在可见窗口内，避免「切到哪个却看不见哪个」；
 *  - 可见窗口长度 cap 由容器宽度贪心测得，窗口起点随 active 滑动；
 *  - 折叠进「更多」的标签不入 DOM，50+ 标签时栏内节点仍是 ~cap 个，性能不退化。 */
const scroller = ref<HTMLElement | null>(null)
const tabEls = ref<(HTMLElement | null)[]>([])
const windowStart = ref(0)
const windowCount = ref(0)

function setTabEl(el: unknown, i: number): void {
  tabEls.value[i] = (el as HTMLElement | null) ?? null
}

function recompute(): void {
  const c = scroller.value
  if (!c) return
  // 预留「更多」按钮宽度 + 右内边距
  const reserve = 50
  const avail = c.clientWidth - reserve
  const len = tabs.tabs.length
  // 贪心测得可容纳的标签数 cap（未挂载标签用 150px 估宽，差异可忽略）
  let used = 0
  let cap = len
  for (let i = 0; i < len; i++) {
    const w = tabEls.value[i]?.offsetWidth ?? 150
    if (used + w > avail && i > 0) {
      cap = i
      break
    }
    used += w
  }
  cap = Math.max(1, cap)
  // 以 active 为中心滑动窗口起点
  const activeIdx = tabs.tabs.findIndex((t) => t.path === tabs.activePath)
  let start = 0
  if (activeIdx >= 0) {
    if (activeIdx < cap) start = 0
    else if (activeIdx > len - cap) start = len - cap
    else start = Math.max(0, activeIdx - Math.floor((cap - 1) / 2))
  }
  windowStart.value = start
  windowCount.value = cap
}

/* rAF 批处理：合并连续触发，避免切标签/缩放时的多次同步回流 */
let rafId = 0
function scheduleRecompute(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = 0
    recompute()
  })
}

let ro: ResizeObserver | null = null
onMounted(() => {
  scheduleRecompute()
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    ro = new ResizeObserver(() => scheduleRecompute())
    ro.observe(scroller.value)
  }
  window.addEventListener('resize', scheduleRecompute)
})
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  ro?.disconnect()
  window.removeEventListener('resize', scheduleRecompute)
})
watch(() => tabs.tabs.length, scheduleRecompute)
watch(() => tabs.activePath, scheduleRecompute)

const visibleTabs = computed(() =>
  tabs.tabs.slice(windowStart.value, windowStart.value + windowCount.value)
)
const overflowTabs = computed(() =>
  tabs.tabs.filter((_, i) => i < windowStart.value || i >= windowStart.value + windowCount.value)
)
const overflowCount = computed(() => Math.max(0, tabs.tabs.length - windowCount.value))

/* ── 单标签右键菜单 ── */
const menu = ref<{ x: number; y: number; path: string } | null>(null)
function onContextMenu(e: MouseEvent, path: string): void {
  e.preventDefault()
  menu.value = { x: e.clientX, y: e.clientY, path }
}
function buildItems(_path: string): MenuItem[] {
  return [
    { action: 'close', label: L.close },
    { action: 'close-others', label: L.closeOthers },
    { action: 'close-to-right', label: L.closeToRight }
  ]
}
function onMenuSelect(action: string): void {
  const path = menu.value?.path
  menu.value = null
  if (!path) return
  if (action === 'close') emit('close', path)
  else if (action === 'close-others') emit('close-others', path)
  else if (action === 'close-to-right') emit('close-to-right', path)
}

/* ── 更多菜单（溢出标签）── */
const moreMenu = ref<{ x: number; y: number } | null>(null)
function onMoreClick(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  moreMenu.value = { x: r.left, y: r.bottom + 4 }
}
function onMoreSelect(action: string): void {
  moreMenu.value = null
  emit('activate', action)
}
</script>

<template>
  <div class="tabbar jade">
    <div ref="scroller" class="tabbar__scroll">
      <div
        v-for="(tab, i) in visibleTabs"
        :key="tab.path"
        :ref="(el) => setTabEl(el, i)"
        class="tab"
        :class="{ 'tab--active': isActive(tab.path) }"
        :title="tab.path"
        @click="emit('activate', tab.path)"
        @contextmenu="onContextMenu($event, tab.path)"
      >
        <span class="tab__name">{{ baseName(tab.path) }}</span>
        <span v-if="showDot(tab.path)" class="tab__dot" />
        <button
          class="tab__close"
          type="button"
          :title="L.close"
          @click.stop="emit('close', tab.path)"
        >
          <Icon name="x" :size="12" />
        </button>
      </div>
    </div>

    <button
      v-if="overflowCount > 0"
      class="tabbar__more"
      type="button"
      :title="`${overflowCount} 个标签`"
      @click="onMoreClick"
    >
      <Icon name="more" :size="16" />
      <span class="tabbar__more-count">{{ overflowCount }}</span>
    </button>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="buildItems(menu.path)"
      @select="onMenuSelect"
      @close="menu = null"
    />
    <ContextMenu
      v-if="moreMenu"
      :x="moreMenu.x"
      :y="moreMenu.y"
      :items="overflowTabs.map((tb) => ({ action: tb.path, label: baseName(tb.path), active: tb.path === tabs.activePath }))"
      @select="onMoreSelect"
      @close="moreMenu = null"
    />
  </div>
</template>

<style scoped>
.tabbar {
  height: var(--h-tabbar);
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--hue-border-subtle);
  overflow: hidden;
  user-select: none;
}

.tabbar__scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 0 8px 0 12px;
  border-right: 1px solid var(--hue-border-subtle);
  color: var(--hue-text-2);
  cursor: pointer;
  font-size: 12.5px;
  white-space: nowrap;
  position: relative;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.tab:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}
.tab--active {
  color: var(--hue-text-1);
  background: var(--hue-active);
}
.tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--hue-accent);
}

.tab__name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hue-accent);
  flex-shrink: 0;
}

.tab__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.tab__close:hover {
  background: rgba(var(--hue-tint-1), 0.18);
  color: var(--hue-text-1);
}

.tabbar__more {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 10px;
  border: 0;
  border-left: 1px solid var(--hue-border-subtle);
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.tabbar__more:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}
.tabbar__more-count {
  font-size: 11px;
}
</style>
