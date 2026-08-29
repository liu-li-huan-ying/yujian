<script setup lang="ts">
import { useI18n } from '../i18n'
import { loadAppearance, resolveMode } from '../appearance'
import type { ZenPrefs } from '../../electron/shared/ipc-channels'

/**
 * 凝神 2.0 设置面板（docs/FOCUS-MODE-2.0-DESIGN.md §7）。
 * 玻璃模态；每项改动即时 emit，由 App 合并、应用（zen.setZenPrefs）并 patchSession，
 * 面板本身无保存按钮——「改即生效」。
 * 「光标闪烁频率」被有意否决（原生 caret 不可定制），不提供假开关。
 */
const props = defineProps<{ prefs: ZenPrefs }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'change', patch: Partial<ZenPrefs>): void
}>()

const { t } = useI18n()
const L = t.ui

// 面板按当前实际主题渲染，与其他设置面板一致
const previewMode = resolveMode(loadAppearance().mode)

const anchors: Array<{ v: number; label: string }> = [
  { v: 1 / 3, label: L.zenAnchorThird },
  { v: 0.382, label: L.zenAnchorGolden },
  { v: 0.5, label: L.zenAnchorCenter }
]
const fogs: Array<{ v: 'fast' | 'mid' | 'slow'; label: string }> = [
  { v: 'fast', label: L.zenFogFast },
  { v: 'mid', label: L.zenFogMid },
  { v: 'slow', label: L.zenFogSlow }
]
const scrolls: Array<{ v: number; label: string }> = [
  { v: 0.16, label: L.zenScrollSnappy },
  { v: 0.1, label: L.zenScrollSmooth },
  { v: 0.06, label: L.zenScrollSilky }
]

/** 分段选择组的激活判断：浮点按容差比较，避免 1/3 存储误差导致高亮丢失 */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}
</script>

<template>
  <div class="overlay" :data-mode="previewMode" @click.self="emit('close')">
    <div class="panel glass" :data-mode="previewMode">
      <header class="panel__head">
        <h2 class="panel__title">{{ L.zenSettings }}</h2>
        <button class="panel__close" @click="emit('close')">×</button>
      </header>
      <p class="panel__sub">{{ L.zenSettingsSub }}</p>

      <div class="row">
        <div class="row__txt">
          <span class="row__label">{{ L.zenAnchor }}</span>
          <span class="row__hint">{{ L.zenAnchorHint }}</span>
        </div>
        <div class="seg">
          <button
            v-for="a in anchors"
            :key="a.v"
            type="button"
            :class="{ 'seg--on': near(props.prefs.anchor, a.v) }"
            @click="emit('change', { anchor: a.v })"
          >
            {{ a.label }}
          </button>
        </div>
      </div>

      <div class="row">
        <div class="row__txt">
          <span class="row__label">{{ L.zenFog }}</span>
          <span class="row__hint">{{ L.zenFogHint }}</span>
        </div>
        <div class="seg">
          <button
            v-for="f in fogs"
            :key="f.v"
            type="button"
            :class="{ 'seg--on': props.prefs.fog === f.v }"
            @click="emit('change', { fog: f.v })"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <div class="row">
        <div class="row__txt">
          <span class="row__label">{{ L.zenScroll }}</span>
          <span class="row__hint">{{ L.zenScrollHint }}</span>
        </div>
        <div class="seg">
          <button
            v-for="s in scrolls"
            :key="s.v"
            type="button"
            :class="{ 'seg--on': near(props.prefs.scroll, s.v) }"
            @click="emit('change', { scroll: s.v })"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <div class="row">
        <div class="row__txt">
          <span class="row__label">{{ L.zenFullscreen }}</span>
          <span class="row__hint">{{ L.zenFullscreenHint }}</span>
        </div>
        <button
          class="switch"
          type="button"
          :class="{ 'switch--on': props.prefs.fullscreen }"
          @click="emit('change', { fullscreen: !props.prefs.fullscreen })"
        />
      </div>

      <div class="row row--last">
        <div class="row__txt">
          <span class="row__label">{{ L.zenRetreatBar }}</span>
          <span class="row__hint">{{ L.zenRetreatBarHint }}</span>
        </div>
        <button
          class="switch"
          type="button"
          :class="{ 'switch--on': props.prefs.retreatBar }"
          @click="emit('change', { retreatBar: !props.prefs.retreatBar })"
        />
      </div>

      <button class="done" type="button" @click="emit('close')">{{ L.zenDone }}</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
}

.overlay[data-mode='light'] {
  background: rgba(30, 36, 38, 0.18);
}

.panel {
  width: 460px;
  max-width: calc(100vw - 32px);
  border-radius: 14px;
  padding: 18px 20px 16px;
  color: var(--hue-text-1);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.panel__close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.panel__close:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.panel__sub {
  margin: 2px 0 6px;
  font-size: 11.5px;
  color: var(--hue-text-3);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--hue-border-subtle);
}

.row--last {
  border-bottom: none;
}

.row__txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row__label {
  font-size: 13px;
  font-weight: 500;
}

.row__hint {
  font-size: 11px;
  line-height: 1.4;
  color: var(--hue-text-3);
}

.seg {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--hue-highlight);
  border: 1px solid var(--hue-border-subtle);
}

.seg button {
  border: none;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.seg button:hover {
  color: var(--hue-text-1);
}

.seg--on {
  background: rgba(var(--hue-tint-1), 0.2);
  color: var(--hue-accent) !important;
}

.switch {
  flex-shrink: 0;
  width: 34px;
  height: 19px;
  border: none;
  border-radius: 10px;
  background: var(--hue-border-subtle);
  position: relative;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--hue-text-2);
  transition: left var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}

.switch--on {
  background: var(--hue-accent);
}

.switch--on::after {
  left: 17px;
  background: var(--hue-on-accent);
}

.done {
  margin-top: 14px;
  width: 100%;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-size: 13px;
  cursor: pointer;
  transition: filter var(--dur-fast) var(--ease);
}

.done:hover {
  filter: brightness(1.08);
}
</style>
