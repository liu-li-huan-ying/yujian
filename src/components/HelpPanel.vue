<script setup lang="ts">
/**
 * 帮助面板：使用指南 + 关于。
 *
 * 原「快捷键」标签页已移除 —— 那里是一份手抄的键位表，键位可自定义后它必然过期，
 * 且与「快捷键设置」面板重复。键位的唯一真相现在只在 `src/shortcuts.ts`，
 * 展示也统一在 `ShortcutsSettings.vue`（F1 直达）。
 */
import { ref } from 'vue'
import { useI18n } from '../i18n'
import Icon from './Icon.vue'

const { t } = useI18n()
const L = t.ui
const H = t.help

defineProps<{
  /** 应用版本号（来自主进程，动态显示，避免硬编码过时版本） */
  version?: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

/** 浅色模式下切换为柔和浅色玻璃（与 AppearanceSettings 同款），避免深玻璃压在亮色界面上 */
const rootMode = ref(
  typeof document !== 'undefined'
    ? (document.documentElement.dataset.mode as 'light' | 'dark' | undefined)
    : undefined
)
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

      <div class="hp__scroll">
        <div class="hp__body">
          <h3 class="guide__title">{{ H.guideTitle }}</h3>
          <p class="guide__intro">{{ H.guideIntro }}</p>
          <section v-for="(s, i) in H.guideSections" :key="i" class="guide__sec">
            <h4 class="guide__h">{{ s.h }}</h4>
            <p class="guide__p">{{ s.p }}</p>
          </section>
          <section class="guide__sec">
            <h4 class="guide__h">{{ H.aboutTitle }}</h4>
            <p class="guide__about">{{ H.aboutBody }}</p>
            <p class="guide__about">{{ H.aboutVersion }} {{ version }}</p>
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
  z-index: var(--z-overlay);
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
  border-radius: var(--radius-xl);
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
  font-size: var(--fs-15);
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
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.panel__close:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
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

/* ── 使用指南 ── */
.guide__title {
  margin: 0 0 8px;
  font-size: var(--fs-14);
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
  font-size: var(--fs-13);
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
  font-size: var(--fs-12);
  line-height: 1.8;
  color: var(--hue-text-3);
  font-family: var(--font-mono);
}

/* 浅色模式：遮罩层略调淡（玻璃材质本身由 .glass 统一提供） */
.overlay[data-mode='light'] {
  background: rgba(30, 36, 38, 0.18);
}
</style>
