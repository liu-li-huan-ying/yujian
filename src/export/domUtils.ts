/**
 * 导出用 DOM 工具：在渲染进程（浏览器上下文）里把文档 DOM 变换为目标格式所需的形态。
 *
 * 这些函数操作由 DOMParser 解析出的独立 Document，绝不触碰编辑器内真实文档。
 */

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
