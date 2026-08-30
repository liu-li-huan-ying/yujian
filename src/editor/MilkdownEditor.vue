<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { $prose, replaceAll } from '@milkdown/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import '../styles/editor.css'
import { renderPreview } from './features/mermaid'
import { i18n } from '../i18n'
import { createZenPlugin } from './zen'
import {
  createFindDecoPlugin,
  findKey,
  findPosByText,
  findPosOfLine,
  setFindState,
  type WysiwygFindState
} from './find-wysiwyg'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    /** 当前文档路径：决定 .assets 落盘位置 */
    filePath?: string | null
    /** 当前笔记库根：无文档时用于决定落盘位置 */
    vaultPath?: string | null
  }>(),
  { readonly: false, filePath: null, vaultPath: null }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'ready'): void
}>()

const host = ref<HTMLDivElement | null>(null)
let crepe: Crepe | null = null
let imgObserver: MutationObserver | null = null

/* ── 图片粘贴落盘 ─────────────────────────────── */

/** FileReader 把图片读成 base64，并推断扩展名 */
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

/**
 * 图片落盘：字节经主进程写入文档同级同名 `.assets`，返回相对路径。
 * 相对路径进入文档模型（保证 Git 可移植、往返保真），
 * 真正用于显示的绝对 file:// 由 MutationObserver 在 DOM 层改写。
 */
async function uploadToAssets(file: File): Promise<string> {
  const { base64, ext } = await readFileAsBase64(file)
  const saved = await window.api.saveAsset({
    docPath: props.filePath,
    vaultPath: props.vaultPath,
    base64,
    ext
  })
  return saved.relPath
}

/* ── 显示解析：相对 src → file:// ───────────────── */

/** 文档目录（正斜杠，用于拼接 file:// 基址） */
function resolveDocDir(): string | null {
  if (!props.filePath) return null
  return props.filePath.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/')
}

/** 把编辑器 DOM 内所有相对路径图片改写为 file:// 绝对路径（仅显示，不改文档模型） */
function rewriteImages(root: HTMLElement): void {
  const dir = resolveDocDir()
  if (!dir) return
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    // 已是可解析来源（http/https/data/blob/file）则不处理，避免循环改写
    if (!src || /^(https?:|data:|blob:|file:)/i.test(src)) return
    try {
      const abs = new URL(src, 'file://' + dir + '/').href
      img.setAttribute('src', abs)
    } catch {
      // 非法的相对路径：忽略，保持原样
    }
  })
}

function setupImageResolver(): void {
  if (!host.value) return
  rewriteImages(host.value)
  imgObserver = new MutationObserver((mutations) => {
    let dirty = false
    for (const mu of mutations) {
      if (mu.type === 'attributes' && (mu.target as Element).tagName === 'IMG') {
        dirty = true
        break
      }
      if (mu.type === 'childList' && mu.addedNodes.length > 0) {
        dirty = true
        break
      }
    }
    if (dirty && host.value) rewriteImages(host.value)
  })
  imgObserver.observe(host.value, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src']
  })
}

async function init(defaultValue?: string): Promise<void> {
  if (!host.value) return

  // 快照当前语言包值（Crepe 构造时一次性传入）
  const L = i18n

  crepe = new Crepe({
    root: host.value,
    defaultValue: defaultValue ?? props.modelValue,
    features: {
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.ImageBlock]: true,
      [Crepe.Feature.BlockEdit]: true,
      [Crepe.Feature.Toolbar]: true,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: true,
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.AI]: false
    },
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        languages,
        renderPreview,
        previewLabel: L.codeMirror.previewLabel,
        previewLoading: L.codeMirror.previewLoading,
        searchPlaceholder: L.codeMirror.searchPlaceholder,
        noResultText: L.codeMirror.noResultText,
        copyText: L.codeMirror.copyText
      },
      [Crepe.Feature.ImageBlock]: {
        onUpload: (file: File) => uploadToAssets(file),
        blockUploadButton: L.imageBlock.blockUploadButton,
        blockConfirmButton: L.imageBlock.blockConfirmButton,
        blockCaptionPlaceholderText: L.imageBlock.blockCaptionPlaceholderText,
        blockUploadPlaceholderText: L.imageBlock.blockUploadPlaceholderText,
        inlineUploadButton: L.imageBlock.inlineUploadButton,
        inlineUploadPlaceholderText: L.imageBlock.inlineUploadPlaceholderText
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: L.blockEdit.textGroup,
        listGroup: L.blockEdit.listGroup,
        advancedGroup: L.blockEdit.advancedGroup
      },
      [Crepe.Feature.Placeholder]: {
        text: L.placeholder.text
      }
    }
  })

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      emit('update:modelValue', markdown)
    })
  })

  // 凝神模式装饰插件：开关由 EditorHost 经模块级状态控制，空事务触发重算，零侵入。
  crepe.editor.use($prose(() => createZenPlugin()))
  // 所见即所得搜索命中高亮插件：与源码模式对称，由统一搜索 query/选项驱动。
  crepe.editor.use($prose(() => createFindDecoPlugin()))

  await crepe.create()
  crepe.setReadonly(props.readonly)
  setupImageResolver()
  // 视图就绪后补发可能在就绪前到达的高亮请求（首次搜索早于 crepe.create 完成时）
  flushPendingFind()
  emit('ready')
}

onMounted(() => {
  void init()
})

onBeforeUnmount(() => {
  imgObserver?.disconnect()
  imgObserver = null
  void crepe?.destroy()
  crepe = null
})

/** 供父组件在切回 WYSIWYG 时灌入源码文本（异步：导出需等 DOM 刷新后再读） */
async function setMarkdown(markdown: string): Promise<void> {
  if (!crepe) return
  await crepe.editor.action(replaceAll(markdown))
  if (host.value) rewriteImages(host.value)
}

function getMarkdown(): string {
  return crepe?.getMarkdown() ?? props.modelValue
}

/**
 * 取「已渲染」的 HTML（所见即所得导出）：直接读 ProseMirror 视图 DOM。
 * 比重新跑序列化管线更稳，且导出结果与屏幕所见一致。
 */
function getHTML(): string {
  if (!crepe) return ''
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return view.dom.innerHTML
}

function setReadonly(value: boolean): void {
  crepe?.setReadonly(value)
}

/** 取 ProseMirror EditorView（供文件内查找定位/替换），未就绪返回 null */
function getEditorView(): EditorView | null {
  if (!crepe) return null
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx)) as unknown as EditorView
}

/** 视图就绪前到达的高亮请求先暂存，crepe.create 完成后由 flushPendingFind 补发 */
let pendingFind: WysiwygFindState | null | undefined = undefined

/** 视图就绪后补发暂存的高亮（首次搜索可能早于 crepe.create 完成） */
function flushPendingFind(): void {
  if (pendingFind === undefined) return
  const fs = pendingFind
  pendingFind = undefined
  setFind(fs)
}

/**
 * 驱动所见即所得模式搜索命中高亮（对称于源码模式）：传 WysiwygFindState 即按统一
 * query/选项高亮全部命中并映射 currentLine；传 null 清空。写入模块级真相源以保证
 * 跨事务/重渲染自愈，再经 meta 事务触发 plugin.apply → 重建装饰，稳定生效。视图未
 * 就绪时暂存，待 crepe.create 完成后补发，避免「首次搜索早于视图就绪 → 高亮丢失」。
 */
function setFind(fs: WysiwygFindState | null): void {
  setFindState(fs)
  pendingFind = fs
  const view = getEditorView()
  if (!view) return
  try {
    view.dispatch(view.state.tr.setMeta(findKey, fs))
  } catch {
    // 极端情况下事务异常不应中断搜索交互；装饰会在下次文档变更时自愈
  }
}

/**
 * 定位到指定行（搜索结果 / 断链跳转）：反查行号 → 文档位置，设置光标并滚动到视口。
 * 与源码模式对称，使所见即所得模式下也能直接跳转，无需被迫切到源码。
 */
function revealLine(line: number): void {
  const view = getEditorView()
  if (!view) return
  const doc = view.state.doc
  // 源码行号与渲染行号口径不同（空行渲染后不产生节点），优先按源码行文本定位，
  // 匹配不到再回退行号反查，保证跳转落在正确的内容块上。
  const srcLine = (crepe?.getMarkdown() ?? '').split('\n')[line - 1] ?? ''
  const raw = findPosByText(doc, srcLine) ?? findPosOfLine(doc, line)
  if (raw == null) return
  const pos = Math.max(0, Math.min(raw, doc.content.size))
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))).scrollIntoView())
  view.focus()
}

defineExpose({
  setMarkdown,
  getMarkdown,
  getHTML,
  setReadonly,
  getEditorView,
  setFind,
  revealLine
})
</script>

<template>
  <div ref="host" class="milkdown-host" />
</template>

<style scoped>
.milkdown-host {
  height: 100%;
  overflow: hidden;
}
</style>
