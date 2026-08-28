<script setup lang="ts">
defineProps<{
  /** 加载状态：idle 隐藏；loading 顶栏进度；error/timeout 错误提示卡 */
  status: 'idle' | 'loading' | 'error' | 'timeout'
  /** 错误 / 超时时的说明文字 */
  message?: string
}>()

const emit = defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <div v-if="status !== 'idle'" class="loadbar" :class="`loadbar--${status}`">
    <!-- 顶栏 indeterminate 进度条：覆盖两种模式的加载/渲染 -->
    <div v-if="status === 'loading'" class="loadbar__track" role="progressbar" aria-label="加载中">
      <div class="loadbar__fill" />
    </div>

    <!-- 失败 / 超时：玻璃提示卡，带重试 -->
    <div v-else class="loadbar__panel glass" role="alert">
      <svg class="loadbar__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 1.4 15 14H1z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <path d="M8 6v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        <circle cx="8" cy="11.4" r="0.85" fill="currentColor" />
      </svg>
      <span class="loadbar__msg">{{ message }}</span>
      <button class="loadbar__retry" type="button" @click="emit('retry')">重试</button>
    </div>
  </div>
</template>

<style scoped>
.loadbar {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 30;
  pointer-events: none;
}

/* ── 顶栏 indeterminate 进度条 ── */
.loadbar__track {
  height: 2px;
  background: var(--hue-border-subtle);
  overflow: hidden;
}

.loadbar__fill {
  height: 100%;
  width: 40%;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--hue-accent) 50%,
    transparent 100%
  );
  animation: load-slide 1.1s var(--ease) infinite;
}

@keyframes load-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

/* ── 错误 / 超时提示卡 ── */
.loadbar__panel {
  pointer-events: auto;
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(440px, calc(100% - 28px));
  padding: 9px 10px 9px 12px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--hue-text-1);
}

.loadbar__icon {
  flex: 0 0 16px;
  color: var(--hue-danger);
}

.loadbar__msg {
  flex: 1;
  min-width: 0;
  line-height: 1.5;
  color: var(--hue-text-2);
}

.loadbar__retry {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--hue-active);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.loadbar__retry:hover {
  background: rgba(var(--hue-tint-1), 0.24);
  border-color: var(--hue-accent);
}

.loadbar__retry:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: 1px;
}

/* 尊重系统减弱动效偏好：进度条不再滑动，改为呼吸式透明度 */
@media (prefers-reduced-motion: reduce) {
  .loadbar__fill {
    width: 100%;
    animation: none;
    opacity: 0.7;
  }
}
</style>
