<script setup lang="ts">
import Icon from './Icon.vue'
import { useI18n } from '../i18n'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  query: string
  replace: string
  caseSensitive: boolean
  wholeWord: boolean
  current: number
  total: number
  showReplace: boolean
}>()

const emit = defineEmits<{
  (e: 'update:query', v: string): void
  (e: 'update:replace', v: string): void
  (e: 'update:case-sensitive', v: boolean): void
  (e: 'update:whole-word', v: boolean): void
  (e: 'update:show-replace', v: boolean): void
  (e: 'next'): void
  (e: 'prev'): void
  (e: 'replace-one'): void
  (e: 'replace-all'): void
  (e: 'close'): void
}>()

function onQuery(e: Event): void {
  emit('update:query', (e.target as HTMLInputElement).value)
}
function onReplace(e: Event): void {
  emit('update:replace', (e.target as HTMLInputElement).value)
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.shiftKey ? emit('prev') : emit('next')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div class="find glass" @keydown="onKey">
    <div class="find__row">
      <Icon name="search" :size="14" class="find__icon" />
      <input
        class="find__input"
        :value="query"
        type="text"
        :placeholder="L.findPlaceholder"
        aria-label="查找"
        autofocus
        @input="onQuery"
      />
      <span class="find__count">{{ total ? `${current}/${total}` : query ? L.noMatch : '' }}</span>
      <button class="find__btn" type="button" :title="L.prev" @click="emit('prev')">
        <Icon name="chevron-up" :size="14" />
      </button>
      <button class="find__btn" type="button" :title="L.next" @click="emit('next')">
        <Icon name="chevron-down" :size="14" />
      </button>
      <button class="find__btn" type="button" :title="L.close" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <Transition name="find-expand">
      <div v-if="showReplace" class="find__row">
        <span class="find__icon-placeholder" />
        <input
          class="find__input"
          :value="replace"
          type="text"
          :placeholder="L.replacePlaceholder"
          aria-label="替换为"
          @input="onReplace"
        />
        <button class="find__act" type="button" @click="emit('replace-one')">
          {{ L.replaceOne }}
        </button>
        <button class="find__act" type="button" @click="emit('replace-all')">
          {{ L.replaceAll }}
        </button>
      </div>
    </Transition>

    <div class="find__opts">
      <label class="find__opt" :class="{ 'find__opt--on': caseSensitive }">
        <input
          type="checkbox"
          :checked="caseSensitive"
          @change="emit('update:case-sensitive', ($event.target as HTMLInputElement).checked)"
        />
        {{ L.caseSensitive }}
      </label>
      <label class="find__opt" :class="{ 'find__opt--on': wholeWord }">
        <input
          type="checkbox"
          :checked="wholeWord"
          @change="emit('update:whole-word', ($event.target as HTMLInputElement).checked)"
        />
        {{ L.wholeWord }}
      </label>
      <button class="find__toggle" type="button" @click="emit('update:show-replace', !showReplace)">
        {{ showReplace ? L.hideReplace : L.replace }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.find {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 30;
  width: 344px;
  max-width: calc(100% - 32px);
  padding: 8px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.find__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.find__icon {
  color: var(--hue-text-3);
  flex-shrink: 0;
}
.find__icon-placeholder {
  width: 14px;
  flex-shrink: 0;
}

.find__input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.find__input:focus {
  border-color: var(--hue-accent);
}

.find__count {
  font-size: 11px;
  color: var(--hue-text-3);
  min-width: 40px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.find__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.find__btn:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.find__act {
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: rgba(var(--hue-tint-1), 0.16);
  color: var(--hue-text-1);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.find__act:hover {
  background: var(--hue-active);
  color: var(--hue-accent);
}

.find__opts {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 2px 0;
}
.find__opt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--hue-text-3);
  cursor: pointer;
  user-select: none;
}
.find__opt--on {
  color: var(--hue-accent);
}
.find__opt input {
  accent-color: var(--hue-accent);
}
.find__toggle {
  margin-left: auto;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--hue-text-3);
}
.find__toggle:hover {
  color: var(--hue-text-1);
}

.find-expand-enter-active,
.find-expand-leave-active {
  transition: opacity var(--dur-fast) var(--ease);
}
.find-expand-enter-from,
.find-expand-leave-to {
  opacity: 0;
}
</style>
