<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MilkdownEditor from './MilkdownEditor.vue'
import SourceEditor from './SourceEditor.vue'
import { useFidelity } from './useFidelity'

export type EditorMode = 'wysiwyg' | 'source'

const props = defineProps<{
  filePath: string | null
  /** 外部请求切换模式（如标题栏按钮、快捷键） */
  requestedMode?: EditorMode
}>()

const emit = defineEmits<{
  (e: 'saved', path: string): void
  (e: 'mode-change', mode: EditorMode): void
}>()

const fidelity = useFidelity()
const mode = ref<EditorMode>('wysiwyg')
const milkdown = ref<InstanceType<typeof MilkdownEditor> | null>(null)
const saving = ref(false)
const ready = ref(false)

const AUTOSAVE_DELAY = 800
let timer: ReturnType<typeof setTimeout> | null = null

const dirty = computed(() => fidelity.isDirty.value)
const willNormalize = computed(() => fidelity.willNormalize.value)

/* ── 内容变更 ─────────────────────────────── */

/** 所见即所得模式下产生编辑事务 → 记录序列化结果并标记脏 */
function onWysiwygUpdate(markdown: string): void {
  fidelity.markEdited(markdown)
  scheduleSave()
}

/** 源码模式编辑 → 直接作为原文，不经过序列化 */
function onSourceUpdate(text: string): void {
  fidelity.onSourceEdited(text)
  scheduleSave()
}

/* ── 模式切换（不销毁 Crepe 实例）───────────── */

function switchTo(next: EditorMode): void {
  if (next === mode.value) return

  if (next === 'source') {
    milkdown.value?.setReadonly(true)
    mode.value = 'source'
  } else {
    // 灌入源码文本，恢复可编辑
    milkdown.value?.setMarkdown(fidelity.currentText.value)
    milkdown.value?.setReadonly(false)
    mode.value = 'wysiwyg'
  }
  emit('mode-change', mode.value)
}

watch(
  () => props.requestedMode,
  (next) => {
    if (next) switchTo(next)
  }
)

/* ── 保存 ─────────────────────────────────── */

function scheduleSave(): void {
  if (!props.filePath) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void save(), AUTOSAVE_DELAY)
}

async function save(): Promise<void> {
  if (!props.filePath || saving.value) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  saving.value = true
  try {
    await window.api.writeFile(props.filePath, fidelity.currentText.value)
    fidelity.afterSave()
    emit('saved', props.filePath)
  } finally {
    saving.value = false
  }
}

/** 从磁盘载入文档 */
async function load(path: string): Promise<void> {
  const text = await window.api.readFile(path)
  fidelity.loadFromDisk(text)
  milkdown.value?.setMarkdown(text)
}

function onReady(): void {
  ready.value = true
}

defineExpose({ save, load, switchTo, dirty, willNormalize, mode, ready })
</script>

<template>
  <div class="editor-host">
    <!-- 两个容器始终挂载，仅切换可见性，避免销毁 Crepe 实例 -->
    <div class="pane" :class="{ 'pane--hidden': mode !== 'wysiwyg' }">
      <MilkdownEditor
        ref="milkdown"
        :model-value="fidelity.currentText.value"
        @update:model-value="onWysiwygUpdate"
        @ready="onReady"
      />
    </div>

    <div class="pane" :class="{ 'pane--hidden': mode !== 'source' }">
      <SourceEditor
        :model-value="fidelity.currentText.value"
        @update:model-value="onSourceUpdate"
      />
    </div>
  </div>
</template>

<style scoped>
.editor-host {
  position: relative;
  flex: 1;
  min-height: 0;
}

.pane {
  position: absolute;
  inset: 0;
}

/* 用 visibility 而非 display：隐藏时 ProseMirror 仍保留布局，
   切回时光标与滚动位置不丢失 */
.pane--hidden {
  visibility: hidden;
  pointer-events: none;
}
</style>
