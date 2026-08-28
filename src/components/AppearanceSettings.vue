<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import {
  SKINS,
  loadAppearance,
  saveAppearance,
  applyAppearance,
  resolveMode,
  type SkinKey,
  type ModeKey
} from '../appearance'

const { t } = useI18n()
const L = t.ui
const emit = defineEmits<{ (e: 'close'): void }>()

const initial = loadAppearance()
const skin = ref<SkinKey>(initial.skin)
const mode = ref<ModeKey>(initial.mode)

/** 缩略图按当前实际模式预览，所见即所得 */
const previewMode = computed(() => resolveMode(mode.value))

function commit(): void {
  const next = { skin: skin.value, mode: mode.value }
  applyAppearance(next)
  saveAppearance(next)
}

function selectSkin(key: SkinKey): void {
  skin.value = key
  commit()
}

function selectMode(key: ModeKey): void {
  mode.value = key
  commit()
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel glass">
      <header class="panel__head">
        <h2 class="panel__title">{{ L.appearance }}</h2>
        <button class="panel__close" @click="emit('close')">{{ L.appearanceClose }}</button>
      </header>

      <section class="sec">
        <h3 class="sec__title">{{ L.skin }}</h3>
        <div class="skins">
          <button
            v-for="s in SKINS"
            :key="s.key"
            class="swatch jade"
            :class="{ 'swatch--on': skin === s.key }"
            :data-skin="s.key"
            :data-mode="previewMode"
            :title="L[s.labelKey]"
            @click="selectSkin(s.key)"
          >
            <span class="swatch__name">{{ L[s.labelKey] }}</span>
          </button>
        </div>
      </section>

      <section class="sec">
        <h3 class="sec__title">{{ L.theme }}</h3>
        <div class="seg">
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'dark' }"
            @click="selectMode('dark')"
          >
            {{ L.modeDark }}
          </button>
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'light' }"
            @click="selectMode('light')"
          >
            {{ L.modeLight }}
          </button>
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'system' }"
            @click="selectMode('system')"
          >
            {{ L.modeSystem }}
          </button>
        </div>
      </section>
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

.panel {
  width: 360px;
  max-width: calc(100vw - 32px);
  border-radius: 14px;
  padding: 18px 20px 22px;
  color: var(--hue-text-1);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
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

.sec {
  margin-top: 14px;
}

.sec__title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--hue-text-3);
  letter-spacing: 0.04em;
}

/* ── 皮肤缩略图：直接用真实玉质材质（.jade），不用品块 ── */
.skins {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.swatch {
  position: relative;
  height: 64px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  overflow: hidden;
  padding: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  transition: transform var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}

.swatch:hover {
  transform: translateY(-2px);
}

/* 选中环：用外层描边，避免覆盖材质 */
.swatch--on {
  box-shadow: inset 0 0 0 2px var(--hue-text-1), 0 0 0 2px var(--hue-accent);
}

.swatch__name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  letter-spacing: 0.04em;
  pointer-events: none;
}

/* ── 明暗分段 ── */
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--hue-highlight);
}

.seg__item {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 12px;
  padding: 6px 0;
  color: var(--hue-text-3);
  cursor: pointer;
  border-radius: 6px;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.seg__item--on {
  background: var(--hue-accent);
  color: var(--hue-editor);
  font-weight: 500;
}
</style>
