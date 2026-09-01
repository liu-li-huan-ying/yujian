<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import type { TextStats } from '../utils/text-stats'
import { useI18n } from '../i18n'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  stats: TextStats
  selectionCount: number
  /** 写作目标字数（0 表示未设目标） */
  goal: number
}>()

const emit = defineEmits<{
  (e: 'update:goal', value: number): void
  (e: 'close'): void
}>()

/* 写作目标：本地输入同步到外部（会话持久化由父组件负责） */
const goalInput = ref(String(props.goal || ''))
watch(
  () => props.goal,
  (v) => {
    if (String(v || '') !== goalInput.value) goalInput.value = String(v || '')
  }
)
function onGoalInput(): void {
  const n = parseInt(goalInput.value, 10)
  emit('update:goal', Number.isFinite(n) && n > 0 ? n : 0)
}

/* 进度环：汉字数 / 目标 */
const R = 26
const CIRC = 2 * Math.PI * R
const ratio = computed(() => (props.goal > 0 ? Math.min(1, props.stats.han / props.goal) : 0))
const dashoffset = computed(() => CIRC * (1 - ratio.value))
const pct = computed(() => (props.goal > 0 ? Math.round(ratio.value * 100) : 0))

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div class="stats glass" role="dialog" aria-label="写作统计" @keydown="onKey">
    <div class="stats__head">
      <span class="stats__title">{{ L.stats }}</span>
      <button class="stats__x" type="button" :title="L.close" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <div class="stats__grid">
      <div class="cell">
        <span class="cell__val">{{ stats.han }}</span>
        <span class="cell__label">{{ L.charCount }}</span>
      </div>
      <div class="cell">
        <span class="cell__val">{{ stats.words }}</span>
        <span class="cell__label">{{ L.wordCount }}</span>
      </div>
      <div class="cell">
        <span class="cell__val">{{ stats.chars }}</span>
        <span class="cell__label">{{ L.totalChars }}</span>
      </div>
      <div class="cell">
        <span class="cell__val">{{ stats.charsNoSpace }}</span>
        <span class="cell__label">{{ L.totalCharsNoSpace }}</span>
      </div>
      <div class="cell cell--wide">
        <span class="cell__val">{{ stats.readingMinutes }}{{ L.unitMin }}</span>
        <span class="cell__label">{{ L.readingTime }}</span>
      </div>
    </div>

    <div v-if="selectionCount > 0" class="stats__sel">
      {{ L.selectionStats }} · {{ selectionCount }}
    </div>

    <div class="stats__goal">
      <div class="ring">
        <svg viewBox="0 0 64 64" width="64" height="64">
          <circle class="ring__bg" cx="32" cy="32" :r="R" />
          <circle
            class="ring__fg"
            cx="32"
            cy="32"
            :r="R"
            :stroke-dasharray="CIRC"
            :stroke-dashoffset="dashoffset"
            transform="rotate(-90 32 32)"
          />
          <text class="ring__txt" x="32" y="32">{{ pct }}%</text>
        </svg>
      </div>
      <div class="goal__meta">
        <label class="goal__label" for="goal">{{ L.writingGoal }}</label>
        <input
          id="goal"
          v-model="goalInput"
          class="goal__input"
          type="number"
          min="0"
          :placeholder="L.writingGoalPlaceholder"
          @input="onGoalInput"
        />
        <span class="goal__hint">{{ L.goalProgress }}{{ stats.han }} / {{ goal || 0 }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats {
  position: absolute;
  right: 14px;
  bottom: 8px;
  z-index: 30;
  width: 280px;
  max-width: calc(100% - 28px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stats__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stats__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.stats__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
}
.stats__x:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.stats__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  border: 1px solid var(--hue-border-subtle);
}
.cell--wide {
  grid-column: span 2;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
}
.cell__val {
  font-size: 18px;
  font-weight: 600;
  color: var(--hue-text-1);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.cell__label {
  font-size: 11px;
  color: var(--hue-text-3);
}
.cell--wide .cell__val {
  font-size: 15px;
}

.stats__sel {
  font-size: 11.5px;
  color: var(--hue-text-2);
  padding: 4px 2px 0;
  border-top: 1px solid var(--hue-border-subtle);
}

.stats__goal {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--hue-border-subtle);
}
.ring {
  flex-shrink: 0;
}
.ring__bg {
  fill: none;
  stroke: var(--hue-border-subtle);
  stroke-width: 6;
}
.ring__fg {
  fill: none;
  stroke: var(--hue-accent);
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-med) var(--ease);
}
.ring__txt {
  fill: var(--hue-text-1);
  font-size: 13px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
  font-variant-numeric: tabular-nums;
}
.goal__meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}
.goal__label {
  font-size: 11.5px;
  color: var(--hue-text-3);
}
.goal__input {
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
.goal__input:focus {
  border-color: var(--hue-accent);
}
.goal__hint {
  font-size: 11px;
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
}
</style>
