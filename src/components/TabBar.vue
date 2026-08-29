<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
 *  - 折叠进「更多」的标签不入 DOM，50+ 标签时栏内节点仍是 ~cap 个，性能不退化。
 *
 * 稳定性三条（修复「同一状态忽而 5 个、忽而 6 个」的抖动）：
 *  1. 位置徽标与「更多」按钮**常驻占位**（用 visibility 切换显隐），scroller.clientWidth 因此恒定，
 *     可用宽度直接取实测值、不再额外预留 —— 根除「双重扣减」与「徽标显隐反馈振荡」；
 *  2. 标签宽度按 path 缓存实测值，未渲染过的用已知宽度的平均值估算（优于硬编码 150）；
 *  3. 渲染后回填真实宽度并再收敛至多 2 轮，让 cap 稳定在不动点。 */
const scroller = ref<HTMLElement | null>(null)
const windowStart = ref(0)
const windowCount = ref(1)

/** path → 实测宽度（px）。渲染过的标签记住真实宽度，窗口滑动后无需重新估算。 */
const widthCache = new Map<string, number>()

/** 扫描当前已渲染的标签，把真实宽度回填进缓存 */
function scanWidths(): void {
  const c = scroller.value
  if (!c) return
  c.querySelectorAll<HTMLElement>('[data-tab-path]').forEach((el) => {
    const p = el.dataset.tabPath
    if (!p) return
    const w = el.offsetWidth
    if (w > 0) widthCache.set(p, w)
  })
}

function compute(): void {
  const c = scroller.value
  if (!c) return
  const len = tabs.tabs.length
  // 清掉已关闭标签的缓存，避免陈旧宽度与无限增长
  if (widthCache.size > len) {
    const alive = new Set(tabs.tabs.map((tb) => tb.path))
    for (const p of widthCache.keys()) if (!alive.has(p)) widthCache.delete(p)
  }
  if (len === 0) {
    windowStart.value = 0
    windowCount.value = 0
    return
  }

  // 未渲染过的标签用「已知宽度的平均值」估算，比硬编码更贴近实际
  let sum = 0
  let n = 0
  for (const tb of tabs.tabs) {
    const w = widthCache.get(tb.path)
    if (w) {
      sum += w
      n++
    }
  }
  const est = n > 0 ? Math.ceil(sum / n) : 130

  // 可用宽度直接取容器实测宽度：徽标 / 更多按钮已常驻占位，无需再预留
  const avail = c.clientWidth
  let used = 0
  let cap = len
  for (let i = 0; i < len; i++) {
    const w = widthCache.get(tabs.tabs[i].path) ?? est
    if (used + w > avail && i > 0) {
      cap = i
      break
    }
    used += w
  }
  cap = Math.max(1, Math.min(cap, len))

  // 以 active 为中心滑动窗口起点。
  // 但若用户正在用滚轮浏览（active 不在当前窗口内），保留窗口位置、仅贴边修正：
  // 不把窗口拽回 active（否则滚轮浏览失效），同时让 cap 适应新窗口的实际宽度，避免末项被裁切。
  const activeIdx = tabs.tabs.findIndex((tb) => tb.path === tabs.activePath)
  let start: number
  if (activeIdx < 0) {
    start = 0
  } else if (activeIdx < cap) {
    start = 0
  } else if (activeIdx > len - cap) {
    start = len - cap
  } else {
    const centered = activeIdx - Math.floor((cap - 1) / 2)
    const browsing =
      activeIdx < windowStart.value || activeIdx >= windowStart.value + windowCount.value
    start = browsing ? Math.min(windowStart.value, len - cap) : centered
  }
  windowStart.value = start
  windowCount.value = cap
}

/* rAF 批处理 + 渲染后收敛：合并连续触发，并让估算宽度被实测值替换后 cap 稳定下来 */
let rafId = 0
function scheduleRecompute(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = 0
    settle(2)
  })
}
function settle(passLeft: number): void {
  scanWidths()
  const before = `${windowStart.value}:${windowCount.value}`
  compute()
  if (`${windowStart.value}:${windowCount.value}` !== before && passLeft > 0) {
    // 等 Vue 渲染出新窗口后再测一轮，回填新标签的真实宽度
    void nextTick(() => settle(passLeft - 1))
  }
}

let ro: ResizeObserver | null = null
onMounted(() => {
  // 同步首算：挂载后 clientWidth 已可读，避免首帧只渲染 1 个标签造成闪烁
  compute()
  scheduleRecompute() // 渲染后回填真实宽度并收敛
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    ro = new ResizeObserver(() => scheduleRecompute())
    ro.observe(scroller.value)
  }
  window.addEventListener('resize', scheduleRecompute)
  // 字体加载完成后标签宽度会变，重算一次，避免缓存了 fallback 字体下的宽度
  if (typeof document !== 'undefined' && 'fonts' in document) {
    void document.fonts.ready.then(() => scheduleRecompute())
  }
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
const activeIndex = computed(() => tabs.tabs.findIndex((t) => t.path === tabs.activePath))
const posLabel = computed(() =>
  `${activeIndex.value < 0 ? 0 : activeIndex.value + 1} / ${tabs.tabs.length}`
)
const moreTitle = computed(() => L.moreTabs.replace('{n}', String(overflowCount.value)))

/* 滚轮在标签条上横向浏览（画廊式翻页）：仅在有溢出时接管滚轮，
 * 把滑动窗口沿标签序列 ±1 翻页；无溢出时原样放行，不劫持页面滚动。 */
function shiftWindow(delta: number): void {
  const len = tabs.tabs.length
  const cap = windowCount.value
  if (cap >= len) return
  const next = Math.min(Math.max(0, windowStart.value + delta), len - cap)
  if (next !== windowStart.value) {
    windowStart.value = next
    // 重算让 cap 适应新窗口内标签的实际宽度，避免最后一个标签被裁掉半截
    scheduleRecompute()
  }
}
function onWheel(e: WheelEvent): void {
  if (overflowCount.value <= 0) return
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (d === 0) return
  e.preventDefault()
  shiftWindow(d > 0 ? 1 : -1)
}

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
    <div ref="scroller" class="tabbar__scroll" @wheel="onWheel">
      <div
        v-for="tab in visibleTabs"
        :key="tab.path"
        :data-tab-path="tab.path"
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

    <!-- 常驻占位：显隐只切 visibility，保证 scroller 可用宽度恒定不抖动 -->
    <span
      class="tabbar__pos"
      :class="{ 'is-hidden': overflowCount <= 0 }"
      :title="L.tabPos"
    >{{ posLabel }}</span>

    <button
      class="tabbar__more"
      :class="{ 'is-hidden': overflowCount <= 0 }"
      type="button"
      :title="moreTitle"
      @click="onMoreClick"
      @contextmenu.prevent
    >
      <Icon name="more" :size="16" />
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

/* 位置徽标：静音展示「当前 / 总数」，不抢视觉。
   常驻占位（仅切 visibility），并用 min-width 钉住宽度 —— 否则位数从「9 / 9」
   变「10 / 10」时宽度变化会挤压 scroller，引发可见标签数的反馈振荡。 */
.tabbar__pos {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 0 9px;
  border-left: 1px solid var(--hue-border-subtle);
  color: var(--hue-text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  user-select: none;
  white-space: nowrap;
}

/* 常驻占位元素的隐藏态：保留盒模型宽度，仅不可见、不可交互 */
.is-hidden {
  visibility: hidden;
  pointer-events: none;
}
</style>
