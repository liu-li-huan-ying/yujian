<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { acceptProgress, progressPercent } from '../utils/progress'

const props = defineProps<{
  /** 当前模式的编辑面板根元素；组件内部自动查找真正承载滚动的容器 */
  pane: HTMLElement | null
}>()

const rootEl = ref<HTMLDivElement | null>(null)
const pct = ref(0) // 阅读进度 0..100
const scrollable = ref(false) // 内容是否超出一屏（否：隐藏进度条）
const active = ref(false) // 悬停 / 拖拽时高亮

let scroller: HTMLElement | null = null
let mo: MutationObserver | null = null
let raf = 0
let pendingForce = false
let moTimer: ReturnType<typeof setTimeout> | null = null

/** 内容变化的防抖：打字时 DOM 每帧都在变，若每次都读 scrollHeight 会强制布局、拖慢输入。
 *  进度本身只随滚动变，故内容变化只需低频复核「是否超出一屏 / 位置是否被程序改了」。 */
const CONTENT_DEBOUNCE_MS = 200

/** 上一次「真正反映用户滚动」的位置与可滚动高度，用于区分「用户滚动」与「布局回流」 */
let lastTop = -1
let lastMax = -1

/** 在面板子树里找 overflow-y 为 auto/scroll 的元素（Crepe .milkdown / CodeMirror .cm-scroller） */
function resolveScroller(pane: HTMLElement | null): HTMLElement | null {
  if (!pane) return null
  const candidates = [pane, ...Array.from(pane.querySelectorAll('*'))]
  for (const el of candidates) {
    const s = getComputedStyle(el as Element)
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return el as HTMLElement
  }
  return null
}

function ensureScroller(): HTMLElement | null {
  if (scroller && props.pane?.contains(scroller)) return scroller
  scroller = resolveScroller(props.pane)
  return scroller
}

/** 重置锚点（换文档 / 切模式 / 重挂）：下一次计算无条件接管 */
function reanchor(): void {
  lastTop = -1
  lastMax = -1
}

/**
 * 采样一次滚动状态并按需改写刻度。
 * 判定逻辑（含「用户滚动 vs 布局回流」的区分与死区）抽在 `src/utils/progress.ts`，便于单测。
 * `force` 用于换文档 / 拖拽跳转等确需立刻接管的情形。
 */
function compute(force = false): void {
  const el = ensureScroller()
  if (!el) {
    pct.value = 0
    scrollable.value = false
    reanchor()
    return
  }
  const max = el.scrollHeight - el.clientHeight
  if (max <= 1) {
    // 内容不足一屏：隐藏进度条（换文档后长度变短也走这里）
    pct.value = 0
    scrollable.value = false
    lastTop = el.scrollTop
    lastMax = max
    return
  }
  scrollable.value = true
  const top = el.scrollTop
  const accept = acceptProgress({ top, max, lastTop, lastMax, prev: pct.value, force })
  lastTop = top
  lastMax = max
  if (!accept) return
  pct.value = progressPercent(top, max)
}

function schedule(force = false): void {
  pendingForce = pendingForce || force
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const f = pendingForce
    pendingForce = false
    compute(f)
  })
}

function onScroll(): void {
  schedule()
}

/** 内容变化（载入 / 打字 / Crepe 挂载）：防抖后再复核，避免每次按键强制布局 */
function onContentChange(): void {
  if (moTimer) clearTimeout(moTimer)
  moTimer = setTimeout(() => {
    moTimer = null
    schedule()
  }, CONTENT_DEBOUNCE_MS)
}

/* ── 点击 / 拖拽跳转 ───────────────────────── */
function ratioFromEvent(e: PointerEvent): number {
  const rect = rootEl.value!.getBoundingClientRect()
  const y = e.clientY - rect.top
  return Math.min(1, Math.max(0, (y - 8) / (rect.height - 16)))
}

function seek(ratio: number): void {
  const el = ensureScroller()
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  el.scrollTop = ratio * max
  // 拖拽是用户显式意图：立即接管刻度，不做回流抑制
  compute(true)
}

function onPointerDown(e: PointerEvent): void {
  if (!scrollable.value) return
  active.value = true
  rootEl.value?.setPointerCapture(e.pointerId)
  seek(ratioFromEvent(e))
}

function onPointerMove(e: PointerEvent): void {
  if (!active.value) return
  seek(ratioFromEvent(e))
}

function endDrag(e: PointerEvent): void {
  if (!active.value) return
  active.value = false
  rootEl.value?.releasePointerCapture?.(e.pointerId)
}

/* ── 监听面板切换 + 内容变化（载入 / 输入 / 切模式）── */
watch(
  () => props.pane,
  (pane, prev) => {
    if (prev) prev.removeEventListener('scroll', onScroll, true)
    mo?.disconnect()
    if (moTimer) clearTimeout(moTimer)
    moTimer = null
    scroller = null
    reanchor()
    if (pane) {
      // scroll 不冒泡，用捕获阶段捕获子孙容器的滚动
      pane.addEventListener('scroll', onScroll, true)
      // 内容增删（载入新文档、打字、Crepe 挂载）只用于**发现**滚动位置/可滚动高度的变化；
      // compute() 内部的「回流抑制」会把纯高度变化滤掉，故这里防抖后 schedule 即可。
      // 典型受益：换文档后 scrollTop 归零 → 位置变了 → 立即接管；开关侧栏致重排 → 位置未变 → 刻度不动。
      mo = new MutationObserver(onContentChange)
      mo.observe(pane, { childList: true, subtree: true, characterData: true })
      // 挂载/换文档：强制接管一次（新文档通常回到顶部）
      schedule(true)
    } else {
      pct.value = 0
      scrollable.value = false
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  if (moTimer) clearTimeout(moTimer)
  mo?.disconnect()
  if (rootEl.value) rootEl.value.removeEventListener('scroll', onScroll, true)
})

const fillStyle = computed(() => ({
  height: `calc((100% - 16px) * ${pct.value / 100})`
}))
const thumbStyle = computed(() => ({
  top: `calc(8px + (100% - 16px) * ${pct.value / 100} - 5px)`
}))
</script>

<template>
  <div
    ref="rootEl"
    class="reading-progress"
    :class="{ 'is-visible': scrollable, 'is-active': active }"
    @pointerenter="active = true"
    @pointerleave="active = false"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <div class="rp-fill" :style="fillStyle" />
    <div class="rp-thumb" :style="thumbStyle" />
  </div>
</template>

<style scoped>
/* 右侧竖向阅读进度条：贴右 16px 命中区，平时隐于无形，内容可滚动时才浮现 */
.reading-progress {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 16px;
  z-index: var(--z-sticky);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease);
  -webkit-app-region: no-drag;
}
.reading-progress.is-visible {
  opacity: 1;
}

/* 极细玉质轨道：贴右 6px，上下各留 8px 呼吸 */
.reading-progress::before {
  content: '';
  position: absolute;
  right: 6px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: var(--radius-xs);
  background: rgba(var(--hue-tint-2), 0.14);
}

/* 青瓷渐变填充 + 柔和辉光，与全局强调色同源 */
.rp-fill {
  position: absolute;
  right: 6px;
  top: 8px;
  width: 3px;
  border-radius: var(--radius-xs);
  background: linear-gradient(
    180deg,
    var(--hue-accent) 0%,
    rgba(var(--hue-tint-2), 0.92) 100%
  );
  box-shadow: 0 0 8px rgba(var(--hue-tint-2), 0.45);
  transition: height var(--dur-fast) var(--ease);
  pointer-events: none;
}

/* 玉质圆头手柄：默认隐去，悬停 / 拖拽时轻浮，指示可抓取 */
.rp-thumb {
  position: absolute;
  right: 3px;
  width: 9px;
  height: 10px;
  border-radius: var(--radius-sm);
  background: var(--hue-accent);
  box-shadow: 0 0 10px rgba(var(--hue-tint-2), 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  opacity: 0;
  transform: scale(0.8);
  transition: opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
  pointer-events: none;
}
.reading-progress.is-active .rp-thumb,
.reading-progress:hover .rp-thumb {
  opacity: 1;
  transform: scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .rp-fill,
  .rp-thumb {
    transition: none;
  }
}
</style>
