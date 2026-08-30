<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import Icon from './Icon.vue'

const { t } = useI18n()
const L = t.ui
const H = t.help

const props = defineProps<{
  /** 初始标签页：shortcuts（快捷键）| guide（使用指南） */
  initial?: 'shortcuts' | 'guide'
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const tab = ref<'shortcuts' | 'guide'>(props.initial ?? 'shortcuts')

/** 浅色模式下切换为柔和浅色玻璃（与 AppearanceSettings 同款），避免深玻璃压在亮色界面上 */
const rootMode = ref(
  typeof document !== 'undefined'
    ? (document.documentElement.dataset.mode as 'light' | 'dark' | undefined)
    : undefined
)

/** 快捷键分组：键位写死（非本地化），描述为本地化文案 */
const groups = computed(() => [
  {
    title: H.scFile,
    items: [
      { keys: ['Ctrl', 'O'], desc: H.scOpen },
      { keys: ['Ctrl', 'S'], desc: H.scSave }
    ]
  },
  {
    title: H.scView,
    items: [
      { keys: ['Ctrl', '\\'], desc: H.scSidebar },
      { keys: ['Ctrl', 'Shift', '\\'], desc: H.scOutline },
      { keys: ['Ctrl', '/'], desc: H.scMode }
    ]
  },
  {
    title: H.scSearch,
    items: [{ keys: ['Ctrl', 'F'], desc: H.scFind }]
  },
  {
    title: H.scFocus,
    items: [{ keys: ['Esc'], desc: H.scFocusEsc }]
  },
  {
    title: H.scGeneral,
    items: [{ keys: ['F1'], desc: H.scHelp }]
  }
])
</script>

<template>
  <div class="overlay" :data-mode="rootMode" @click.self="emit('close')">
    <div class="panel glass" :data-mode="rootMode" role="dialog" aria-modal="true">
      <header class="panel__head">
        <h2 class="panel__title">{{ L.helpTitle }}</h2>
        <button class="panel__close" type="button" :title="H.close" @click="emit('close')">
          <Icon name="x" :size="16" />
        </button>
      </header>

      <!-- 标签页 -->
      <div class="tabs" role="tablist">
        <button
          class="tabs__item"
          :class="{ 'tabs__item--on': tab === 'shortcuts' }"
          role="tab"
          :aria-selected="tab === 'shortcuts'"
          @click="tab = 'shortcuts'"
        >
          {{ H.tabShortcuts }}
        </button>
        <button
          class="tabs__item"
          :class="{ 'tabs__item--on': tab === 'guide' }"
          role="tab"
          :aria-selected="tab === 'guide'"
          @click="tab = 'guide'"
        >
          {{ H.tabGuide }}
        </button>
      </div>

      <div class="hp__scroll">
        <!-- 快捷键 -->
        <div v-if="tab === 'shortcuts'" class="hp__body">
          <section v-for="g in groups" :key="g.title" class="scgrp">
            <h4 class="scgrp__title">{{ g.title }}</h4>
            <div v-for="it in g.items" :key="it.desc" class="scrow">
              <span class="scrow__desc">{{ it.desc }}</span>
              <span class="scrow__keys">
                <kbd v-for="k in it.keys" :key="k" class="kbd">{{ k }}</kbd>
              </span>
            </div>
          </section>
        </div>

        <!-- 使用指南 -->
        <div v-else class="hp__body">
          <h3 class="guide__title">{{ H.guideTitle }}</h3>
          <p class="guide__intro">{{ H.guideIntro }}</p>
          <section v-for="(s, i) in H.guideSections" :key="i" class="guide__sec">
            <h4 class="guide__h">{{ s.h }}</h4>
            <p class="guide__p">{{ s.p }}</p>
          </section>
          <section class="guide__sec">
            <h4 class="guide__h">{{ H.aboutTitle }}</h4>
            <p class="guide__about">{{ H.aboutBody }}</p>
          </section>
        </div>
      </div>
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
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  padding: 18px 20px 20px;
  color: var(--hue-text-1);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.panel__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.panel__close:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

/* ── 标签页 ── */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  padding: 3px;
  border-radius: 8px;
  background: var(--hue-highlight);
  border: 1px solid var(--hue-border-subtle);
}

.tabs__item {
  flex: 1;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  padding: 6px 0;
  color: var(--hue-text-3);
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.tabs__item--on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-weight: 500;
}

/* ── 内容滚动区 ── */
.hp__scroll {
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.hp__body {
  padding: 2px 2px 4px;
}

/* ── 快捷键 ── */
.scgrp {
  margin-bottom: 16px;
}

.scgrp__title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hue-text-3);
}

.scrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--hue-text-1);
}

.scrow:hover {
  background: var(--bg-hover);
}

.scrow__desc {
  flex: 1;
}

.scrow__keys {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--hue-surface-2);
  border: 1px solid var(--hue-border-subtle);
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 500;
  color: var(--hue-text-2);
  line-height: 1;
}

/* ── 使用指南 ── */
.guide__title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}

.guide__intro {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--hue-text-2);
}

.guide__sec {
  margin-bottom: 14px;
}

.guide__h {
  margin: 0 0 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-accent);
}

.guide__p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--hue-text-2);
}

.guide__about {
  white-space: pre-line;
  font-size: 12px;
  line-height: 1.8;
  color: var(--hue-text-3);
  font-family: var(--font-mono);
}

/* 浅色模式：遮罩层略调淡（玻璃材质本身由 .glass 统一提供） */
.overlay[data-mode='light'] {
  background: rgba(30, 36, 38, 0.18);
}
</style>
