/**
 * 导出内容构建（与「写盘 / 预览」解耦）。
 *
 * 这里只负责「取正文 → 变换 → 产出规格化产物对象」，所有 App 级状态
 * （当前文档路径、导出偏好、编辑器 API、i18n、toast、文件读取）都通过
 * `ExportContext` 注入，从而让构建逻辑可被复用、可单测，且不再散落在 App.vue。
 *
 * 写盘 / 打印 / 预览开关判定仍留在 App.vue（它们触碰 UI 状态）。
 */
import { buildExportHtml, renderLatexBlocksInExport } from './docTemplate'
import { inlineImages } from './imageInline'
import { embedMermaidSvg } from './mermaidSvg'
import { markdownToLatex } from './markdownToLatex'
import { isBinary, kindExt, kindFilter, type ExportKind } from './types'
import { serializeBinary } from './serialize'
import { htmlToPlainText } from './domUtils'
import { baseName } from '../utils/path'
import type { Locale } from '../i18n/locales/zh-CN'

/** 编辑器需向导出构建暴露的最小 API（构建期只读取正文） */
export interface ExportHostApi {
  getMarkdown: () => string
  getHTML: () => Promise<string>
  getSelectionMarkdown: () => string
  getSelectionHTML: () => string
}

/** 导出偏好（来自 App 的 exportPrefs.value 快照） */
export interface ExportPrefs {
  toc: boolean
  cover: boolean
  inline: boolean
  selection: boolean
  preview: boolean
}

/** 导出元信息（标题 / 作者 / 日期），由上层从 frontmatter 解析后注入 */
export interface ExportMeta {
  title?: string
  author?: string
  date?: string
}

/**
 * 构建导出产物所需的全部外部环境，全部由 App 注入。
 * 这样本模块不依赖 Vue 响应式、不依赖具体编辑器实例类型，只认这套接口。
 */
export interface ExportContext {
  /** 当前文档绝对路径；null 表示无打开文档 */
  filePath: string | null
  /** 导出菜单偏好（传入时应为 .value 快照） */
  exportPrefs: ExportPrefs
  /** 编辑器只读 API；null 时无文档 */
  host: ExportHostApi | null
  /** 解析导出元信息（含 frontmatter） */
  readExportMeta: (base: string) => ExportMeta
  /** 读取绝对路径图片为 data URL（导出内联用） */
  readAsDataUrl: (absPath: string) => Promise<string | null>
  /** 轻量提示 */
  showToast: (msg: string, type?: 'ok' | 'err' | 'info', duration?: number) => void
  /** i18n 文案（U = L.ui，即整个 locale 的 ui 子命名空间） */
  U: Locale['ui']
}

/** 构建好的导出产物（尚未写盘 / 打印） */
export interface BuiltExport {
  /** 落盘文本（md/txt/html/latex）；二进制格式的预览用 HTML 也暂存此处 */
  content: string
  /** 二进制格式（docx/epub/rtf/odt）的成品字节；存在时主进程按字节写盘 */
  binary?: Uint8Array
  /** 二进制产物的 MIME */
  mime?: string
  /** 默认文件名（含扩展名） */
  defaultName: string
  filters?: { name: string; extensions: string[] }[]
  kind: ExportKind
}

/** 多文件合订 / 覆盖式构建传入的内容 */
export interface CompileOverride {
  title?: string
  meta?: ExportMeta
  bodyHtml?: string
  markdown?: string
  forceInline?: boolean
}

/** 二进制格式的 MIME（写入 .odt/.docx 等需要，主要用于日志与未来扩展） */
function mimeFor(kind: ExportKind): string {
  switch (kind) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'epub':
      return 'application/epub+zip'
    case 'rtf':
      return 'application/rtf'
    case 'odt':
      return 'application/vnd.oasis.opendocument.text'
    default:
      return 'application/octet-stream'
  }
}

/** 导出格式 → 简短标签（toast / 按钮使用） */
export function kindLabel(kind: ExportKind, U: Locale['ui']): string {
  return (
    {
      md: U.exportMd,
      txt: U.exportTxt,
      html: U.exportHtml,
      pdf: U.exportPdf,
      latex: U.exportLatex,
      docx: U.exportDocx,
      epub: U.exportEpub,
      rtf: U.exportRtf,
      odt: U.exportOdt
    } as Record<ExportKind, string>
  )[kind]
}

/** Uint8Array → base64（避免大数组一次性 String.fromCharCode 爆栈） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(bin)
}

/**
 * 构建导出产物内容（不写盘）。
 * 与「写盘」拆开，是为了让导出前预览能插在两者之间——预览与落盘共用同一份内容，
 * 不重复渲染。
 * @param kind  html 网页 / pdf 文档 / latex 源文件 / 各二进制格式
 * @param scope all 整篇 / selection 当前选中（无选区时回退整篇并提示，不静默降级）
 * @param override 多文件合订时传入：拼接好的正文 HTML / Markdown 原文与合订标题，
 *                 此时不再走编辑器的「选中 / 整篇」范围逻辑。
 *                 forceInline 为 true 时（合订）强制内联图片与图表，确保跨目录自包含。
 * @param ctx   注入的外部环境（见 ExportContext）
 */
export async function buildExportContent(
  kind: ExportKind,
  scope: 'all' | 'selection' = 'all',
  override?: CompileOverride,
  ctx?: ExportContext
): Promise<BuiltExport | null> {
  const c = ctx as ExportContext
  const isCompile = !!override
  if (!isCompile && !c.filePath) {
    c.showToast(c.U.toastNoDoc, 'err')
    return null
  }
  const base = override?.title ?? baseName(c.filePath ?? '')
  const meta = override?.meta ?? c.readExportMeta(base)
  // 范围：优先取调用方指定，其次跟随菜单里的「仅导出选中内容」选项（合订不适用）
  const useSel = !isCompile && (scope === 'selection' || c.exportPrefs.selection)

  let content = ''
  let binary: Uint8Array | undefined
  let mime: string | undefined
  let defaultName = ''
  let filters: { name: string; extensions: string[] }[] | undefined

  // ── Markdown：直接透传正文（无需经过 HTML 渲染）──
  if (kind === 'md') {
    let md = override?.markdown ?? ''
    if (!isCompile) {
      md = useSel ? c.host?.getSelectionMarkdown() ?? '' : ''
      if (useSel && !md.trim()) {
        c.showToast(c.U.toastNoSelection, 'info')
        md = c.host?.getMarkdown() ?? ''
      } else if (!useSel) {
        md = c.host?.getMarkdown() ?? ''
      }
    }
    if (!md.trim()) {
      c.showToast(c.U.toastNoContent, 'err')
      return null
    }
    content = md
    defaultName = base + '.md'
    filters = [kindFilter('md', c.U)]
    return { content, defaultName, filters, kind }
  }

  // ── 纯文本：取正文 HTML 后剥离标签 ──
  if (kind === 'txt') {
    let body = override?.bodyHtml ?? ''
    if (!isCompile) {
      body = useSel ? c.host?.getSelectionHTML() ?? '' : ''
      if (useSel && !body) {
        c.showToast(c.U.toastNoSelection, 'info')
        body = (await c.host?.getHTML()) ?? ''
      } else if (!useSel) {
        body = (await c.host?.getHTML()) ?? ''
      }
    }
    if (!body) {
      c.showToast(c.U.toastNoContent, 'err')
      return null
    }
    const html = buildExportHtml(body, base, {
      math: false,
      mermaid: false,
      toc: false,
      cover: false,
      meta
    })
    // 只取正文 <article> 内容做纯文本化，避免把封面 / 样式噪声带进去
    const artMatch = /<article[^>]*>([\s\S]*?)<\/article>/.exec(html)
    content = htmlToPlainText(artMatch ? artMatch[1] : html)
    defaultName = base + '.txt'
    filters = [kindFilter('txt', c.U)]
    return { content, defaultName, filters, kind }
  }

  // ── LaTeX：由 Markdown 原文转换 ──
  if (kind === 'latex') {
    let md = override?.markdown ?? ''
    if (!isCompile) {
      md = useSel ? c.host?.getSelectionMarkdown() ?? '' : ''
      if (useSel && !md.trim()) {
        c.showToast(c.U.toastNoSelection, 'info')
        md = c.host?.getMarkdown() ?? ''
      } else if (!useSel) {
        md = c.host?.getMarkdown() ?? ''
      }
    }
    if (!md.trim()) {
      c.showToast(c.U.toastNoContent, 'err')
      return null
    }
    content = markdownToLatex(md, { meta })
    defaultName = base + '.tex'
    filters = [kindFilter('latex', c.U)]
    return { content, defaultName, filters, kind }
  }

  // ── HTML / PDF / 二进制（docx/epub/rtf/odt）：共用「规范化 HTML」作为中间表示 ──
  let body = override?.bodyHtml ?? ''
  if (!isCompile) {
    body = useSel ? c.host?.getSelectionHTML() ?? '' : ''
    if (useSel && !body) {
      c.showToast(c.U.toastNoSelection, 'info')
      body = (await c.host?.getHTML()) ?? ''
    } else if (!useSel) {
      body = (await c.host?.getHTML()) ?? ''
    }
  }
  if (!body) {
    c.showToast(c.U.toastNoContent, 'err')
    return null
  }

  // 二进制格式：强制内联图片与图表（保证自包含），且不走 PDF 的那套选项
  const embed = kind === 'pdf' || c.exportPrefs.inline || isBinary(kind) || override?.forceInline === true
  const doc = buildExportHtml(body, base, {
    math: true,
    mermaid: !embed,
    // PDF 恒带自动目录（纸质阅读需要导航）；二进制格式自建目录，故关闭 HTML 内目录；
    // HTML 由选项决定。封面统一由选项控制。
    toc: kind === 'pdf' || (kind === 'html' && c.exportPrefs.toc),
    cover: c.exportPrefs.cover,
    meta
  })
  let finalized = doc
  if (embed) {
    // 合订的图片已在拼接前按各自文档目录内联过，此处不二次处理
    if (!isCompile && c.filePath) {
      finalized = await inlineImages(finalized, c.filePath, c.readAsDataUrl)
    }
    finalized = await embedMermaidSvg(finalized)
    // LaTeX 代码块：导出前用 MathJax 渲染成 SVG（编辑器预览已支持，导出保持一致）
    finalized = await renderLatexBlocksInExport(finalized)
  }

  if (isBinary(kind)) {
    // 序列化前先把标题锚点补上（二进制格式各自建目录用），再转字节
    try {
      binary = await serializeBinary(kind, finalized, {
        title: meta.title || base,
        author: meta.author,
        date: meta.date
      })
    } catch (e) {
      console.error('[export] 序列化二进制格式失败：', e)
      c.showToast(`${c.U.toastExportErr}${e instanceof Error ? e.message : String(e)}`, 'err', 5000)
      return null
    }
    // 预览用：渲染同一份规范化 HTML（图片内联、Mermaid 已是 SVG）
    content = finalized
    mime = mimeFor(kind)
    defaultName = base + '.' + kindExt(kind)
    filters = [kindFilter(kind, c.U)]
    return { content, binary, mime, defaultName, filters, kind }
  }

  // HTML / PDF：直接落盘文本
  content = finalized
  defaultName = base + (kind === 'html' ? '.html' : '.pdf')
  filters = kind === 'html' ? [kindFilter('html', c.U)] : undefined
  return { content, defaultName, filters, kind }
}
