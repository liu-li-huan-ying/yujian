<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MilkdownEditor from './MilkdownEditor.vue'
import SourceEditor from './SourceEditor.vue'
import LoadingBar from '../components/LoadingBar.vue'
import ReadingProgress from '../components/ReadingProgress.vue'
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

/** 两个面板的 DOM 根，交给 ReadingProgress 自动定位真正的滚动容器 */
const wysiwygPane = ref<HTMLDivElement | null>(null)
const sourcePane = ref<HTMLDivElement | null>(null)
const activePane = computed(() =>
  mode.value === 'wysiwyg' ? wysiwygPane.value : sourcePane.value
)

/** 加载状态机：覆盖首次加载 / 切换文件 / 重新渲染（切回所见即所得） */
type LoadStatus = 'idle' | 'loading' | 'error' | 'timeout'
const loadStatus = ref<LoadStatus>('idle')
const loadMessage = ref('')
const loadPath = ref<string | null>(null)

/** 超过该时长仍未完成 → 判定超时，给出重试入口 */
const LOAD_TIMEOUT_MS = 10_000
let loadTimer: ReturnType<typeof setTimeout> | null = null

const AUTOSAVE_DELAY = 800
let timer: ReturnType<typeof setTimeout> | null = null

const dirty = computed(() => fidelity.isDirty.value)
const willNormalize = computed(() => fidelity.willNormalize.value)

/* ── 加载状态 ─────────────────────────────── */

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function startLoading(): void {
  if (loadTimer) clearTimeout(loadTimer)
  loadStatus.value = 'loading'
  loadMessage.value = ''
  loadTimer = setTimeout(() => {
    if (loadStatus.value === 'loading') {
      loadStatus.value = 'timeout'
      loadMessage.value = '加载超时，请检查文件后重试。'
    }
  }, LOAD_TIMEOUT_MS)
}

function stopLoading(): void {
  if (loadTimer) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
  loadStatus.value = 'idle'
  loadMessage.value = ''
}

function failLoading(msg: string): void {
  if (loadTimer) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
  loadStatus.value = 'error'
  loadMessage.value = msg
}

/** 重试：重新载入当前文档（失败/超时共用，重载即覆盖「重新渲染」场景） */
function onRetry(): void {
  if (loadPath.value) void load(loadPath.value)
}

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
    // 灌入源码文本并重新渲染：这一步对大文档有真实耗时，用进度条覆盖
    startLoading()
    try {
      milkdown.value?.setMarkdown(fidelity.currentText.value)
      milkdown.value?.setReadonly(false)
      mode.value = 'wysiwyg'
      // 让进度条至少绘制一帧再收起，保证「重新渲染」可见
      requestAnimationFrame(() => {
        if (loadStatus.value === 'loading') stopLoading()
      })
    } catch (e) {
      failLoading(`渲染失败：${errMsg(e)}`)
      return
    }
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
  loadPath.value = path
  startLoading()
  try {
    const text = await window.api.readFile(path)
    fidelity.loadFromDisk(text)
    milkdown.value?.setMarkdown(text)
    stopLoading()
  } catch (e) {
    failLoading(`无法载入文件：${errMsg(e)}`)
  }
}

function onReady(): void {
  ready.value = true
}

defineExpose({
  save,
  load,
  switchTo,
  dirty,
  willNormalize,
  mode,
  ready,
  loadStatus
})
</script>

<template>
  <div class="editor-host">
    <!-- 加载 / 渲染进度条：两种模式共用，覆盖首次加载、切换文件、重新渲染 -->
    <LoadingBar
      :status="loadStatus"
      :message="loadMessage"
      @retry="onRetry"
    />

    <!-- 两个容器始终挂载，仅切换可见性，避免销毁 Crepe 实例 -->
    <div ref="wysiwygPane" class="pane" :class="{ 'pane--hidden': mode !== 'wysiwyg' }">
      <MilkdownEditor
        ref="milkdown"
        :model-value="fidelity.currentText.value"
        @update:model-value="onWysiwygUpdate"
        @ready="onReady"
      />
    </div>

    <div ref="sourcePane" class="pane" :class="{ 'pane--hidden': mode !== 'source' }">
      <SourceEditor
        :model-value="fidelity.currentText.value"
        @update:model-value="onSourceUpdate"
      />
    </div>

    <!-- 右侧竖向阅读进度条：与玉质/玻璃风格统一，可点击/拖拽跳转 -->
    <ReadingProgress :pane="activePane" />
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
