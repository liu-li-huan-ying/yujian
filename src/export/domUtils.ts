/**
 * 导出用 DOM 工具：在渲染进程（浏览器上下文）里把文档 DOM 变换为目标格式所需的形态。
 *
 * 这些函数操作由 DOMParser 解析出的独立 Document，绝不触碰编辑器内真实文档。
 */

import emojiData from 'markdown-it-emoji/lib/data/full.mjs'
import { i18n } from '../i18n'

/** name（不含冒号）→ emoji 字符，来自 markdown-it-emoji 全量词典 */
export const EMOJI_MAP: Record<string, string> = emojiData as unknown as Record<string, string>

/** 短代码名称：字母数字下划线加号减号 */
const EMOJI_NAME_RE = /[a-z0-9_+-]{1,50}/

/** 把一段 HTML 解析为可操作的独立 Document */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

export interface PackagedImage {
  /** 写入包内的文件名，如 img-1.png */
  name: string
  /** 扩展名，如 png */
  ext: string
  /** MIME，如 image/png */
  mime: string
  /** 原始字节 */
  data: Uint8Array
}

/**
 * 把文档中的 <svg>（含 Mermaid 图表）光栅化为 <img> PNG data URL。
 * DOCX / RTF / ODT 只接受位图，Mermaid 图表需先转 PNG 才能嵌入。
 * 在渲染进程用 canvas 绘制；任一图转换失败则移除该图，保证不中断导出。
 */
export async function rasterizeSvgToImg(root: ParentNode): Promise<void> {
  const svgs = Array.from(root.querySelectorAll('svg'))
  for (const svg of svgs) {
    try {
      const xml = new XMLSerializer().serializeToString(svg)
      const bytes = new TextEncoder().encode(xml)
      let bin = ''
      bytes.forEach((b) => (bin += String.fromCharCode(b)))
      const svgUrl = 'data:image/svg+xml;base64,' + btoa(bin)

      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('svg 光栅化失败'))
        img.src = svgUrl
      })

      const wAttr = Number(svg.getAttribute('width')) || 0
      const hAttr = Number(svg.getAttribute('height')) || 0
      const vb = svg.viewBox?.baseVal
      const w = wAttr || (vb && vb.width) || img.naturalWidth || 600
      const h = hAttr || (vb && vb.height) || img.naturalHeight || 300

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w))
      canvas.height = Math.max(1, Math.round(h))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        svg.remove()
        continue
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const png = canvas.toDataURL('image/png')

      const imgEl = document.createElement('img')
      imgEl.setAttribute('src', png)
      imgEl.setAttribute('alt', svg.getAttribute('aria-label') || 'diagram')
      imgEl.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:1em auto')
      svg.replaceWith(imgEl)
    } catch {
      svg.remove()
    }
  }
}

/**
 * 收集文档内所有 data URL 图片（内联后的本地图 / 图表 PNG），供 EPUB / ODT 打包。
 * 返回按文档中出现的顺序命名（img-1.png …），调用方负责改写对应 <img> 的 src。
 */
export function collectImages(root: ParentNode): PackagedImage[] {
  const out: PackagedImage[] = []
  const imgs = root.querySelectorAll('img[src^="data:"]')
  Array.from(imgs).forEach((node, i) => {
    const img = node as HTMLImageElement
    const src = img.getAttribute('src') || ''
    const m = /^data:([^;]+);base64,(.*)$/.exec(src)
    if (!m) return
    const mime = m[1]
    const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, 'png')
    const bin = atob(m[2])
    const data = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) data[j] = bin.charCodeAt(j)
    out.push({ name: `img-${i + 1}.${ext}`, ext, mime, data })
  })
  return out
}

/** HTML 块级标签 → 在文本化时作为段落分隔 */
const BLOCK_TAGS = /<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi
const BR_TAGS = /<(br|hr)\s*\/?>/gi

/** 把（正文）HTML 转成可读纯文本：块级元素换段、标签剥离、实体解码 */
export function htmlToPlainText(html: string): string {
  let s = html
  s = s.replace(BLOCK_TAGS, '\n')
  s = s.replace(BR_TAGS, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** XML 文本转义（EPUB / ODT 的标签内容） */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 脚注双向跳转（导出 HTML 用）：在离屏副本 DOM 上注入真实锚点与回跳链接。
 * - 正文引用 <sup data-type="footnote_reference" data-label="N"> → id + 包一层 <a href="#fn-N">
 * - 底部定义 <dl data-type="footnote_definition" data-label="N"> → id="fn-N" + 末尾追加 <a href="#fnref-N-0">↩</a>
 * 同一脚注多处引用时 id 带序号，回跳指向第一处引用。仅作用于副本，绝不触碰编辑器 DOM。
 */
export function enhanceFootnotes(root: ParentNode): void {
  const refs = Array.from(root.querySelectorAll('sup[data-type="footnote_reference"]'))
  const defs = Array.from(root.querySelectorAll('dl[data-type="footnote_definition"]'))

  refs.forEach((ref, i) => {
    const el = ref as HTMLElement
    const label = el.getAttribute('data-label') ?? ''
    const id = `fnref-${label}-${i}`
    el.setAttribute('id', id)
    const a = document.createElement('a')
    a.setAttribute('href', `#fn-${label}`)
    a.className = 'footnote-ref-link'
    a.textContent = el.textContent ?? ''
    el.textContent = ''
    el.appendChild(a)
  })

  defs.forEach((def) => {
    const el = def as HTMLElement
    const label = el.getAttribute('data-label') ?? ''
    el.setAttribute('id', `fn-${label}`)
    if (el.querySelector(':scope > .footnote-backref')) return
    const back = document.createElement('a')
    back.setAttribute('href', `#fnref-${label}-0`)
    back.className = 'footnote-backref'
    back.textContent = '↩'
    back.setAttribute('title', i18n.ui.footnoteBackref)
    el.appendChild(back)
  })
}

/**
 * 导出副本处理：把 `:name:` emoji 短代码替换为 emoji 字符。
 * 跳过 <code>/<pre> 内的文本，避免破坏代码块里的字面量。
 * 与编辑器内 emoji 装饰/输入规则共用 EMOJI_MAP。
 */
export function replaceEmojiInHtml(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement
      while (el) {
        const tag = el.tagName
        if (tag === 'CODE' || tag === 'PRE') return NodeFilter.FILTER_REJECT
        el = el.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const targets: Text[] = []
  let cur: Node | null
  while ((cur = walker.nextNode())) targets.push(cur as Text)

  const re = new RegExp(`:(${EMOJI_NAME_RE.source}):`, 'g')
  for (const t of targets) {
    const value = t.nodeValue ?? ''
    if (!re.test(value)) continue
    re.lastIndex = 0
    const span = document.createElement('span')
    span.innerHTML = value.replace(re, (_full, name: string) => EMOJI_MAP[name] ?? _full)
    t.replaceWith(span)
  }
}

/**
 * 导出副本处理：把所见即所得里由装饰呈现的 `==高亮==` / `^上标^` / `~下标~` / `<kbd>键</kbd>`
 * 转换为语义标签 <mark> / <sup> / <sub> / <kbd>。
 *
 * 为什么需要这一步：编辑区只做"装饰显示"，源码里的 `==…==` 等原样保留（保证 Markdown 往返保真），
 * 因此导出的 view DOM 里这些片段仍是字面文本包裹在 .yj-* 装饰 span 中；这里按内容模式匹配并落地为
 * 真正的语义标签。跳过 <code>/<pre>/<svg>/<mark>/<sup>/<sub>/<kbd> 以免误处理代码、公式 SVG 与已转换节点。
 */
export function replaceInlineMarkupInHtml(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement
      while (el) {
        const tag = el.tagName
        if (
          tag === 'CODE' ||
          tag === 'PRE' ||
          tag === 'SVG' ||
          tag === 'MARK' ||
          tag === 'SUP' ||
          tag === 'SUB' ||
          tag === 'KBD'
        ) {
          return NodeFilter.FILTER_REJECT
        }
        el = el.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const targets: Text[] = []
  let cur: Node | null
  while ((cur = walker.nextNode())) targets.push(cur as Text)

  const quick =
    /==[^\n=]+==|\^[^^\n ]+\^|(?<!~)~[^~\n]+~(?!~)|<kbd>[^<]+<\/kbd>/
  const hl = /==([^\n=]{1,200}?)==/g
  const sup = /\^([^\^\n ]{1,200}?)\^/g
  const sub = /(?<!~)~([^~\n]{1,200}?)~(?!~)/g
  const kbd = /<kbd>([^<]{1,200}?)<\/kbd>/g

  for (const t of targets) {
    const value = t.nodeValue ?? ''
    if (!quick.test(value)) continue
    const html = value
      .replace(hl, '<mark>$1</mark>')
      .replace(sup, '<sup>$1</sup>')
      .replace(sub, '<sub>$1</sub>')
      .replace(kbd, '<kbd>$1</kbd>')
    const span = document.createElement('span')
    span.innerHTML = html
    t.replaceWith(span)
  }
}

/** 把任意「Blob / Buffer / ArrayBuffer / TypedArray」统一成 Uint8Array */
export async function toUint8Array(res: unknown): Promise<Uint8Array> {
  if (res == null) throw new Error('序列化结果为空')
  // 浏览器原生 Blob
  if (typeof Blob !== 'undefined' && res instanceof Blob) {
    return new Uint8Array(await res.arrayBuffer())
  }
  // 已经是 TypedArray
  if (ArrayBuffer.isView(res)) {
    const v = res as ArrayBufferView
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  }
  if (res instanceof ArrayBuffer) return new Uint8Array(res)
  // Node Buffer（渲染进程有 Buffer polyfill）或带 arrayBuffer() 的对象
  const anyRes = res as { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (typeof anyRes.arrayBuffer === 'function') {
    return new Uint8Array(await anyRes.arrayBuffer())
  }
  throw new Error('未知的序列化结果类型')
}
