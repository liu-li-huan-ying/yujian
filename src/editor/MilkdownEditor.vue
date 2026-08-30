<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx, schemaCtx, serializerCtx } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import { DOMSerializer } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'
import { $prose, $inputRule, $remark, replaceAll } from '@milkdown/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import 'katex/dist/katex.min.css'
import '../styles/editor.css'
import { renderPreview } from './features/mermaid'
import { emojiInputRule, emojiDecorationPlugin } from './features/emoji'
import { htmlInlineSchema, remarkHtmlInline } from './features/htmlInline'
import {
  highlightSchema,
  inlineMarkInputRules,
  subSchema,
  supSchema
} from './features/inlineMarks'
import { remarkInlineMarks } from './features/inlineMarksSyntax'
import {
  mathInlineNodeViewPlugin,
  renderMathBlockPreview
} from './features/mathjax'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
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

/**
 * Ctrl/⌘+点击链接 → 用系统默认浏览器打开（普通点击不拦截，保持可编辑）。
 * 仅处理 http(s) 链接；锚点 / 文档内跳转 / 相对路径交由编辑器自身处理。
 */
function onEditorClick(e: MouseEvent): void {
  if (!e.ctrlKey && !e.metaKey) return
  const target = e.target as HTMLElement | null
  const anchor = target?.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  if (!/^https?:\/\//i.test(href)) return
  e.preventDefault()
  void window.api.openExternal(href)
}

/**
 * 脚注双向跳转（零 DOM 注入，避免与 ProseMirror 托管 DOM 冲突）：
 * - 点正文里的引用 <sup data-type="footnote_reference"> → 滚到底部定义
 * - 点底部定义的 <dt>（带 ↩ 提示）→ 滚回正文第一个引用
 * 锚点与回跳 <a> 在「导出 HTML」时由 enhanceFootnotes 注入；编辑区内仅用滚动导航。
 */
function onFootnoteClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (!target) return
  const ref = target.closest('sup[data-type="footnote_reference"]') as HTMLElement | null
  if (ref) {
    const label = ref.getAttribute('data-label') ?? ''
    const def = host.value?.querySelector(
      `dl[data-type="footnote_definition"][data-label="${cssAttr(label)}"]`
    ) as HTMLElement | null
    def?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }
  const def = target.closest('dl[data-type="footnote_definition"]') as HTMLElement | null
  if (def) {
    const dt = def.querySelector(':scope > dt') as HTMLElement | null
    if (dt && (target === dt || dt.contains(target))) {
      const label = def.getAttribute('data-label') ?? ''
      const back = host.value?.querySelector(
        `sup[data-type="footnote_reference"][data-label="${cssAttr(label)}"]`
      ) as HTMLElement | null
      back?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
}

/** 属性选择器里转义特殊字符（脚注 label 通常为数字，但兼容任意字符串） */
function cssAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
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
        // mermaid 代码块默认即显示渲染后的图表（预览优先），普通代码块仍走默认编辑视图。
        // 机制：renderPreview 对非 mermaid 返回 null → 预览面板不渲染、CodeMirror 编辑器照常显示；
        // 对 mermaid 返回 SVG → 预览面板渲染且编辑器默认隐藏（点击 Edit 仍可编辑源码）。
        previewOnlyByDefault: true,
        previewLabel: L.codeMirror.previewLabel,
        previewLoading: L.codeMirror.previewLoading,
        searchPlaceholder: L.codeMirror.searchPlaceholder,
        noResultText: L.codeMirror.noResultText,
        copyText: L.codeMirror.copyText,
        previewToggleText: (previewOnly: boolean) =>
          previewOnly ? L.codeMirror.editLabel : L.codeMirror.hideLabel
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
  // Emoji 短代码：输入 `:smile:` 自动转 emoji + 已有短代码只读显示为 emoji
  crepe.editor.use($inputRule(() => emojiInputRule))
  crepe.editor.use($prose(() => emojiDecorationPlugin()))
  // 内联标记真节点：==高亮== / ^上标^ / ~下标~
  // 解析走 micromark 扩展、序列化走自定义 handler 原样输出定界符 —— 这是往返保真的关键：
  // 旧「装饰 + 导出后处理」方案源码里仍留 `~`/`==`，会被 gfm 抢成删除线 / 被序列化转义成 `\~`、`\==`。
  crepe.editor.use($remark('remarkInlineMarks', () => remarkInlineMarks))
  // 每个 $nodeSchema 本身是「插件数组」，需逐个注册（不能直接传数组的数组）
  crepe.editor.use(subSchema)
  crepe.editor.use(supSchema)
  crepe.editor.use(highlightSchema)
  // 边打字边生效：真节点只在重新解析时生成，输入规则让敲完定界符立刻转成节点。
  // $inputRule 一次只收一条规则，故逐条注册。
  for (const rule of inlineMarkInputRules) {
    crepe.editor.use($inputRule(() => rule))
  }
  // 内联原始 HTML（<kbd>键</kbd> / <sub> / <sup> / <mark> …）：remark 改写 + 节点渲染，
  // 标签不显示、只显示渲染结果，且 Markdown 往返保真（导出写回原样 HTML）
  crepe.editor.use(remarkHtmlInline)
  crepe.editor.use(htmlInlineSchema)
  // 行内数学 $…$ 改由 MathJax 渲染（接管 math_inline 节点显示）
  crepe.editor.use($prose(() => mathInlineNodeViewPlugin()))
  // 块级数学 $$…$$ 走 renderPreview（language='latex'）。Crepe 的 Latex 特性会在 create()
  // 期间用 katex 覆盖 codeBlockConfig.renderPreview，普通 editor.config 调用排在它之前会被盖掉；
  // 故这里用 .use() 特性（排到内部特性之后）再覆盖一次，让 MathJax 最终胜出，
  // 从而支持 \ce / \require / \label / \eqref。mermaid 等其它语言仍交回上一级处理。
  crepe.editor.use((ctx) => () => {
    ctx.update(codeBlockConfig.key, (prev) => ({
      ...prev,
      renderPreview: (language, content, applyPreview) => {
        if (String(language).toLowerCase() === 'latex') {
          return renderMathBlockPreview(content, applyPreview)
        }
        return prev.renderPreview(language, content, applyPreview)
      }
    }))
  })

  await crepe.create()
  crepe.setReadonly(props.readonly)
  setupImageResolver()
  // Ctrl/⌘+点击链接跳转：普通点击保持可编辑，仅修饰键按下时打开外部浏览器
  host.value?.addEventListener('click', onEditorClick)
  // 脚注双向跳转（点引用跳定义、点定义 dt 跳回引用）
  host.value?.addEventListener('click', onFootnoteClick)
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
  host.value?.removeEventListener('click', onEditorClick)
  host.value?.removeEventListener('click', onFootnoteClick)
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

/**
 * 把任意 Markdown 渲染成 HTML 片段，**不触碰当前编辑器内容**：
 * 直接复用 Milkdown 的 parser + schema + DOMSerializer 序列化，不需要第二个编辑器实例，
 * 因此不违反「单实例」红线。是多文件合订导出与选中范围导出的共同基础。
 */
function markdownToHtml(markdown: string): string {
  if (!crepe || !markdown) return ''
  return crepe.editor.action((ctx) => {
    const parser = ctx.get(parserCtx)
    const schema = ctx.get(schemaCtx)
    const doc = parser(markdown)
    if (!doc) return ''
    const serializer = DOMSerializer.fromSchema(schema)
    const holder = document.createElement('div')
    holder.appendChild(serializer.serializeFragment(doc.content))
    return holder.innerHTML
  })
}

/**
 * 当前选区的 HTML 片段（导出「选中范围」用）；无选区返回空串，由调用方回退整篇。
 * 序列化走与整篇导出同源的 DOMSerializer，保证两种范围的标签口径一致。
 */
function getSelectionHTML(): string {
  const view = getEditorView()
  if (!view) return ''
  const sel = view.state.selection
  if (sel.empty) return ''
  const serializer = DOMSerializer.fromSchema(view.state.schema)
  const holder = document.createElement('div')
  holder.appendChild(serializer.serializeFragment(sel.content().content))
  return holder.innerHTML
}

/**
 * 选区的 Markdown 文本（把选中范围导出为 LaTeX 时用）；无选区返回空串。
 * 走 Milkdown 的 serializer，与整篇导出的 Markdown 口径一致。
 * 选区可能切出不合法的顶层结构（如半个列表），故用 try/catch 兜底，失败由调用方回退整篇。
 */
function getSelectionMarkdown(): string {
  const view = getEditorView()
  if (!view || !crepe) return ''
  const sel = view.state.selection
  if (sel.empty) return ''
  try {
    const doc = view.state.schema.topNodeType.create(null, sel.content().content)
    return crepe.editor.action((ctx) => ctx.get(serializerCtx)(doc))
  } catch {
    return ''
  }
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
/**
 * 找到承载编辑器滚动的容器：从 .ProseMirror 向上找第一个 overflow 可滚动祖先
 * （玉笺里是 `.milkdown-host`，overflow:hidden 但仍可 scrollTop 滚动）。
 */
function getScroller(dom: HTMLElement): HTMLElement {
  let el: HTMLElement | null = dom
  while (el) {
    const s = getComputedStyle(el)
    if (/auto|scroll|hidden/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return el
    el = el.parentElement
  }
  return dom
}

/**
 * 把指定文档位置滚到视口中央，与源码模式 `EditorView.scrollIntoView(from, { y: 'center' })` 对称。
 * ProseMirror 的 scrollIntoView 事务只保证选区「可见」、不保证居中；这里用 coordsAtPos
 * 取目标在视口中的像素坐标，再按视口中心（0.5）微调滚动容器的 scrollTop。
 */
function scrollPosToCenter(view: EditorView, pos: number): void {
  const coords = view.coordsAtPos(pos)
  const targetY = (coords.top + coords.bottom) / 2
  const scroller = getScroller(view.dom as HTMLElement)
  const rect = scroller.getBoundingClientRect()
  const anchor = rect.top + rect.height * 0.5
  scroller.scrollTo({ top: scroller.scrollTop + (targetY - anchor), behavior: 'smooth' })
}

/**
 * 定位到指定行（搜索结果 / 断链跳转）：反查行号 → 文档位置，设置光标并居中滚动。
 * 与源码模式对称，使所见即所得模式下也能直接跳转并停在视口中央，无需被迫切到源码。
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
  // 先落光标（选区存在），再精确居中——不用事务的 scrollIntoView（只保证可见）
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))))
  scrollPosToCenter(view, pos)
  view.focus()
}

defineExpose({
  setMarkdown,
  getMarkdown,
  getHTML,
  markdownToHtml,
  getSelectionHTML,
  getSelectionMarkdown,
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
