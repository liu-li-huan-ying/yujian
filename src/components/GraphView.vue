<script setup lang="ts">
/**
 * 关系图谱 · 全屏独立视图（批次三之三，规格见 docs/PHASE3-UI-DESIGN.md §4.3）。
 *
 * 设计要点：
 *  - 数据完全由索引派生（主进程 buildGraph），本组件零扫描、零额外数据层；
 *  - **Canvas 2D 渲染**：节点数多时 SVG DOM 会拖垮渲染，故一律走画布；
 *  - **力导布局用 d3-force**（纯 JS、无 node-gyp）：限节点 ≤300 + alpha 衰减停算；
 *  - 底用 `--hue-editor` 纯净实色，**不叠加玉质纹理**（线条 / 小字最怕纹理干扰）；
 *  - 无障碍：Canvas 不可读 → 提供等价的**列表视图**（图谱 / 列表切换，键盘可操作）；
 *  - `prefers-reduced-motion` → 直接跑到收敛终态、不做逐帧动画。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum
} from 'd3-force'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import type { GraphData, GraphNode, GraphEdge, GraphRequest } from '../../electron/shared/ipc-channels'

/** 与主进程 GRAPH_MAX_NODES 保持一致的渲染上限（超出的提示条 / 采样由主进程完成） */
const MAX_NODES = 300

/** d3-force 的可变节点：在图谱节点上补 x/y/vx/vy 与半径 */
interface SimNode extends GraphNode, SimulationNodeDatum {
  r: number
}
type SimLink = SimulationLinkDatum<SimNode>

const props = defineProps<{
  /** 当前笔记库根；为空则不渲染 */
  vaultPath: string
  /** 当前笔记绝对路径（本地子图中心）；为空则本地子图退化为全局 */
  centerPath: string | null
}>()

const emit = defineEmits<{
  /** 双击节点 / 点击列表条目：打开该笔记 */
  (e: 'open', path: string): void
}>()

const { t } = useI18n()
const G = t.ui

/* ── 数据状态 ─────────────────────────────── */

const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])
const total = ref(0)
const shown = ref(0)
const truncated = ref(false)
const loading = ref(false)

let reqSeq = 0

/** 视图模式：本地子图（以当前笔记为中心）/ 全局 */
const mode = ref<'local' | 'global'>('local')
/** 本地子图跳数 */
const hops = ref<1 | 2 | 3>(2)
/** 渲染形态：画布 / 列表（无障碍等价） */
const viewKind = ref<'canvas' | 'list'>('canvas')

/** 本地模式需要中心笔记；无中心时自动按全局处理 */
const effectiveMode = computed<'local' | 'global'>(() =>
  mode.value === 'local' && props.centerPath ? 'local' : 'global'
)

const listNodes = computed<GraphNode[]>(() =>
  [...nodes.value].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title))
)

/* ── d3-force 仿真（非响应式） ────────────────── */

let sim: Simulation<SimNode, SimLink> | null = null
let simNodes: SimNode[] = []
let simLinks: SimLink[] = []
/** 无向邻接（用于选中高亮邻居 / 列表） */
const adj = new Map<string, Set<string>>()
/** 设备是否偏好减少动画 */
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/* ── 视图变换（平移 / 缩放） ─────────────────── */

const view = { x: 0, y: 0, k: 1 }
const size = { w: 0, h: 0 }
const selectedPath = ref<string | null>(null)
const hoverPath = ref<string | null>(null)

const canvasRef = ref<HTMLCanvasElement | null>(null)
let drawing = false

/* ── 主题取色（Canvas 不能直接用 CSS 变量，需取计算值） ── */

function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
/** 给颜色加透明度：支持 #rgb / #rrggbb / rgb() / rgba() */
function withAlpha(color: string, a: number): string {
  const c = color.trim()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex
    const n = parseInt(full, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  if (c.startsWith('rgb')) {
    const inner = c.replace(/^rgba?\(([^)]+)\)/, '$1')
    const parts = inner.split(',').map((s) => s.trim()).slice(0, 3)
    return `rgba(${parts.join(', ')}, ${a})`
  }
  return c
}

function radiusOf(n: GraphNode): number {
  if (n.center) return 8
  if (effectiveMode.value === 'local') return n.depth <= 1 ? 5 : 3.5
  return 3.5
}
function fillOf(n: GraphNode, accent: string, t2: string, t3: string): string {
  if (n.center) return accent
  if (effectiveMode.value === 'local' && n.depth === 1) return t2
  return t3
}
function neighborSet(path: string): Set<string> {
  const s = new Set<string>([path])
  for (const nb of adj.get(path) ?? []) s.add(nb)
  return s
}

/* ── 绘制 ─────────────────────────────────── */

function scheduleDraw(): void {
  if (drawing) return
  drawing = true
  requestAnimationFrame(() => {
    drawing = false
    draw()
  })
}

function draw(): void {
  const cv = canvasRef.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const w = cv.clientWidth
  const h = cv.clientHeight
  if (w === 0 || h === 0) return
  const dpr = window.devicePixelRatio || 1
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw
    cv.height = ph
  }

  const accent = readVar('--hue-accent', '#5fa8a0')
  const bg = readVar('--hue-editor', '#1c1e1f')
  const t1 = readVar('--hue-text-1', '#e8e9e7')
  const t2 = readVar('--hue-text-2', '#a3a7a5')
  const t3 = readVar('--hue-text-3', '#8b908e')

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(view.x, view.y)
  ctx.scale(view.k, view.k)

  const hl = selectedPath.value ?? hoverPath.value
  const neighbors = hl ? neighborSet(hl) : null

  // 连线
  for (const l of simLinks) {
    const s = l.source as SimNode
    const tg = l.target as SimNode
    if (s.x == null || tg.x == null) continue
    const hot = hl !== null && (s.path === hl || tg.path === hl)
    ctx.strokeStyle = hot ? withAlpha(accent, 0.6) : withAlpha(t3, 0.35)
    ctx.lineWidth = (hot ? 1.4 : 1) / view.k
    ctx.beginPath()
    ctx.moveTo(s.x, s.y!)
    ctx.lineTo(tg.x, tg.y!)
    ctx.stroke()
  }

  // 节点
  for (const n of simNodes) {
    if (n.x == null) continue
    const dim = neighbors !== null && !neighbors.has(n.path)
    ctx.globalAlpha = dim ? 0.4 : 1
    ctx.beginPath()
    ctx.arc(n.x, n.y!, n.r, 0, Math.PI * 2)
    ctx.fillStyle = n.path === selectedPath.value ? accent : fillOf(n, accent, t2, t3)
    ctx.fill()
    if (n.center) {
      ctx.lineWidth = 1.5 / view.k
      ctx.strokeStyle = t1
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // 标签
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const n of simNodes) {
    if (n.x == null) continue
    const dim = neighbors !== null && !neighbors.has(n.path)
    const show =
      n.center ||
      n.path === selectedPath.value ||
      n.path === hoverPath.value ||
      (effectiveMode.value === 'local' && n.depth === 1)
    if (!show || dim) continue
    const fs = n.center ? 12 : 11
    ctx.font = `${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3 / view.k
    ctx.strokeStyle = bg
    ctx.strokeText(n.title, n.x, n.y! - n.r - 7)
    ctx.fillStyle = n.center ? t1 : t2
    ctx.fillText(n.title, n.x, n.y! - n.r - 7)
  }

  ctx.restore()
}

/* ── 布局重建 ─────────────────────────────── */

function rebuild(): void {
  sim?.stop()
  sim = null
  adj.clear()
  const byPath = new Map<string, SimNode>()
  simNodes = nodes.value.map((n) => {
    const s: SimNode = { ...n, x: undefined, y: undefined, r: radiusOf(n) }
    byPath.set(n.path, s)
    return s
  })
  simLinks = edges.value
    .map((e) => ({ source: byPath.get(e.source)!, target: byPath.get(e.target)! }) as SimLink)
    .filter((l) => l.source && l.target)
  const link = (a: string, b: string): void => {
    let set = adj.get(a)
    if (!set) {
      set = new Set<string>()
      adj.set(a, set)
    }
    set.add(b)
  }
  for (const l of simLinks) {
    const s = l.source as SimNode
    const tg = l.target as SimNode
    link(s.path, tg.path)
    link(tg.path, s.path)
  }
  selectedPath.value = null
  hoverPath.value = null
  view.x = 0
  view.y = 0
  view.k = 1

  const w = size.w || 800
  const h = size.h || 600
  sim = forceSimulation<SimNode>(simNodes)
    .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.path).distance(30).strength(0.35))
    .force('charge', forceManyBody<SimNode>().strength(-70))
    .force('center', forceCenter(w / 2, h / 2))
    .force('collide', forceCollide<SimNode>().radius((d) => d.r + 3))
    .alphaDecay(0.045)

  if (reducedMotion) {
    sim.stop()
    for (let i = 0; i < 300; i++) sim.tick()
    draw()
  } else {
    sim.on('tick', scheduleDraw)
  }
}

/* ── 数据拉取 ─────────────────────────────── */

async function fetchGraph(): Promise<void> {
  if (!props.vaultPath) {
    nodes.value = []
    edges.value = []
    total.value = 0
    shown.value = 0
    truncated.value = false
    rebuild()
    return
  }
  const seq = ++reqSeq
  loading.value = true
  const req: GraphRequest =
    effectiveMode.value === 'local'
      ? { center: props.centerPath, maxHops: hops.value, maxNodes: MAX_NODES }
      : { center: null, maxNodes: MAX_NODES }
  try {
    const d: GraphData = await window.api.getGraph(props.vaultPath, req)
    if (seq !== reqSeq) return // 竞态：过期请求丢弃
    nodes.value = d.nodes
    edges.value = d.edges
    total.value = d.total
    shown.value = d.shown
    truncated.value = d.truncated
    rebuild()
  } catch {
    if (seq === reqSeq) {
      nodes.value = []
      edges.value = []
      rebuild()
    }
  } finally {
    if (seq === reqSeq) loading.value = false
  }
}

function setMode(m: 'local' | 'global'): void {
  if (m === 'local' && !props.centerPath) return
  if (mode.value === m) return
  mode.value = m
  void fetchGraph()
}
function setHops(h: 1 | 2 | 3): void {
  if (hops.value === h) return
  hops.value = h
  if (effectiveMode.value === 'local') void fetchGraph()
}

/* ── 命中测试 / 交互 ─────────────────────────── */

/** 屏幕坐标 → 最近的节点（屏幕空间命中，半径 + 6px 容差） */
function hitTest(sx: number, sy: number): SimNode | null {
  let best: SimNode | null = null
  let bestD = Infinity
  for (const n of simNodes) {
    if (n.x == null) continue
    const px = n.x * view.k + view.x
    const py = n.y! * view.k + view.y
    const d = Math.hypot(px - sx, py - sy)
    if (d <= n.r * view.k + 6 && d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'node'; node: SimNode; moved: boolean }

let drag: DragState = { kind: 'none' }

function localPos(e: PointerEvent): { sx: number; sy: number } {
  const cv = canvasRef.value!
  const r = cv.getBoundingClientRect()
  return { sx: e.clientX - r.left, sy: e.clientY - r.top }
}

function onPointerDown(e: PointerEvent): void {
  const { sx, sy } = localPos(e)
  const hit = hitTest(sx, sy)
  if (hit) {
    drag = { kind: 'node', node: hit, moved: false }
  } else {
    drag = { kind: 'pan', sx, sy, ox: view.x, oy: view.y, moved: false }
  }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  const { sx, sy } = localPos(e)
  if (drag.kind === 'none') {
    // 悬停高亮
    const hit = hitTest(sx, sy)
    const next = hit?.path ?? null
    if (next !== hoverPath.value) {
      hoverPath.value = next
      scheduleDraw()
    }
    return
  }
  if (drag.kind === 'pan') {
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 3) drag.moved = true
    view.x = drag.ox + (sx - drag.sx)
    view.y = drag.oy + (sy - drag.sy)
    scheduleDraw()
    return
  }
  // 拖节点：固定位置（fx/fy 为仿真坐标系）
  drag.moved = true
  drag.node.fx = (sx - view.x) / view.k
  drag.node.fy = (sy - view.y) / view.k
  sim?.alpha(0.3).restart()
  scheduleDraw()
}

function onPointerUp(e: PointerEvent): void {
  const { sx, sy } = localPos(e)
  if (drag.kind === 'node') {
    if (!drag.moved) {
      const hit = hitTest(sx, sy)
      selectedPath.value = selectedPath.value === hit?.path ? null : (hit?.path ?? null)
      scheduleDraw()
    }
  } else if (drag.kind === 'pan' && !drag.moved) {
    selectedPath.value = null
    scheduleDraw()
  }
  drag = { kind: 'none' }
}

function onDblClick(e: MouseEvent): void {
  const cv = canvasRef.value
  if (!cv) return
  const r = cv.getBoundingClientRect()
  const hit = hitTest(e.clientX - r.left, e.clientY - r.top)
  if (hit) emit('open', hit.path)
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const cv = canvasRef.value
  if (!cv) return
  const r = cv.getBoundingClientRect()
  const mx = e.clientX - r.left
  const my = e.clientY - r.top
  const next = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)))
  const ratio = next / view.k
  view.x = mx - (mx - view.x) * ratio
  view.y = my - (my - view.y) * ratio
  view.k = next
  scheduleDraw()
}

function zoomBy(factor: number): void {
  const cx = size.w / 2
  const cy = size.h / 2
  const next = Math.min(4, Math.max(0.2, view.k * factor))
  const ratio = next / view.k
  view.x = cx - (cx - view.x) * ratio
  view.y = cy - (cy - view.y) * ratio
  view.k = next
  scheduleDraw()
}

/** 适应窗口：把全部节点包进画布（留 48px 边距） */
function fitView(): void {
  const pts = simNodes.filter((n) => n.x != null)
  if (pts.length === 0 || size.w === 0) return
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of pts) {
    minX = Math.min(minX, n.x!)
    minY = Math.min(minY, n.y!)
    maxX = Math.max(maxX, n.x!)
    maxY = Math.max(maxY, n.y!)
  }
  const pad = 48
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  const k = Math.min(2, Math.max(0.2, Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh)))
  view.k = k
  view.x = size.w / 2 - ((minX + maxX) / 2) * k
  view.y = size.h / 2 - ((minY + maxY) / 2) * k
  scheduleDraw()
}

/* ── 生命周期 ─────────────────────────────── */

let ro: ResizeObserver | null = null
let unsubscribe: (() => void) | null = null
let changeTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  const cv = canvasRef.value
  if (cv) {
    ro = new ResizeObserver(() => {
      if (!cv) return
      size.w = cv.clientWidth
      size.h = cv.clientHeight
      sim?.force('center', forceCenter(size.w / 2, size.h / 2))
      scheduleDraw()
    })
    ro.observe(cv)
    size.w = cv.clientWidth
    size.h = cv.clientHeight
  }
  void fetchGraph()
  // 外部改动 / 编辑保存 → 索引更新后刷新图谱（去抖，避免高频抖动）
  unsubscribe = window.api.onVaultChange(() => {
    if (changeTimer) clearTimeout(changeTimer)
    changeTimer = setTimeout(() => void fetchGraph(), 400)
  })
})

onBeforeUnmount(() => {
  sim?.stop()
  sim = null
  ro?.disconnect()
  ro = null
  unsubscribe?.()
  unsubscribe = null
  if (changeTimer) clearTimeout(changeTimer)
})

// 切换当前笔记 → 本地子图中心变化 → 重取
watch(
  () => props.centerPath,
  () => {
    if (effectiveMode.value === 'local') void fetchGraph()
  }
)
// 切换库 → 全部重取
watch(
  () => props.vaultPath,
  () => void fetchGraph()
)
// 切到列表视图时无需重算布局，但仍确保有一次绘制
watch(viewKind, () => scheduleDraw())
</script>

<template>
  <div class="graph">
    <!-- 控制条：玻璃小胶囊，浮于右上 -->
    <div class="graph__ctrl glass">
      <div class="graph__seg">
        <button
          class="graph__segbtn"
          :class="{ 'graph__segbtn--on': effectiveMode === 'local' }"
          type="button"
          :disabled="!centerPath"
          @click="setMode('local')"
        >
          {{ G.graphLocal }}
        </button>
        <button
          class="graph__segbtn"
          :class="{ 'graph__segbtn--on': effectiveMode === 'global' }"
          type="button"
          @click="setMode('global')"
        >
          {{ G.graphGlobal }}
        </button>
      </div>

      <div v-if="effectiveMode === 'local'" class="graph__seg" :aria-label="G.graphHops">
        <button
          v-for="h in ([1, 2, 3] as const)"
          :key="h"
          class="graph__segbtn"
          :class="{ 'graph__segbtn--on': hops === h }"
          type="button"
          :aria-pressed="hops === h"
          @click="setHops(h)"
        >
          {{ h }}
        </button>
      </div>

      <div class="graph__seg">
        <button class="graph__iconbtn" type="button" :title="G.graphZoomOut" @click="zoomBy(1 / 1.25)">
          <Icon name="minus" :size="15" />
        </button>
        <button class="graph__iconbtn" type="button" :title="G.graphFit" @click="fitView()">
          <Icon name="fit" :size="15" />
        </button>
        <button class="graph__iconbtn" type="button" :title="G.graphZoomIn" @click="zoomBy(1.25)">
          <Icon name="plus" :size="15" />
        </button>
      </div>

      <div class="graph__seg">
        <button
          class="graph__segbtn"
          :class="{ 'graph__segbtn--on': viewKind === 'canvas' }"
          type="button"
          @click="viewKind = 'canvas'"
        >
          {{ G.graphCanvasView }}
        </button>
        <button
          class="graph__segbtn"
          :class="{ 'graph__segbtn--on': viewKind === 'list' }"
          type="button"
          @click="viewKind = 'list'"
        >
          {{ G.graphListView }}
        </button>
      </div>
    </div>

    <!-- 画布 -->
    <canvas
      v-show="viewKind === 'canvas' && nodes.length > 0"
      ref="canvasRef"
      class="graph__canvas"
      aria-hidden="true"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDblClick"
      @wheel="onWheel"
    />

    <!-- 截断提示条（性能护栏） -->
    <div v-if="truncated && nodes.length > 0" class="graph__hint graph__hint--left glass">
      {{ G.graphTruncated.replace('{shown}', String(shown)).replace('{total}', String(total)) }}
    </div>

    <!-- 操作提示 -->
    <div v-if="viewKind === 'canvas' && nodes.length > 0" class="graph__hint graph__hint--center">
      {{ G.graphHint }}
    </div>

    <!-- 空态 -->
    <div v-if="nodes.length === 0 && !loading" class="graph__empty">{{ G.graphEmpty }}</div>

    <!-- 列表视图（Canvas 的无障碍等价） -->
    <div
      v-show="viewKind === 'list'"
      class="graph__list"
      role="list"
      :aria-label="G.graphListTitle"
    >
      <div class="graph__listhead">{{ G.graphNodeCount.replace('{n}', String(nodes.length)) }}</div>
      <button
        v-for="n in listNodes"
        :key="n.path"
        class="graph__row"
        type="button"
        role="listitem"
        @click="emit('open', n.path)"
      >
        <span class="graph__rowdot" :class="{ 'graph__rowdot--center': n.center }" />
        <span class="graph__rowtitle">{{ n.title }}</span>
        <span v-if="n.moc" class="graph__rowbadge">MOC</span>
        <span v-for="tag in n.tags.slice(0, 3)" :key="tag" class="graph__tag">#{{ tag }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.graph {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 图谱底：纯净实色，不叠加玉质纹理（UI-DESIGN §1.4 / §4.3） */
  background: var(--hue-editor);
}

.graph__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
}
.graph__canvas:active {
  cursor: grabbing;
}

/* 控制条：浮于右上，玻璃小胶囊 */
.graph__ctrl {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: var(--radius-lg, 12px);
  backdrop-filter: blur(10px);
}

.graph__seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-md, 8px);
  background: var(--bg-hover, rgba(127, 127, 127, 0.08));
}

.graph__segbtn,
.graph__iconbtn {
  height: 24px;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--hue-text-2);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast, 0.12s) var(--ease, ease),
    color var(--dur-fast, 0.12s) var(--ease, ease);
}
.graph__segbtn {
  padding: 0 9px;
}
.graph__iconbtn {
  width: 24px;
}
.graph__segbtn:hover:not(:disabled),
.graph__iconbtn:hover {
  color: var(--hue-text-1);
  background: var(--hue-highlight, rgba(127, 127, 127, 0.1));
}
.graph__segbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.graph__segbtn--on {
  background: var(--hue-active);
  color: var(--hue-accent);
}
.graph__segbtn:focus-visible,
.graph__iconbtn:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

/* 提示条 */
.graph__hint {
  position: absolute;
  z-index: 2;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--hue-text-2);
  pointer-events: none;
  white-space: nowrap;
}
.graph__hint--left {
  left: 12px;
  bottom: 12px;
  backdrop-filter: blur(10px);
}
.graph__hint--center {
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
}

/* 空态 */
.graph__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hue-text-3);
  font-size: 13px;
  text-align: center;
  padding: 0 40px;
}

/* 列表视图 */
.graph__list {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 56px 16px 20px;
}
.graph__listhead {
  font-size: 11px;
  color: var(--hue-text-3);
  margin: 0 4px 8px;
}
.graph__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: var(--hue-text-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.graph__row:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.08));
  color: var(--hue-text-1);
}
.graph__row:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}
.graph__rowdot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hue-text-3);
}
.graph__rowdot--center {
  width: 9px;
  height: 9px;
  background: var(--hue-accent);
}
.graph__rowtitle {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph__rowbadge {
  flex: 0 0 auto;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--hue-accent);
  background: var(--hue-active);
}
.graph__tag {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--hue-text-3);
}
</style>
