<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'

export interface MenuItem {
  /** 菜单项唯一标识，供父组件区分动作 */
  action: string
  label: string
  /** 危险操作（删除），用警示色 */
  danger?: boolean
  disabled?: boolean
  /** 当前选中项（溢出标签菜单用），高亮显示 */
  active?: boolean
  /** 仅作分隔线，不触发动作 */
  separator?: boolean
}

const props = defineProps<{
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', action: string): void
  (e: 'close'): void
}>()

const MENU_W = 188
const MENU_MAX_H = 280

/** 让菜单始终落在视口内 */
const pos = computed(() => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(Math.max(8, props.x), vw - MENU_W - 8)
  const top = Math.min(Math.max(8, props.y), vh - MENU_MAX_H - 8)
  return { left: `${left}px`, top: `${top}px` }
})

function onItem(item: MenuItem): void {
  if (item.disabled || item.separator) return
  emit('select', item.action)
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

/** 点击菜单外部（含其它节点的右键）→ 关闭 */
function onOutside(): void {
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  // 延迟一帧再挂外部监听，避免「打开菜单的那次点击」立刻把它关掉
  window.setTimeout(() => window.addEventListener('mousedown', onOutside), 0)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousedown', onOutside)
})
</script>

<template>
  <div class="ctx glass" :style="pos" role="menu" @mousedown.stop @contextmenu.prevent>
    <template v-for="(item, i) in items" :key="item.separator ? `sep-${i}` : item.action">
      <div v-if="item.separator" class="ctx__sep" />
      <button
        v-else
        class="ctx__item"
        :class="{ 'ctx__item--danger': item.danger, 'ctx__item--disabled': item.disabled, 'ctx__item--active': item.active }"
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        @click="onItem(item)"
      >
        {{ item.label }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.ctx {
  position: fixed;
  z-index: 60;
  width: 188px;
  max-height: var(--menu-max-h, 280px);
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
}

.ctx__sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--hue-border-subtle);
}

.ctx__item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.ctx__item:hover:not(.ctx__item--disabled) {
  background: var(--hue-active);
}

.ctx__item--active {
  background: rgba(var(--hue-tint-1), 0.14);
  color: var(--hue-accent);
  font-weight: 600;
}

.ctx__item--danger {
  color: var(--hue-danger);
}

.ctx__item--danger:hover:not(.ctx__item--disabled) {
  background: rgba(var(--hue-tint-1), 0.12);
}

.ctx__item--disabled {
  color: var(--hue-text-3);
  cursor: default;
  opacity: 0.55;
}

.ctx__item:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}
</style>
