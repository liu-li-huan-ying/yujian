<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { NoteTitleItem } from '../../electron/shared/ipc-channels'

/**
 * `[[` 自动补全浮层（Phase 3 批次二收尾项）。
 *
 * 纯展示组件：候选、高亮下标、锚点坐标全部由父组件（编辑器）给，自身只负责
 * 定位（视口内翻转 / 夹取）、键盘高亮项的滚动跟随与鼠标点选。
 * 挂在 body 下用 position: fixed —— 避开 .milkdown-host 的 overflow:hidden 裁切。
 */

const props = defineProps<{
  items: NoteTitleItem[]
  activeIndex: number
  /** 触发处 `[[` 的视口坐标 */
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'pick', index: number): void
  /** 悬停只移动高亮，不确认——避免鼠标划过就误插链接 */
  (e: 'hover', index: number): void
  (e: 'close'): void
}>()

const el = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const pos = ref({ left: '0px', top: '0px' })

/** 视口内定位：优先落在 `[[` 正下方，右侧/下方放不下则翻转，最后夹回安全区 */
async function reposition(): Promise<void> {
  await nextTick()
  const r = el.value?.getBoundingClientRect()
  const w = r?.width ?? 300
  const h = r?.height ?? 220
  const pad = 12
  let left = props.x
  let top = props.y + 6
  if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad
  if (left < 8) left = 8
  if (top + h > window.innerHeight - pad) top = props.y - h - 18
  if (top < 8) top = 8
  pos.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
}

/** 键盘上下移动时，让高亮项始终留在可视区内 */
watch(
  () => props.activeIndex,
  () => {
    void nextTick(() => {
      const box = listEl.value
      const cur = box?.querySelector('.ws__item--on') as HTMLElement | null
      cur?.scrollIntoView({ block: 'nearest' })
    })
  }
)

watch(() => [props.x, props.y, props.items.length], () => void reposition(), { immediate: true })
onMounted(() => void reposition())

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}
</script>

<template>
  <div ref="el" class="ws glass" :style="pos" role="listbox" aria-label="笔记链接建议">
    <div ref="listEl" class="ws__list">
      <button
        v-for="(it, i) in items"
        :key="it.path"
        type="button"
        class="ws__item"
        :class="{ 'ws__item--on': i === activeIndex }"
        role="option"
        :aria-selected="i === activeIndex"
        :title="it.path"
        @mousedown.prevent
        @mouseenter="emit('hover', i)"
        @click="emit('pick', i)"
      >
        <span class="ws__main">
          <span class="ws__title">{{ it.title }}</span>
          <span v-if="it.base !== it.title" class="ws__base">{{ it.base }}</span>
        </span>
        <span class="ws__dir">{{ dirOf(it.path) }}</span>
      </button>
      <p v-if="items.length === 0" class="ws__empty">无匹配笔记</p>
    </div>
    <p class="ws__foot">↑↓ 选择 · Enter 确认 · Esc 取消</p>
  </div>
</template>

<style scoped>
.ws {
  position: fixed;
  z-index: 60;
  width: 300px;
  max-width: calc(100vw - 24px);
  padding: 5px;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: ws-in 0.1s var(--ease, ease) both;
}
@keyframes ws-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ws__list {
  max-height: 208px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ws__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast, 0.12s) var(--ease, ease);
}
.ws__item--on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
}

.ws__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.ws__title {
  font-size: 12.5px;
  font-weight: 500;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws__base {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws__dir {
  flex: 0 0 auto;
  max-width: 40%;
  font-size: 10px;
  opacity: 0.62;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws__empty {
  margin: 0;
  padding: 14px 8px;
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
}

.ws__foot {
  margin: 0;
  padding: 4px 7px 2px;
  border-top: 1px solid var(--hue-border-subtle);
  font-size: 10.5px;
  color: var(--hue-text-3);
  letter-spacing: 0.01em;
}
</style>
