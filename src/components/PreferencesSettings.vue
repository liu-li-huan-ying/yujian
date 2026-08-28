<script setup lang="ts">
import { useI18n } from '../i18n'
import { loadAppearance, resolveMode } from '../appearance'
import type { StartupMode } from '../../electron/shared/ipc-channels'

const props = defineProps<{ value: StartupMode }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'change', mode: StartupMode): void
}>()

const { t } = useI18n()
const L = t.ui

// 面板按当前实际主题预览，与外观面板一致
const previewMode = resolveMode(loadAppearance().mode)

function pick(mode: StartupMode): void {
  if (mode !== props.value) emit('change', mode)
}
</script>

<template>
  <div class="overlay" :data-mode="previewMode" @click.self="emit('close')">
    <div class="panel glass" :data-mode="previewMode">
      <header class="panel__head">
        <h2 class="panel__title">{{ L.preferences }}</h2>
        <button class="panel__close" @click="emit('close')">{{ L.prefsClose }}</button>
      </header>

      <section class="sec">
        <h3 class="sec__title">{{ L.startupTitle }}</h3>
        <div class="opts">
          <button
            class="opt"
            type="button"
            :class="{ 'opt--on': value === 'restore' }"
            @click="pick('restore')"
          >
            <span class="opt__radio" />
            <span class="opt__txt">
              <span class="opt__label">{{ L.startupRestore }}</span>
              <span class="opt__desc">{{ L.startupRestoreDesc }}</span>
            </span>
          </button>

          <button
            class="opt"
            type="button"
            :class="{ 'opt--on': value === 'fresh' }"
            @click="pick('fresh')"
          >
            <span class="opt__radio" />
            <span class="opt__txt">
              <span class="opt__label">{{ L.startupFresh }}</span>
              <span class="opt__desc">{{ L.startupFreshDesc }}</span>
            </span>
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

.opts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opt {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  width: 100%;
  padding: 12px 13px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 10px;
  background: var(--hue-highlight);
  color: var(--hue-text-1);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}

.opt:hover {
  border-color: var(--hue-accent);
}

.opt--on {
  border-color: var(--hue-accent);
  background: rgba(var(--hue-tint-1), 0.16);
}

.opt__radio {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 50%;
  border: 2px solid var(--hue-border-strong, var(--hue-border-subtle));
  position: relative;
}

.opt--on .opt__radio {
  border-color: var(--hue-accent);
}

.opt--on .opt__radio::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--hue-accent);
}

.opt__txt {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.opt__label {
  font-size: 13px;
  font-weight: 500;
}

.opt__desc {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--hue-text-3);
}

/* 浅色模式：面板改用柔和浅色玻璃，与外观面板一致 */
.overlay[data-mode='light'] {
  background: rgba(30, 36, 38, 0.18);
}

.panel[data-mode='light'] {
  background: rgba(245, 248, 246, 0.9);
  border: 1px solid rgba(0, 0, 0, 0.07);
  backdrop-filter: blur(30px) saturate(115%);
  -webkit-backdrop-filter: blur(30px) saturate(115%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 16px 46px rgba(31, 41, 39, 0.16);
}
</style>
