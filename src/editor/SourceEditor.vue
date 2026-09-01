<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { isZenActive } from './zen'
import { sourceFindField, setSourceFind, type SourceFindState } from './find-source'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 当前文档路径：决定 .assets 落盘位置 */
    filePath?: string | null
    /** 当前笔记库根：无文档时用于决定落盘位置 */
    vaultPath?: string | null
  }>(),
  { filePath: null, vaultPath: null }
)
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  /** 图片粘贴/拖入落盘失败（如磁盘不可写）：上报给上层弹 toast，避免静默无感知 */
  (e: 'error'): void
}>()

const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let applying = false

/* ── 图片粘贴 / 拖入落盘 ───────────────────────── */

function readFileAsBase64(file: File): Promise<{ base64: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
      const base64 = m ? m[2] : dataUrl.split(',')[1] ?? ''
      const ext = extFromName(file.name) || extFromType(file.type) || 'png'
      resolve({ base64, ext })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function extFromName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function extFromType(type: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  }
  return map[type] ?? ''
}

/** 落盘单张图片，返回用于引用的相对路径 */
async function saveImageFile(file: File): Promise<string> {
  const { base64, ext } = await readFileAsBase64(file)
  const saved = await window.api.saveAsset({
    docPath: props.filePath,
    vaultPath: props.vaultPath,
    base64,
    ext
  })
  return saved.relPath
}

/** 把若干图片文件落盘，并在光标处插入 Markdown 引用 */
async function handleImageFiles(files: File[], editor: EditorView): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (images.length === 0) return
  try {
    const refs = await Promise.all(
      images.map(async (f) => {
        const rel = await saveImageFile(f)
        const alt = f.name.replace(/\.[^.]+$/, '')
        return `![${alt}](${rel})`
      })
    )
    const text = refs.join('\n') + '\n'
    const head = editor.state.selection.main.head
    editor.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length }
    })
  } catch (e) {
    console.error('图片保存失败', e)
    emit('error')
  }
}

onMounted(() => {
  if (!host.value) return

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        sourceFindField,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) emit('update:modelValue', update.state.doc.toString())
          // 凝神模式（打字机）：光标移动时把当前行居中（rAF 错开，避免在更新周期内 dispatch）
          if (isZenActive() && update.selectionSet) {
            const head = update.state.selection.main.head
            requestAnimationFrame(() => {
              if (!view) return
              const line = view.state.doc.lineAt(head)
              view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
            })
          }
        }),
        // 粘贴 / 拖入图片：落盘到 .assets 并插入相对路径引用
        EditorView.domEventHandlers({
          paste(event, editor) {
            const files = event.clipboardData?.files
            if (files && files.length && Array.from(files).some((f) => f.type.startsWith('image/'))) {
              event.preventDefault()
              void handleImageFiles(Array.from(files), editor)
              return true
            }
            return false
          },
          drop(event, editor) {
            const files = event.dataTransfer?.files
            if (files && files.length && Array.from(files).some((f) => f.type.startsWith('image/'))) {
              event.preventDefault()
              void handleImageFiles(Array.from(files), editor)
              return true
            }
            return false
          }
        })
      ]
    })
  })
})

/** 外部替换内容（切换模式时），不触发 update 事件 */
watch(
  () => props.modelValue,
  (next) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === next) return
    applying = true
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next }
    })
    applying = false
  }
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

/** 跳转到指定行（全文搜索结果点击时调用）：选中该行并滚动到视图中央 */
function revealLine(line: number): void {
  if (!view) return
  const total = view.state.doc.lines
  const target = Math.min(Math.max(line, 1), total)
  const lineObj = view.state.doc.line(target)
  view.dispatch({
    selection: { anchor: lineObj.from },
    effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' })
  })
  view.focus()
}

/** 按比例（0~1，文档纵向阅读进度）定位源码滚动位置，用于切回源码时对齐所见即所得视口 */
function scrollToRatio(ratio: number): void {
  if (!view) return
  const scroller = view.scrollDOM
  const max = scroller.scrollHeight - scroller.clientHeight
  scroller.scrollTop = Math.max(0, Math.min(1, ratio)) * max
}

/** 当前视口顶部所在的行号（1-based），供大纲在源码模式下计算「当前章节」 */
function getFirstVisibleLine(): number {
  if (!view) return 1
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
  return view.state.doc.lineAt(block.from).number
}

/** 把当前光标所在行滚动到视口中央（凝神/打字机模式调用） */
function centerActiveLine(): void {
  if (!view) return
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
}

/**
 * 在光标处插入文本（写作辅助·片段模板用）。有选区时替换选区内容，
 * 插入后光标落在文本末尾。仅改文档、不改模式，触发 update 自动落盘。
 */
function insertAtCursor(text: string): void {
  if (!view) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length }
  })
}

/**
 * 应用/清除源码模式搜索高亮（本文档范围，复用统一搜索的 query/选项）。
 * 传 query 即按当前文档内容高亮全部命中；currentLine 标记当前结果所在行（强化显示）；
 * 传 undefined 清空高亮。纯视图装饰，不改动文档内容。
 */
function setFind(
  query?: string,
  opts?: { caseSensitive?: boolean; wholeWord?: boolean },
  currentLine?: number
): void {
  if (!view) return
  const st: SourceFindState | null = query
    ? {
        query,
        caseSensitive: !!opts?.caseSensitive,
        wholeWord: !!opts?.wholeWord,
        currentLine
      }
    : null
  view.dispatch({ effects: setSourceFind.of(st) })
}

/** 当前选区文本（导出「选中范围」用）；无选区返回空串，由调用方回退整篇 */
function getSelectionText(): string {
  if (!view) return ''
  const { from, to } = view.state.selection.main
  if (from === to) return ''
  return view.state.sliceDoc(from, to)
}

defineExpose({
  revealLine,
  scrollToRatio,
  getFirstVisibleLine,
  centerActiveLine,
  insertAtCursor,
  setFind,
  getSelectionText
})
</script>

<template>
  <div ref="host" class="source-host" />
</template>

<style scoped>
.source-host {
  height: 100%;
  overflow: hidden;
}
</style>
