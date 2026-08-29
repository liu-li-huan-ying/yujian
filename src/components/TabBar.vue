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
 *  - 可见窗口长度由容器宽度贪心测得，窗口起点随 active 滑动；
 *  - 折叠进「更多」的标签不入 DOM，50+ 标签时栏内节点仍是 ~cap 个，性能不退化。
 *
 * 稳定性（修复「同一状态忽而 5 个、忽而 6 个」）：
 *  - 位置徽标 / 「更多」按钮常驻占位（仅切 visibility），scroller.clientWidth 恒定 → 可用宽度取实测值，不再额外预留；
 *  - 挂载时先一次性渲染全部标签测量真实宽度（50 个 div 无压力），cap 直接由真实宽度贪心得出，杜绝估算偏差引起的少算；
 *  - 窗口实际渲染数再由「从窗口起点重新贪心」校准，避免窗口落在较宽标签区时末项被裁。
 *
 * 滚轮画廊（带阻尼 / 惯性）：仅在溢出时接管滚轮，把 delta 累积为速度，用摩擦衰减做惯性滑行，
 * 不会一下飞太远（限速 + 摩擦）。滚轮浏览期间不把窗口拽回 active，点选标签才复位。 */
const scroller = ref<HTMLElement | null>(null)
const windowStart = ref(0)
const windowCount = ref(1)
const measuring = ref(false) // 首帧测量：临时渲染全部标签以拿到真实宽度
const browsing = ref(false) // 用户正在滚轮浏览，compute 不再居中到 active

/** 滚轮画廊动画状态（标签单位，浮点） */
let animStart = 0
let velocity = 0
let wheelRAF = 0

/** path → 实测宽度（px）。渲染过的标签记住真实宽度，窗口滑动后无需重新估算。 */
const widthCache = new Map<string, number>()

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

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

/** 已知宽度的平均值，作为未渲染标签的宽度估算 */
function avgWidth(): number {
  let sum = 0
  let n = 0
  for (const w of widthCache.values()) {
    sum += w
    n++
  }
  return n > 0 ? sum / n : 110
}

/** 从 start 起，用最佳已知宽度贪心计算在 avail 内最多能放几个标签（不超出） */
function packFrom(start: number, avail: number): number {
  const len = tabs.tabs.length
  const est = avgWidth()
  let used = 0
  for (let i = start; i < len; i++) {
    const w = widthCache.get(tabs.tabs[i].path) ?? est
    if (used + w > avail && i > start) return i - start
    used += w
  }
  return len - start
}

function compute(): void {
  const c = scroller.value
  if (!c) return
  const len = tabs.tabs.length
  // 清掉已关闭标签的缓存，避免陈旧宽度与无限增长
  if (widthCache.size > len * 2) {
    const alive = new Set(tabs.tabs.map((tb) => tb.path))
    for (const p of widthCache.keys()) if (!alive.has(p)) widthCache.delete(p)
  }
  if (len === 0) {
    windowStart.value = 0
    windowCount.value = 0
    return
  }

  const avail = c.clientWidth
  const cap = Math.max(1, Math.min(packFrom(0, avail), len))

  // 窗口起点：滚轮浏览时锁定在动画位置；否则让 active 始终可见（不强制居中，避免与浏览打架）
  let start: number
  if (browsing.value) {
    start = clamp(Math.round(animStart), 0, Math.max(0, len - cap))
  } else {
    const a = tabs.tabs.findIndex((tb) => tb.path === tabs.activePath)
    let s = windowStart.value
    if (a < 0) s = 0
    else if (a < s) s = a
    else if (a > s + windowCount.value - 1) s = a - cap + 1
    else s = clamp(s, 0, Math.max(0, len - cap))
    start = clamp(s, 0, Math.max(0, len - cap))
  }
  windowStart.value = start

  // 从窗口起点重新贪心，确保当前窗口内的标签真正放得下（不会因窗口落在较宽区而溢出裁切）
  const fit = packFrom(start, avail)
  windowCount.value = Math.max(1, Math.min(fit, len - start))
}

/* rAF 批处理 + 渲染后收敛：合并连续触发，并让真实宽度被回填后 cap 稳定下来 */
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
  // 首帧测量：临时渲染全部标签拿到真实宽度，cap 由真实宽度贪心得出，根除估算少算
  measuring.value = true
  void nextTick(() => {
    scanWidths()
    measuring.value = false
    compute()
    scheduleRecompute()
  })
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
  if (wheelRAF) cancelAnimationFrame(wheelRAF)
  ro?.disconnect()
  window.removeEventListener('resize', scheduleRecompute)
})
watch(() => tabs.tabs.length, scheduleRecompute)
watch(() => tabs.activePath, scheduleRecompute)

const visibleTabs = computed(() =>
  tabs.tabs.slice(windowStart.value, windowStart.value + windowCount.value)
)
// 测量阶段临时渲染全部标签
const renderedTabs = computed(() => (measuring.value ? tabs.tabs : visibleTabs.value))
const overflowTabs = computed(() =>
  tabs.tabs.filter((_, i) => i < windowStart.value || i >= windowStart.value + windowCount.value)
)
const overflowCount = computed(() => Math.max(0, tabs.tabs.length - windowCount.value))
const activeIndex = computed(() => tabs.tabs.findIndex((t) => t.path === tabs.activePath))
const posLabel = computed(() =>
  `${activeIndex.value < 0 ? 0 : activeIndex.value + 1} / ${tabs.tabs.length}`
)
const moreTitle = computed(() => L.moreTabs.replace('{n}', String(overflowCount.value)))

/* ── 滚轮画廊：带阻尼 / 惯性 ── */
function tick(): void {
  animStart += velocity
  velocity *= 0.85 // 摩擦阻尼
  const maxStart = Math.max(0, tabs.tabs.length - windowCount.value)
  if (animStart < 0) {
    animStart = 0
    velocity = 0
  }
  if (animStart > maxStart) {
    animStart = maxStart
    velocity = 0
  }
  const target = Math.round(animStart)
  windowStart.value = clamp(target, 0, maxStart)
  if (Math.abs(velocity) < 0.0015 && Math.abs(animStart - target) < 0.0015) {
    animStart = target
    windowStart.value = target
    velocity = 0
    wheelRAF = 0
    return
  }
  wheelRAF = requestAnimationFrame(tick)
}
function ensureTick(): void {
  if (!wheelRAF) wheelRAF = requestAnimationFrame(tick)
}

function onWheel(e: WheelEvent): void {
  if (overflowCount.value <= 0) return // 无溢出不劫持页面滚动
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (d === 0) return
  e.preventDefault()
  browsing.value = true
  // 阻尼：单帧速度增量有上限、总速度限速，避免一下子飞太远；每次滚轮约滑 1 个标签并惯性收尾
  const add = clamp(d, -120, 120) * 0.0016
  velocity = clamp(velocity + add, -0.5, 0.5)
  ensureTick()
}

function onTabClick(path: string): void {
  browsing.value = false // 点选标签复位到「跟随 active」
  emit('activate', path)
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
  browsing.value = false // 点选标签复位到「跟随 active」
  emit('activate', action)
}
</script>

<template>
  <div class="tabbar jade">
    <div ref="scroller" class="tabbar__scroll" @wheel="onWheel">
      <div
        v-for="tab in renderedTabs"
        :key="tab.path"
        :data-tab-path="tab.path"
        class="tab"
        :class="{ 'tab--active': isActive(tab.path) }"
        :title="tab.path"
        @click="onTabClick(tab.path)"
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
      :class="{ 'is-hidden': overflowCount <= 0 || measuring }"
      :title="L.tabPos"
    >{{ posLabel }}</span>

    <button
      class="tabbar__more"
      :class="{ 'is-hidden': overflowCount <= 0 || measuring }"
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
