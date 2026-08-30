<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  /** 产物内容：HTML / PDF 为完整 HTML 文档字符串；LaTeX 为 .tex 源码 */
  content: string
  kind: 'html' | 'pdf' | 'latex'
  /** 默认文件名（仅展示，实际保存路径由系统对话框决定） */
  defaultName: string
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

/**
 * HTML / PDF 走 Blob URL 渲染真实排版；LaTeX 是源文件，直接以等宽文本呈现源码。
 * Blob 相比 srcdoc 没有长度上限顾虑（内联 base64 图片时产物可达数 MB）。
 */
const blobUrl = ref('')

function release(): void {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = ''
  }
}

watch(
  () => [props.content, props.kind],
  () => {
    release()
    if (props.kind === 'latex') return
    const blob = new Blob([props.content], { type: 'text/html;charset=utf-8' })
    blobUrl.value = URL.createObjectURL(blob)
  },
  { immediate: true }
)

const isSource = computed(() => props.kind === 'latex')
const kindLabel = computed(() =>
  props.kind === 'html' ? L.exportHtml : props.kind === 'pdf' ? L.exportPdf : L.exportLatex
)

// Esc 关闭：与既有浮层一致的轻退出
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('cancel')
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  release()
})
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="panel glass" role="dialog" :aria-label="L.exportPreviewTitle">
      <div class="panel__head">
        <Icon name="display" :size="15" class="panel__icon" />
        <span class="panel__title">{{ L.exportPreviewTitle }}</span>
        <span class="panel__tag">{{ kindLabel }}</span>
        <button
          class="panel__x"
          type="button"
          :title="L.exportPreviewCancel"
          @click="emit('cancel')"
        >
          <Icon name="x" :size="14" />
        </button>
      </div>

      <div class="panel__body">
        <pre v-if="isSource" class="src">{{ content }}</pre>
        <iframe
          v-else-if="blobUrl"
          class="frame"
          :src="blobUrl"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
        />
      </div>

      <div class="panel__foot">
        <span class="panel__name" :title="defaultName">{{ defaultName }}</span>
        <div class="panel__acts">
          <button class="btn" type="button" @click="emit('cancel')">
            {{ L.exportPreviewCancel }}
          </button>
          <button class="btn btn--primary" type="button" @click="emit('confirm')">
            <Icon name="download" :size="14" />
            {{ L.exportPreviewConfirm }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.38);
  animation: ep-fade 0.16s ease both;
}

.panel {
  width: 880px;
  max-width: calc(100vw - 48px);
  height: 84vh;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-lg, 14px);
  animation: ep-in 0.18s ease both;
}

.panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.panel__icon {
  color: var(--hue-accent, #248077);
}
.panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.panel__tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--hue-accent, #248077);
  background: var(--hue-active, rgba(95, 168, 160, 0.16));
}
.panel__x {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.panel__x:hover {
  background: var(--hue-hover, rgba(0, 0, 0, 0.06));
  color: var(--text-primary);
}

/* 预览区：纸白底，与导出产物的阅读型配色一致 */
.panel__body {
  flex: 1;
  min-height: 0;
  border-radius: 10px;
  overflow: hidden;
  background: #fcfcfb;
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.08));
}
.frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fcfcfb;
}
.src {
  margin: 0;
  height: 100%;
  overflow: auto;
  padding: 14px 16px;
  font-family: var(--font-mono, ui-monospace, 'Sarasa Mono SC', Consolas, monospace);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.panel__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.panel__name {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel__acts {
  display: flex;
  gap: 8px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.1));
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.btn:hover {
  background: var(--hue-hover, rgba(0, 0, 0, 0.05));
}
.btn--primary {
  border-color: transparent;
  background: var(--hue-accent, #248077);
  color: var(--hue-on-accent, #fff);
}
.btn--primary:hover {
  filter: brightness(1.06);
  background: var(--hue-accent, #248077);
}

@keyframes ep-fade {
  from {
    opacity: 0;
  }
}
@keyframes ep-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}
</style>
