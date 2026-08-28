<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/core'
import { replaceAll } from '@milkdown/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import '../styles/editor.css'
import { renderPreview } from './features/mermaid'
import { i18n } from '../i18n'

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
let mounted = false
let imgObserver: MutationObserver | null = null
/** 重入锁：防止快速连点语言切换时 create/destroy 交叠把实例搞坏 */
let reloading = false
let reloadPending = false
/** 跨重建保留只读状态（源码模式下所见即所得实例是 readonly） */
let readonlyState = false

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
  if (!host.value || mounted) return
  mounted = true

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

  await crepe.create()
  crepe.setReadonly(readonlyState)
  setupImageResolver()
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
  mounted = false
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
  readonlyState = value
  crepe?.setReadonly(value)
}

/**
 * 语言切换后调用：销毁并重建 Crepe 实例，使构造期固化的标签
 * （BlockEdit / Placeholder / ImageBlock / CodeMirror）按新语言生效。
 * 内容从当前实例读取后原样回填，不触发保存。
 *
 * 重入保护：快速连点时只跑最后一次（合并待处理），保证最终语言与
 * 当前 i18n 一致；任一次失败都复位状态，允许后续重试，不会卡死。
 */
async function reload(): Promise<void> {
  if (reloading) {
    reloadPending = true
    return
  }
  reloading = true
  try {
    do {
      reloadPending = false
      const current = crepe?.getMarkdown() ?? props.modelValue
      if (imgObserver) {
        imgObserver.disconnect()
        imgObserver = null
      }
      if (crepe) {
        try {
          await crepe.destroy()
        } catch {
          // 销毁异常忽略，继续重建
        }
        crepe = null
      }
      if (host.value) host.value.innerHTML = ''
      mounted = false
      await init(current)
    } while (reloadPending)
  } catch (e) {
    console.error('[MilkdownEditor] 语言切换重建失败', e)
    mounted = false
    crepe = null
  } finally {
    reloading = false
  }
}

defineExpose({ setMarkdown, getMarkdown, getHTML, setReadonly, reload })
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
