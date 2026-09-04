<script setup lang="ts">
/**
 * 轨道视图容器（落实 docs/PHASE3-UI-DESIGN.md §3：左右双栏多视图切换）。
 *
 * 左栏承载「文件 / 标签 / 内容地图」，右栏承载「大纲 / 反链 / 快照」。
 * 每个视图是一个图标 tab，点击切换；被承载的面板原本是浮在编辑器上的玻璃卡片
 * （position:absolute + 圆角 + 阴影），这里用 :deep() 把它们「拉」进轨道、
 * 改成填满轨道的一等公民，玉质底色由轨道自身提供，无需改写各面板源码。
 */
import { ref } from 'vue'
import Icon from './Icon.vue'

export interface RailTab {
  key: string
  label: string
  icon: string
}

const props = defineProps<{
  side: 'left' | 'right'
  width: number
  tabs: RailTab[]
  active: string
  /** 是否可拖拽调宽（左栏由内部 Sidebar 自带拖条，故左栏传 false） */
  resizable?: boolean
  min?: number
  max?: number
}>()

const emit = defineEmits<{
  (e: 'update:active', key: string): void
  (e: 'update:width', width: number): void
}>()

function select(key: string): void {
  emit('update:active', key)
}

const dragging = ref(false)

function startDrag(e: PointerEvent): void {
  if (!props.resizable) return
  dragging.value = true
  const startX = e.clientX
  const startW = props.width
  const min = props.min ?? 200
  const max = props.max ?? 560
  const onMove = (ev: PointerEvent): void => {
    // 左栏拖右边界向右增宽；右栏拖左边界向左增宽（用符号翻转）
    const delta = ev.clientX - startX
    const next = props.side === 'left' ? startW + delta : startW - delta
    emit('update:width', Math.min(max, Math.max(min, next)))
  }
  const onUp = (): void => {
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <aside
    class="rail jade"
    :class="[`rail--${side}`, { 'rail--drag': dragging }]"
    :style="{ width: width + 'px' }"
  >
    <div class="rail__tabs" role="tablist" :aria-label="side === 'left' ? '左栏视图' : '右栏视图'">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="rail__tab"
        :class="{ 'rail__tab--on': t.key === active }"
        type="button"
        role="tab"
        :aria-selected="t.key === active"
        :title="t.label"
        :aria-label="t.label"
        @click="select(t.key)"
      >
        <Icon :name="t.icon" :size="16" />
      </button>
    </div>

    <div class="rail__pane">
      <slot />
    </div>

    <div
      v-if="resizable"
      class="rail__resizer"
      :class="{ 'rail__resizer--active': dragging }"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startDrag"
    />
  </aside>
</template>

<style scoped>
.rail {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--hue-border-subtle);
  transition: width var(--dur-base) var(--ease);
}
.rail--right {
  border-right: none;
  border-left: 1px solid var(--hue-border-subtle);
}
.rail--drag {
  transition: none;
}

.rail__tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex-shrink: 0;
  height: var(--h-crumb, 34px);
  padding: 4px 6px;
  border-bottom: 1px solid var(--hue-border-subtle);
  background: var(--hue-highlight, rgba(127, 127, 127, 0.04));
}

.rail__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.rail__tab:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}
.rail__tab--on {
  color: var(--hue-accent);
  background: var(--hue-active);
}
.rail__tab:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

.rail__pane {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* 内置面板原是浮在编辑器上的玻璃卡片，进轨道后须改为填满轨道的一等公民 */
.rail__pane :deep(.tags),
.rail__pane :deep(.moc),
.rail__pane :deep(.bl),
.rail__pane :deep(.snap) {
  position: relative !important;
  inset: auto !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  left: auto !important;
  width: 100% !important;
  max-width: none !important;
  max-height: none !important;
  height: 100% !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  z-index: auto !important;
  animation: none !important;
}
/* 大纲与文件树自身带分隔边框，轨道已提供分隔线，去掉避免双线 */
.rail__pane :deep(.outline),
.rail__pane :deep(.sidebar) {
  width: 100% !important;
  height: 100% !important;
  border: none !important;
}

.rail__resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 2;
}
.rail__resizer--active {
  background: var(--hue-accent);
  opacity: 0.5;
}
.rail--left .rail__resizer {
  right: -2px;
}
.rail--right .rail__resizer {
  left: -2px;
}
</style>
