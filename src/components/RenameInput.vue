<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{
  /** 进入编辑时的初始名称（含扩展名） */
  initial: string
}>()

const emit = defineEmits<{
  (e: 'confirm', value: string): void
  (e: 'cancel'): void
}>()

const value = ref(props.initial)
const el = ref<HTMLInputElement | null>(null)
let done = false

onMounted(() => {
  el.value?.focus()
  el.value?.select()
})

function finish(kind: 'confirm' | 'cancel'): void {
  if (done) return
  done = true
  if (kind === 'confirm') emit('confirm', value.value)
  else emit('cancel')
}

/** 回车确认：空名视为取消 */
function onEnter(): void {
  if (value.value.trim()) finish('confirm')
  else finish('cancel')
}

/** Esc 取消 */
function onEsc(): void {
  finish('cancel')
}

/** 失焦：有改动且非空则确认，否则取消 */
function onBlur(): void {
  if (done) return
  if (value.value.trim() && value.value !== props.initial) finish('confirm')
  else finish('cancel')
}
</script>

<template>
  <input
    ref="el"
    v-model="value"
    class="rename-input"
    type="text"
    spellcheck="false"
    @keydown.enter.prevent="onEnter"
    @keydown.esc.prevent="onEsc"
    @blur="onBlur"
    @click.stop
    @contextmenu.stop
  />
</template>

<style scoped>
.rename-input {
  flex: 1;
  min-width: 0;
  height: calc(var(--h-row) - 8px);
  padding: 0 6px;
  border: 1px solid var(--hue-accent);
  border-radius: var(--radius-sm);
  background: var(--hue-editor);
  color: var(--hue-text-1);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
}
</style>
