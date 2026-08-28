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
  /** 当前笔记库根：无文档时决定图片落盘位置 */
  vaultPath?: string | null
  /** 外部请求切换模式（如标题栏按钮、快捷键） */
  requestedMode?: EditorMode
  /** 语言版本号：变化时 Vue 重挂 MilkdownEditor 使新语言标签生效 */
  langKey?: number
}>()

const emit = defineEmits<{
  (e: 'saved', path: string): void
  (e: 'mode-change', mode: EditorMode): void
}>()

const fidelity = useFidelity()
const mode = ref<EditorMode>('wysiwyg')
const milkdown = ref<InstanceType<typeof MilkdownEditor> | null>(null)
const source = ref<InstanceType<typeof SourceEditor> | null>(null)
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
  // 语言切换导致重挂后，新实例默认 readonly=false；
  // 若当前在源码模式，需立即恢复只读（避免用户误编辑所见即所得实例）
  if (mode.value === 'source') {
    milkdown.value?.setReadonly(true)
  }
}

/** 全文搜索结果点击：跳转到命中行（仅源码模式可精确定位） */
function revealLine(line: number): void {
  if (mode.value !== 'source') return
  source.value?.revealLine(line)
}

/**
 * 取当前文档的渲染 HTML（用于导出）。
 * 源码模式下渲染器 DOM 落后于编辑，先灌入当前源码文本再读，
 * 且不切换可见模式、不触发保存态变化（内容本就等于原文）。
 */
async function getHTML(): Promise<string> {
  if (mode.value === 'source') {
    await milkdown.value?.setMarkdown(fidelity.currentText.value)
  }
  return (await milkdown.value?.getHTML()) ?? ''
}

/**
 * 上传文档内全部本地图片到图床，并把引用改写为远程 URL。
 * 密钥只在主进程；这里只拿到改写后的 Markdown，应用到保真层后重渲染并保存。
 */
async function publishImages(): Promise<{
  ok: boolean
  noImages?: boolean
  uploaded: number
  failed: number
  error?: string
}> {
  if (!props.filePath) {
    return { ok: false, uploaded: 0, failed: 0, error: '请先保存文档后再上传图片' }
  }
  const text = fidelity.currentText.value
  const res = await window.api.publishImages(text, props.filePath)
  if (!res.ok) {
    return { ok: false, uploaded: res.uploaded, failed: res.failed, error: res.error }
  }
  if (res.noImages) {
    return { ok: true, noImages: true, uploaded: 0, failed: 0 }
  }
  if (res.markdown == null) {
    return { ok: false, uploaded: res.uploaded, failed: res.failed, error: '改写结果缺失' }
  }
  // 应用到保真层：远程 URL 成为新真源，标记脏以触发自动保存
  fidelity.applyExternal(res.markdown)
  if (mode.value === 'wysiwyg') {
    await milkdown.value?.setMarkdown(res.markdown)
  }
  scheduleSave()
  return { ok: true, uploaded: res.uploaded, failed: res.failed }
}

defineExpose({
  save,
  load,
  switchTo,
  revealLine,
  getHTML,
  publishImages,
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
        :key="props.langKey ?? 0"
        ref="milkdown"
        :model-value="fidelity.currentText.value"
        :file-path="props.filePath"
        :vault-path="props.vaultPath"
        @update:model-value="onWysiwygUpdate"
        @ready="onReady"
      />
    </div>

    <div ref="sourcePane" class="pane" :class="{ 'pane--hidden': mode !== 'source' }">
      <SourceEditor
        ref="source"
        :model-value="fidelity.currentText.value"
        :file-path="props.filePath"
        :vault-path="props.vaultPath"
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
