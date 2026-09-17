<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../composables/useFocusTrap'

const { t } = useI18n()
const L = t.ui

const box = ref<HTMLElement | null>(null)
// 焦点陷阱：打开时把焦点送进对话框、Tab 只在本框内循环、关闭时归还给触发者。
// 首个可聚焦元素是「取消」（模板里排在确认之前）—— 对删除类对话框这是更安全的默认。
useFocusTrap({ container: box, active: () => props.open })

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作（删除）：确认按钮用警示色 */
  danger?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function onKey(e: KeyboardEvent): void {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  } else if (e.key === 'Enter') {
    // 焦点若已经落在某个按钮上，交给按钮自己处理 —— 否则 Tab 到「取消」再按 Enter 会
    // 同时触发按钮的 click（取消）与本监听（确认），结果是「想取消却确认了」。
    // 删除类操作不可撤销，这一处必须以按钮的实际焦点为准。
    const el = e.target as HTMLElement | null
    if (el && el.tagName === 'BUTTON') return
    e.preventDefault()
    emit('confirm')
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="open" class="modal-mask" @mousedown.self="emit('cancel')">
    <div ref="box" class="modal glass" role="alertdialog" aria-modal="true" :aria-label="title">
      <h3 class="modal__title">{{ title }}</h3>
      <p class="modal__msg">{{ message }}</p>
      <div class="modal__acts">
        <button class="btn" type="button" @click="emit('cancel')">
          {{ cancelLabel ?? L.dialogCancel }}
        </button>
        <button
          class="btn"
          :class="danger ? 'btn--danger' : 'btn--primary'"
          type="button"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? L.dialogConfirm }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}

.modal {
  width: 320px;
  max-width: calc(100% - 40px);
  padding: 18px 18px 14px;
  border-radius: var(--radius-lg);
}

.modal__title {
  margin: 0 0 8px;
  font-size: var(--fs-14);
  font-weight: 600;
  color: var(--hue-text-1);
}

.modal__msg {
  margin: 0 0 16px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--hue-text-2);
  word-break: break-all;
}

.modal__acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.btn:hover {
  background: var(--bg-hover);
}

.btn:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: 1px;
}

.btn--primary {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
  color: var(--hue-on-accent);
}

.btn--primary:hover {
  filter: brightness(1.06);
  background: var(--hue-accent);
}

.btn--danger {
  background: var(--hue-danger);
  border-color: var(--hue-danger);
  color: var(--hue-on-accent);
}

.btn--danger:hover {
  filter: brightness(1.06);
  background: var(--hue-danger);
}
</style>
