<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { EditorMode } from '../editor/EditorHost.vue'

defineProps<{
  fileName: string
  mode: EditorMode
  dirty: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'save'): void
  (e: 'update:mode', value: EditorMode): void
}>()

const maximized = ref(false)
const isMac = window.api.platform === 'darwin'

function sync(): void {
  void window.api.isMaximized().then((v) => (maximized.value = v))
}

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
      <span v-if="dirty" class="bar__dot" title="未保存" />
    </div>

    <div class="bar__actions">
      <button class="act" @click="emit('open')">打开</button>
      <button class="act" @click="emit('save')">保存</button>

      <div class="seg">
        <button
          class="seg__item"
          :class="{ 'seg__item--on': mode === 'wysiwyg' }"
          @click="emit('update:mode', 'wysiwyg')"
        >
          所见即所得
        </button>
        <button
          class="seg__item"
          :class="{ 'seg__item--on': mode === 'source' }"
          @click="emit('update:mode', 'source')"
        >
          源码
        </button>
      </div>
    </div>

    <!-- macOS 用原生红绿灯，不渲染自绘按钮 -->
    <div v-if="!isMac" class="win">
      <button class="win__btn" title="最小化" @click="window.api.minimize()">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button class="win__btn" :title="maximized ? '向下还原' : '最大化'" @click="window.api.toggleMaximize()">
        <svg v-if="maximized" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3.2 1.4h5.4v5.4" stroke="currentColor" stroke-width="1" />
          <rect x="1.4" y="3.2" width="5.4" height="5.4" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="1.4" y="1.4" width="7.2" height="7.2" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button class="win__btn win__btn--close" title="关闭" @click="window.api.close()">
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
