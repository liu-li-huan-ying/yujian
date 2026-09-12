<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useI18n } from '../i18n'
import { loadAppearance, resolveMode } from '../appearance'
import {
  loadTypography,
  saveTypography,
  applyTypography,
  type TypographyState
} from '../typography'
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

/* ── 中文排版（批次四）：纯渲染层开关，改动即生效并持久化 ── */
type SubKey = 'space' | 'emphasis' | 'punct' | 'paraGap'
const typo = reactive<TypographyState>(loadTypography())
const subRows = computed<{ key: SubKey; label: string; desc: string }[]>(() => [
  { key: 'space', label: L.cjkSpace, desc: L.cjkSpaceDesc },
  { key: 'emphasis', label: L.cjkEmphasis, desc: L.cjkEmphasisDesc },
  { key: 'punct', label: L.cjkPunct, desc: L.cjkPunctDesc },
  { key: 'paraGap', label: L.cjkGap, desc: L.cjkGapDesc }
])

function commitTypo(): void {
  applyTypography(typo)
  saveTypography({ ...typo })
}

function toggle(key: keyof TypographyState): void {
  typo[key] = !typo[key]
  commitTypo()
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

      <section class="sec">
        <h3 class="sec__title">{{ L.cjkTitle }}</h3>
        <div class="opts">
          <button
            class="opt"
            type="button"
            :class="{ 'opt--on': typo.enabled }"
            @click="toggle('enabled')"
          >
            <span class="switch" :class="{ 'switch--on': typo.enabled }" />
            <span class="opt__txt">
              <span class="opt__label">{{ L.cjkEnabled }}</span>
              <span class="opt__desc">{{ L.cjkEnabledDesc }}</span>
            </span>
          </button>
        </div>

        <div class="subopts" :class="{ 'subopts--off': !typo.enabled }">
          <button
            v-for="r in subRows"
            :key="r.key"
            class="subopt"
            type="button"
            :class="{ 'subopt--on': typo[r.key] }"
            :disabled="!typo.enabled"
            @click="toggle(r.key)"
          >
            <span class="subopt__box" :class="{ 'subopt__box--on': typo[r.key] }" />
            <span class="opt__txt">
              <span class="opt__label">{{ r.label }}</span>
              <span class="opt__desc">{{ r.desc }}</span>
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

/* ── 开关（总开关用）：胶囊底 + 圆钮，与 .opt 行同款描边 ── */
.switch {
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: 17px;
  margin-top: 2px;
  border-radius: 9px;
  background: var(--hue-highlight);
  box-shadow: inset 0 0 0 1px var(--hue-border-subtle);
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--hue-text-2);
  transition: transform var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}

.switch--on {
  background: var(--hue-accent);
  box-shadow: inset 0 0 0 1px var(--hue-accent);
}

.switch--on::after {
  transform: translateX(13px);
  background: var(--hue-editor);
}

/* ── 子项：缩进、更轻量，总开关关闭时整体弱化且不可点 ── */
.subopts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--hue-border-subtle);
  transition: opacity var(--dur-fast) var(--ease);
}

.subopts--off {
  opacity: 0.4;
}

.subopt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--hue-text-1);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}

.subopt:hover:not(:disabled) {
  background: var(--hue-highlight);
}

.subopt:disabled {
  cursor: not-allowed;
}

.subopt__box {
  position: relative;
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px var(--hue-border-strong, var(--hue-border-subtle));
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}

.subopt__box--on {
  background: var(--hue-accent);
  box-shadow: inset 0 0 0 1px var(--hue-accent);
}

.subopt__box--on::after {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 1.5px;
  width: 4px;
  height: 8px;
  border: solid var(--hue-editor);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* 浅色模式：面板改用柔和浅色玻璃，与外观面板一致 */
.overlay[data-mode='light'] {
  background: rgba(30, 36, 38, 0.18);
}

.panel[data-mode='light'] {
  /* 玻璃材质与描边由全局 .glass 统一提供，此处无需重复定义 */
}
</style>
