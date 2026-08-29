<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import MilkdownEditor from './MilkdownEditor.vue'
import SourceEditor from './SourceEditor.vue'
import LoadingBar from '../components/LoadingBar.vue'
import ReadingProgress from '../components/ReadingProgress.vue'
import { useFidelity } from './useFidelity'
import { parseOutline, type OutlineItem } from './outline'
import {
  findInView,
  gotoInView,
  replaceOneInView,
  replaceAllInView,
  clearFindInView,
  type FindOptions
} from './find-source'
import {
  findMatchesInDoc,
  selectMatch,
  replaceMatch,
  replaceAllInDoc,
  type WysiwygMatch
} from './find-wysiwyg'
import { setZenActive, centerZenLine } from './zen'
import { computeStats } from '../utils/text-stats'
import type { TextStats } from '../utils/text-stats'

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

/** 切换语言/模式时保存并恢复所见即所得滚动位置（避免切走后回顶） */
const wysiwygScroll = ref(0)

function wysiwygEl(): HTMLElement | null {
  return wysiwygPane.value?.querySelector('.milkdown') as HTMLElement | null
}

/** 当前所见即所得视口中心的文档纵向进度（0~1），用于切到源码时按比例对齐 */
function wysiwygRatio(): number {
  const el = wysiwygEl()
  if (!el || el.scrollHeight <= 0) return 0
  return (el.scrollTop + el.clientHeight * 0.5) / el.scrollHeight
}

/** 保存当前滚动位置（语言切换前由父组件调用；切模式时内部调用） */
function captureScroll(): void {
  wysiwygScroll.value = wysiwygEl()?.scrollTop ?? 0
}

/** 把保存的位置恢复到所见即所得滚动容器（重挂/重渲染后调用） */
function restoreScroll(): void {
  const el = wysiwygEl()
  if (el) el.scrollTop = wysiwygScroll.value
}

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

/* ── 写作统计（批次二）────────────────────────── */

/** 实时统计当前文档：汉字 / 词 / 字符 / 阅读时长，状态栏与弹层共用 */
const stats = computed<TextStats>(() => computeStats(fidelity.currentText.value))

/* ── 凝神模式（打字机 + 禅 融合，批次二）────────── */

const zenActive = ref(false)

/**
 * 切换凝神模式。开关写入模块级状态后，向 PM 视图 dispatch 一个空事务触发
 * decoration 重算（apply 读模块标志重建 .zen-active/.zen-dim）；开启时立即居中当前行。
 * 空事务不改文档内容，不会触发 markdownUpdated → 不会误标脏/误存。
 */
function setZen(value: boolean): void {
  if (zenActive.value === value) return
  zenActive.value = value
  setZenActive(value)
  const v = milkdownView()
  if (v) {
    v.dispatch(v.state.tr)
    if (value) centerZenLine(v)
  }
  // 源码模式下同时居中当前行（淡化仅在所见即所得生效）
  if (value && mode.value === 'source') source.value?.centerActiveLine()
}

/** 取当前文档 Markdown 文本（快照创建 / diff 预览用） */
function getMarkdown(): string {
  return fidelity.currentText.value
}

/**
 * 把外部文本灌入编辑器并标脏（快照恢复用）。所见即所得重渲染；源码模式下靠
 * modelValue 绑定自动同步。随后自动保存把原文写回磁盘（内容本就来自快照原文，保真不丢失）。
 */
function loadMarkdownExternal(text: string): void {
  fidelity.applyExternal(text)
  if (mode.value === 'wysiwyg') milkdown.value?.setMarkdown(text)
  scheduleSave()
}

/* ── 文档大纲 ─────────────────────────────── */

const outline = computed<OutlineItem[]>(() => parseOutline(fidelity.currentText.value))

/** 当前阅读位置对应的章节序号（-1 表示文档顶部/无标题） */
const activeHeadingIndex = ref(-1)
let activeRaf = 0
let lastActiveAt = 0

/**
 * 依据当前视口顶部的章节高亮大纲。
 * 所见即所得：取 `.milkdown` 内真实 h1~h6 的 DOM 位置；
 * 源码：用 CodeMirror 首行可见行比对标题行号。
 * 节流 100ms（设计稿要求）。
 */
function computeActiveHeading(force = false): void {
  const now = Date.now()
  if (!force && now - lastActiveAt < 100) return
  lastActiveAt = now

  const items = outline.value
  if (items.length === 0) {
    activeHeadingIndex.value = -1
    return
  }

  if (mode.value === 'wysiwyg') {
    const el = wysiwygEl()
    if (!el) return
    const heads = el.querySelectorAll('h1,h2,h3,h4,h5,h6')
    const top = el.getBoundingClientRect().top + 12
    let idx = -1
    heads.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= top) idx = i
    })
    activeHeadingIndex.value = idx
  } else {
    const line = source.value?.getFirstVisibleLine() ?? 1
    let idx = -1
    for (let i = 0; i < items.length; i++) {
      if (items[i].line <= line) idx = i
    }
    activeHeadingIndex.value = idx
  }
}

function onPaneScroll(): void {
  if (activeRaf) return
  activeRaf = requestAnimationFrame(() => {
    activeRaf = 0
    computeActiveHeading()
  })
}

/** 点击大纲项跳转：源码模式定位到行，所见即所得模式平滑滚动到对应标题 */
function gotoOutline(index: number): void {
  const item = outline.value[index]
  if (!item) return
  if (mode.value === 'source') {
    source.value?.revealLine(item.line)
    return
  }
  const el = wysiwygEl()
  const heads = el?.querySelectorAll('h1,h2,h3,h4,h5,h6')
  const target = heads?.[index] as HTMLElement | undefined
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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
    // 切到源码前保存所见即所得位置，并按视口中心比例对齐源码滚动（避免跳到源码头部）
    captureScroll()
    milkdown.value?.setReadonly(true)
    mode.value = 'source'
    requestAnimationFrame(() => {
      source.value?.scrollToRatio(wysiwygRatio())
      // 对齐后按首可见行重算大纲高亮
      computeActiveHeading(true)
      // 若处于查找态，重新定位当前查询（源码视图常驻）
      rerunFind()
    })
  } else {
      // 切回所见即所得：内容在隐藏期保留滚动，重渲染(setMarkdown)会回顶，
      // 因此先保存、重渲染后再恢复原位
      captureScroll()
      startLoading()
      try {
        milkdown.value?.setMarkdown(fidelity.currentText.value)
        milkdown.value?.setReadonly(false)
        mode.value = 'wysiwyg'
        // 让进度条至少绘制一帧，并恢复滚动位置
        requestAnimationFrame(() => {
        restoreScroll()
        if (loadStatus.value === 'loading') stopLoading()
        // 渲染恢复后重算大纲高亮
        computeActiveHeading(true)
        // 若处于查找态，重新定位当前查询（文档已重渲染）
        rerunFind()
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
  // 语言切换导致重挂后，恢复之前的滚动位置（避免回顶）
  requestAnimationFrame(restoreScroll)
  // 语言切换导致重挂后，新实例默认 readonly=false；
  // 若当前在源码模式，需立即恢复只读（避免用户误编辑所见即所得实例）
  if (mode.value === 'source') {
    milkdown.value?.setReadonly(true)
  }
  // 渲染完成后重新计算大纲高亮（标题 DOM 此时才就绪）
  requestAnimationFrame(() => computeActiveHeading(true))
}

/**
 * 切换到新笔记库前清空编辑器：保真层回空、所见即所得文本清空，
 * 加载态复位。源码面板的 modelValue 绑定会随之自动清空。
 */
function clear(): void {
  loadPath.value = null
  fidelity.loadFromDisk('')
  milkdown.value?.setMarkdown('')
  stopLoading()
}

/* ── 文件内查找 / 替换（批次一）──────────────────
   两种模式各有一套查找实现，这里统一分派：
   - 源码：CodeMirror Decoration 高亮 + 替换（find-source.ts）
   - 所见即所得：ProseMirror 原生选区高亮当前命中 + 替换（find-wysiwyg.ts）
   单实例红线不变：永远只操作当前激活文档的 view。 */
const findQuery = ref('')
const findOpts = ref<FindOptions>({})
const findCurrent = ref(0)
const findTotal = ref(0)
const wysiwygMatches = ref<WysiwygMatch[]>([])

function milkdownView() {
  return milkdown.value?.getEditorView() ?? null
}
function sourceView() {
  return source.value?.getView() ?? null
}

/** 执行查找并定位首个命中，返回命中总数 */
function find(query: string, opts: FindOptions): number {
  findQuery.value = query
  findOpts.value = opts
  findCurrent.value = 0
  if (mode.value === 'source') {
    const v = sourceView()
    if (!v) return 0
    const n = findInView(v, query, opts, 0)
    findTotal.value = n
    return n
  }
  const v = milkdownView()
  if (!v) return 0
  const matches = findMatchesInDoc(v, query, opts)
  wysiwygMatches.value = matches
  findTotal.value = matches.length
  if (matches.length) selectMatch(v, matches[0])
  return matches.length
}

function applyCurrent(): void {
  if (mode.value === 'source') {
    const v = sourceView()
    if (v) gotoInView(v, findQuery.value, findOpts.value, findCurrent.value)
  } else {
    const v = milkdownView()
    if (v && wysiwygMatches.value[findCurrent.value]) selectMatch(v, wysiwygMatches.value[findCurrent.value])
  }
}

function findNext(): void {
  if (!findTotal.value) return
  findCurrent.value = (findCurrent.value + 1) % findTotal.value
  applyCurrent()
}

function findPrev(): void {
  if (!findTotal.value) return
  findCurrent.value = (findCurrent.value - 1 + findTotal.value) % findTotal.value
  applyCurrent()
}

function replaceOne(repl: string): number {
  if (mode.value === 'source') {
    const v = sourceView()
    if (!v) return 0
    const n = replaceOneInView(v, findQuery.value, findOpts.value, findCurrent.value, repl)
    findTotal.value = n
    if (n) {
      findCurrent.value = Math.min(findCurrent.value, n - 1)
      applyCurrent()
    }
    return n
  }
  const v = milkdownView()
  if (!v || !wysiwygMatches.value[findCurrent.value]) return 0
  replaceMatch(v, wysiwygMatches.value[findCurrent.value], repl)
  wysiwygMatches.value = findMatchesInDoc(v, findQuery.value, findOpts.value)
  findTotal.value = wysiwygMatches.value.length
  if (findTotal.value) {
    findCurrent.value = Math.min(findCurrent.value, findTotal.value - 1)
    applyCurrent()
  }
  return findTotal.value
}

function replaceAll(repl: string): number {
  if (mode.value === 'source') {
    const v = sourceView()
    if (!v) return 0
    const n = replaceAllInView(v, findQuery.value, findOpts.value, repl)
    findTotal.value = 0
    findCurrent.value = 0
    return n
  }
  const v = milkdownView()
  if (!v) return 0
  const n = replaceAllInDoc(v, findQuery.value, findOpts.value, repl)
  wysiwygMatches.value = []
  findTotal.value = 0
  findCurrent.value = 0
  return n
}

function clearFind(): void {
  const sv = sourceView()
  if (sv) clearFindInView(sv)
  findQuery.value = ''
  findOpts.value = {}
  findCurrent.value = 0
  findTotal.value = 0
  wysiwygMatches.value = []
}

/** 选区字数（状态栏展示）：监听全局 selectionchange */
const selectionCount = ref(0)
function updateSelectionCount(): void {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
  selectionCount.value = sel && sel.rangeCount ? sel.toString().length : 0
}

/** 模式切换后若处于查找态，重新定位当前查询（两种模式的 view 始终常驻） */
function rerunFind(): void {
  if (findQuery.value) find(findQuery.value, findOpts.value)
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

onMounted(() => {
  // 两个面板始终挂载，仅切换可见性；scroll 不冒泡，用捕获阶段捕获内部滚动容器
  wysiwygPane.value?.addEventListener('scroll', onPaneScroll, true)
  sourcePane.value?.addEventListener('scroll', onPaneScroll, true)
  // 选区字数展示：监听全局 selectionchange，更新状态栏「选区 N」
  updateSelectionCount()
  if (typeof window !== 'undefined') {
    window.addEventListener('selectionchange', updateSelectionCount)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('selectionchange', updateSelectionCount)
  }
})

defineExpose({
  save,
  load,
  clear,
  switchTo,
  captureScroll,
  revealLine,
  getHTML,
  publishImages,
  gotoOutline,
  outline,
  activeHeadingIndex,
  dirty,
  willNormalize,
  mode,
  ready,
  loadStatus,
  // ── 写作统计（批次二）──
  stats,
  // ── 凝神模式（批次二）──
  setZen,
  zenActive,
  getMarkdown,
  loadMarkdownExternal,
  // ── 文件内查找 / 替换（批次一）──
  find,
  findNext,
  findPrev,
  replaceOne,
  replaceAll,
  clearFind,
  selectionCount,
  findCurrent,
  findTotal
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
