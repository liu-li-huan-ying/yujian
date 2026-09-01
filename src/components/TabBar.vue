<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import { useTabsStore } from '../store/tabs'
import { useI18n } from '../i18n'
import { baseName } from '../utils/path'

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

const isActive = (path: string): boolean => path === tabs.activePath
const showDot = (path: string): boolean => isActive(path) && props.dirty

/* ── 占满式标签布局（采纳主人的修正：不固定可见数）──
 * 算法：
 *  1. 用「默认卡片宽度」估算可见区能放下几个标签 → cap；
 *  2. 这 cap 个可见标签用 flex:1 均匀分摊可见区宽度，**永远占满、不留空位**；
 *  3. 窗口缩放时 cap 跟着变，可见标签数自动增减、始终填满 —— 根除「固定 N 个」带来的空位与抖动；
 *  4. 超出 cap 的收进「更多」，滚轮以阻尼 / 惯性横向浏览（浏览中不拽回 active，点选才复位）。
 * 性能：仅渲染可见的 ~cap 个标签，50+ 标签时栏内 DOM 不随总数增长。 */
const scroller = ref<HTMLElement | null>(null)
const windowStart = ref(0)
const windowCount = ref(1)
const browsing = ref(false) // 用户正在滚轮浏览，compute 不再居中到 active

const DEFAULT_TAB_W = 168 // 默认卡片宽度：仅用于估算「能放几个」
const MIN_TAB_W = 96 // 单卡最小宽度下限，过窄则减少可见数

/** 滚轮画廊动画状态（标签单位，浮点） */
let animStart = 0
let velocity = 0
let wheelRAF = 0

/** 到头回弹反馈 */
const bounceDir = ref(0) // -1 左到头 / 1 右到头 / 0 无
let bounceTimer = 0
function triggerBounce(dir: number): void {
  bounceDir.value = dir
  if (bounceTimer) clearTimeout(bounceTimer)
  bounceTimer = window.setTimeout(() => {
    bounceDir.value = 0
  }, 240)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function compute(): void {
  const c = scroller.value
  if (!c) return
  const len = tabs.tabs.length
  if (len === 0) {
    windowStart.value = 0
    windowCount.value = 0
    return
  }

  // 1) 默认宽度估算可见数
  const avail = c.clientWidth
  let cap = Math.max(1, Math.floor(avail / DEFAULT_TAB_W))
  while (cap > 1 && avail / cap < MIN_TAB_W) cap-- // 太窄则减，避免卡片被压垮
  cap = Math.min(cap, len)

  // 2) 窗口起点：浏览中锁动画位置；否则让 active 始终可见（不强制居中，避免与浏览打架）
  let start: number
  if (browsing.value) {
    start = clamp(Math.round(animStart), 0, Math.max(0, len - cap))
  } else {
    const a = tabs.tabs.findIndex((tb) => tb.path === tabs.activePath)
    let s = windowStart.value
    if (a < 0) s = 0
    else if (a < s) s = a
    else if (a >= s + cap) s = a - cap + 1
    else s = clamp(s, 0, Math.max(0, len - cap))
    start = clamp(s, 0, Math.max(0, len - cap))
  }
  windowStart.value = start
  windowCount.value = cap
}

/* rAF 批处理：合并连续触发，避免切标签 / 缩放时的多次同步回流 */
let rafId = 0
function scheduleRecompute(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = 0
    compute()
  })
}

/* ── 渐隐提示边：左 / 右是否还有更多可滚内容 ── */
const showFadeL = computed(() => windowStart.value > 0)
const showFadeR = computed(() => windowStart.value + windowCount.value < tabs.tabs.length)

let ro: ResizeObserver | null = null
onMounted(() => {
  compute()
  scheduleRecompute()
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    ro = new ResizeObserver(() => scheduleRecompute())
    ro.observe(scroller.value)
  }
  window.addEventListener('resize', scheduleRecompute)
  // 字体加载完成后标签宽度会变，重算一次
  if (typeof document !== 'undefined' && 'fonts' in document) {
    void document.fonts.ready.then(() => scheduleRecompute())
  }
})
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (wheelRAF) cancelAnimationFrame(wheelRAF)
  if (bounceTimer) clearTimeout(bounceTimer)
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
  const dir = d > 0 ? 1 : -1
  const maxStart = Math.max(0, tabs.tabs.length - windowCount.value)
  // 已到边界再往同方向滚 → 回弹反馈，不再移动
  if ((dir > 0 && windowStart.value >= maxStart) || (dir < 0 && windowStart.value <= 0)) {
    triggerBounce(dir)
    return
  }
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
    <div
      ref="scroller"
      class="tabbar__scroll"
      :class="{ 'is-bounce-l': bounceDir === -1, 'is-bounce-r': bounceDir === 1 }"
      @wheel="onWheel"
    >
      <div
        v-for="tab in visibleTabs"
        :key="tab.path"
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

      <!-- 渐隐提示边：左右还有更多可滚内容时浮现 -->
      <div class="tabbar__fade tabbar__fade--l" :class="{ 'is-on': showFadeL }" />
      <div class="tabbar__fade tabbar__fade--r" :class="{ 'is-on': showFadeR }" />
    </div>

    <!-- 常驻占位：显隐只切 visibility，保证 scroller 可用宽度恒定不抖动 -->
    <span class="tabbar__pos" :class="{ 'is-hidden': overflowCount <= 0 }" :title="L.tabPos">{{
      posLabel
    }}</span>

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
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

/* 到头回弹反馈 */
@keyframes tab-bounce-l {
  0% {
    transform: translateX(0);
  }
  35% {
    transform: translateX(-5px);
  }
  100% {
    transform: translateX(0);
  }
}
@keyframes tab-bounce-r {
  0% {
    transform: translateX(0);
  }
  35% {
    transform: translateX(5px);
  }
  100% {
    transform: translateX(0);
  }
}
.tabbar__scroll.is-bounce-l {
  animation: tab-bounce-l 0.24s var(--ease);
}
.tabbar__scroll.is-bounce-r {
  animation: tab-bounce-r 0.24s var(--ease);
}

/* 渐隐提示边：左 / 右还有更多可滚内容 */
.tabbar__fade {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 24px;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
  z-index: 2;
}
.tabbar__fade.is-on {
  opacity: 1;
}
.tabbar__fade--l {
  left: 0;
  background: linear-gradient(to right, var(--hue-base), transparent);
}
.tabbar__fade--r {
  right: 0;
  background: linear-gradient(to left, var(--hue-base), transparent);
}

/* 可见标签：flex:1 均匀占满可见区，永远不留空位 */
.tab {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  flex: 1 1 auto;
  min-width: 0;
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
