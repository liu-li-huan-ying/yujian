<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { EditorMode } from '../editor/EditorHost.vue'
import { i18n } from '../i18n'

defineProps<{
  fileName: string
  mode: EditorMode
  dirty: boolean
  /** 是否已有打开的文档，决定是否允许导出 */
  canExport: boolean
  /** 左侧笔记库面板是否可见（控制开关按钮激活态） */
  sidebarVisible: boolean
  /** 右侧大纲面板是否可见（控制开关按钮激活态） */
  outlineVisible: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'save'): void
  (e: 'update:mode', value: EditorMode): void
  (e: 'export-html'): void
  (e: 'export-pdf'): void
  (e: 'img-host'): void
  (e: 'appearance'): void
  (e: 'switch-vault'): void
  (e: 'preferences'): void
  (e: 'toggle-sidebar'): void
  (e: 'toggle-outline'): void
}>()

const L = i18n.ui
const maximized = ref(false)
const isMac = window.api.platform === 'darwin'

function sync(): void {
  void window.api.isMaximized().then((v) => (maximized.value = v))
}

/* 模板不直接引用全局对象：包一层具名函数，类型可推断、职责也更清晰 */
const minimize = (): void => window.api.minimize()
const toggleMaximize = (): void => window.api.toggleMaximize()
const close = (): void => window.api.close()

onMounted(() => {
  sync()
  window.api.onWindowStateChange((state) => (maximized.value = state.maximized))
})

onBeforeUnmount(() => {
  // preload 未提供移除监听的接口：窗口生命周期内标题栏常驻，无需解绑
})
</script>

<template>
  <header class="bar jade" :class="{ 'bar--mac': isMac }">
    <!-- 拖拽区：整条标题栏可拖动窗口 -->
    <div class="bar__drag">
      <span class="bar__name">{{ fileName }}</span>
      <span v-if="dirty" class="bar__dot" :title="L.statusUnsaved" />
    </div>

    <div class="bar__actions">
      <button class="act" @click="emit('open')">{{ L.open }}</button>
      <button class="act" @click="emit('save')">{{ L.save }}</button>
      <button class="act" @click="emit('switch-vault')">{{ L.switchVault }}</button>

      <span class="divider" />

      <button
        class="act"
        :disabled="!canExport"
        @click="emit('export-html')"
      >
        {{ L.exportHtml }}
      </button>
      <button
        class="act"
        :disabled="!canExport"
        @click="emit('export-pdf')"
      >
        {{ L.exportPdf }}
      </button>

      <span class="divider" />

      <button class="act" @click="emit('img-host')">
        {{ L.imgHost }}
      </button>

      <button class="act" @click="emit('appearance')" :title="L.appearance">
        {{ L.appearance }}
      </button>

      <button class="act" @click="emit('preferences')" :title="L.preferences">
        {{ L.preferences }}
      </button>

      <span class="divider" />

      <button
        class="act"
        :class="{ 'act--on': sidebarVisible }"
        :title="L.toggleSidebarTitle"
        @click="emit('toggle-sidebar')"
      >
        {{ L.sidebar }}
      </button>
      <button
        class="act"
        :class="{ 'act--on': outlineVisible }"
        :title="L.toggleOutlineTitle"
        @click="emit('toggle-outline')"
      >
        {{ L.outline }}
      </button>

      <div class="seg">
        <button
          class="seg__item"
          :class="{ 'seg__item--on': mode === 'wysiwyg' }"
          @click="emit('update:mode', 'wysiwyg')"
        >
          {{ L.modeWysiwyg }}
        </button>
        <button
          class="seg__item"
          :class="{ 'seg__item--on': mode === 'source' }"
          @click="emit('update:mode', 'source')"
        >
          {{ L.modeSource }}
        </button>
      </div>
    </div>

    <!-- macOS 用原生红绿灯，不渲染自绘按钮 -->
    <div v-if="!isMac" class="win">
      <button class="win__btn" title="最小化" @click="minimize()">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button class="win__btn" :title="maximized ? '向下还原' : '最大化'" @click="toggleMaximize()">
        <svg v-if="maximized" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3.2 1.4h5.4v5.4" stroke="currentColor" stroke-width="1" />
          <rect x="1.4" y="3.2" width="5.4" height="5.4" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="1.4" y="1.4" width="7.2" height="7.2" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button class="win__btn win__btn--close" title="关闭" @click="close()">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.4 1.4l7.2 7.2M8.6 1.4l-7.2 7.2"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.bar {
  height: var(--h-titlebar);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--hue-border-subtle);
  user-select: none;
}

/* macOS 原生红绿灯在左上角，内容需让位 */
.bar--mac {
  padding-left: 78px;
}

/* 可拖拽区域：撑满剩余空间，把操作按钮挤到右侧 */
.bar__drag {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding-left: 14px;
  -webkit-app-region: drag;
}

.bar__name {
  font-size: 13px;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hue-accent);
  flex-shrink: 0;
}

.bar__actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 4px;
  -webkit-app-region: no-drag;
}

.act {
  font-size: 11px;
  padding: 4px 10px;
  color: var(--hue-text-3);
  border: 0;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.act:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

/* 面板开关激活态：accent 文字 + 玉质高亮底，呼应分段控件的「开」语义 */
.act--on {
  color: var(--hue-accent);
  background: var(--hue-active);
}

.act--on:hover {
  color: var(--hue-accent);
  background: var(--hue-active);
  filter: brightness(1.05);
}

.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.divider {
  width: 1px;
  height: 16px;
  background: var(--hue-border-subtle);
  margin: 0 2px;
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: 7px;
  background: var(--hue-highlight);
}

.seg__item {
  border: none;
  background: transparent;
  font-size: 11px;
  padding: 3px 10px;
  color: var(--hue-text-3);
}

.seg__item--on {
  background: var(--hue-accent);
  color: var(--hue-editor);
  font-weight: 500;
}

/* ── 自绘窗口控制按钮 ── */
.win {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.win__btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--hue-text-2);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.win__btn:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.win__btn--close:hover {
  background: #e04f45;
  color: #ffffff;
}

.win__btn:focus-visible {
  outline-offset: -2px;
}
</style>
