<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'

/** 菜单项：与 ContextMenu 的 MenuItem 语义一致，额外支持 icon / hint（右侧键位提示）。
 *  分隔线只需 { separator: true }，其余字段均可省略。 */
export interface MenuEntry {
  action?: string
  label?: string
  icon?: string
  /** 右侧灰字提示（如快捷键），不参与点击语义 */
  hint?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

const props = defineProps<{
  items: MenuEntry[]
  /** 菜单相对触发按钮的对齐方向，默认右对齐（贴右边缘） */
  align?: 'left' | 'right'
}>()

const emit = defineEmits<{
  (e: 'select', action: string): void
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
}

function choose(item: MenuEntry): void {
  const action = item.action
  if (item.separator || item.disabled || !action) return
  open.value = false
  emit('select', action)
}

function onDocClick(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

defineSlots<{
  default(props: { open: boolean; toggle: () => void }): unknown
}>()
</script>

<template>
  <div ref="root" class="tmenu">
    <!-- 触发按钮由父组件提供，拿到 open / toggle 控制高亮与开合 -->
    <slot :open="open" :toggle="toggle" />

    <Transition name="tmenu-pop">
      <ul
        v-if="open"
        class="tmenu__list glass"
        :class="`tmenu__list--${align ?? 'right'}`"
        role="menu"
      >
        <template v-for="(it, i) in items" :key="it.separator ? `sep-${i}` : (it.action ?? i)">
          <li v-if="it.separator" class="tmenu__sep" role="separator" />
          <li v-else>
            <button
              class="tmenu__item"
              :class="{ 'tmenu__item--danger': it.danger, 'is-disabled': it.disabled }"
              type="button"
              role="menuitem"
              :disabled="it.disabled"
              @click="choose(it)"
            >
              <Icon v-if="it.icon" :name="it.icon" :size="15" />
              <span class="tmenu__label">{{ it.label }}</span>
              <span v-if="it.hint" class="tmenu__hint">{{ it.hint }}</span>
            </button>
          </li>
        </template>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.tmenu {
  position: relative;
  display: inline-flex;
}

.tmenu__list {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 196px;
  padding: 5px;
  border-radius: var(--radius-md);
  list-style: none;
  margin: 0;
}

.tmenu__list--right {
  right: 0;
}

.tmenu__list--left {
  left: 0;
}

.tmenu__sep {
  height: 1px;
  margin: 5px 6px;
  background: var(--hue-border-subtle);
}

.tmenu__item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.tmenu__item :deep(.icon) {
  color: var(--hue-text-3);
}

.tmenu__item:hover:not(.is-disabled) {
  background: var(--hue-active);
}

.tmenu__item:hover:not(.is-disabled) :deep(.icon) {
  color: var(--hue-text-1);
}

.tmenu__label {
  flex: 1;
  white-space: nowrap;
}

.tmenu__hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--hue-text-3);
  letter-spacing: 0.02em;
}

.tmenu__item--danger {
  color: var(--hue-danger);
}

.tmenu__item--danger :deep(.icon) {
  color: var(--hue-danger);
}

.tmenu__item--danger:hover:not(.is-disabled) {
  background: rgba(var(--hue-tint-1), 0.14);
}

.tmenu__item.is-disabled {
  color: var(--hue-text-3);
  cursor: default;
  opacity: 0.5;
}

.tmenu__item:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

/* 仅用 transform / opacity 动画，避免重排 */
.tmenu-pop-enter-active,
.tmenu-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.tmenu-pop-enter-from,
.tmenu-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
