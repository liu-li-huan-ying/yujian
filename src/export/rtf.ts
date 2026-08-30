/**
 * RTF 序列化：把规范化 HTML 转成 RTF 富文本（1.9.x）。手工构建，无外部依赖。
 * 覆盖标题 / 段落 / 加粗 / 斜体 / 下划线 / 链接 / 列表 / 引用 / 代码 / 图片 / 表格（降级为制表分隔）。
 */
import { parseHtml, rasterizeSvgToImg } from './domUtils'

/** 文本 → RTF 转义（特殊字符 + 非 ASCII 用 \u 转义以支持中文） */
function rtfText(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 92) out += '\\\\'
    else if (c === 123) out += '\\{'
    else if (c === 125) out += '\\}'
    else if (c < 128) out += ch
    else if (c <= 0xffff) {
      // RTF 的 \u 要求是带符号 16 位（-32768~32767）；BMP 内 ≥ U+8000 的码点需转成负值
      const v = c >= 0x8000 ? c - 0x10000 : c
      out += `\\u${v}?`
    } else {
      // 辅助平面（emoji 等）：拆成 UTF-16 代理对各发一个带符号 \u
      const sub = c - 0x10000
      const hi = 0xd800 + (sub >> 10)
      const lo = 0xdc00 + (sub & 0x3ff)
      const hiV = hi >= 0x8000 ? hi - 0x10000 : hi
      const loV = lo >= 0x8000 ? lo - 0x10000 : lo
      out += `\\u${hiV}?\\u${loV}?`
    }
  }
  return out
}

function walkChildren(el: Element, out: string[]): void {
  el.childNodes.forEach((c) => walk(c, out))
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(rtfText(node.textContent || ''))
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const sizes: Record<string, number> = { h1: 32, h2: 28, h3: 26, h4: 24, h5: 22, h6: 20 }
      out.push(`\\pard\\sa240\\sb240\\b\\fs${sizes[tag]} `)
      walkChildren(el, out)
      out.push('\\b0\\par')
      break
    }
    case 'p':
    case 'div':
      out.push('\\pard\\sa160 ')
      walkChildren(el, out)
      out.push('\\par')
      break
    case 'blockquote':
      out.push('\\pard\\li480\\ri480\\sa160 ')
      walkChildren(el, out)
      out.push('\\par')
      break
    case 'pre':
    case 'code':
      out.push('\\pard\\f2\\fs18\\sa120 ')
      out.push(rtfText((el.textContent || '').replace(/\n/g, '\\line')))
      out.push('\\f0\\par')
      break
    case 'strong':
    case 'b':
      out.push('\\b ')
      walkChildren(el, out)
      out.push('\\b0 ')
      break
    case 'em':
    case 'i':
      out.push('\\i ')
      walkChildren(el, out)
      out.push('\\i0 ')
      break
    case 'u':
      out.push('\\ul ')
      walkChildren(el, out)
      out.push('\\ul0 ')
      break
    case 'a': {
      const href = el.getAttribute('href') || ''
      out.push(`{\\field{\\*\\fldinst HYPERLINK "${rtfText(href)}"}{\\fldrslt `)
      walkChildren(el, out)
      out.push('}}')
      break
    }
    case 'ul':
    case 'ol': {
      const isOl = tag === 'ol'
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li')
      items.forEach((li, idx) => {
        const marker = isOl ? `${idx + 1}. ` : '• '
        out.push('\\pard\\li360\\fi-360\\sa80 ')
        out.push(rtfText(marker))
        walkChildren(li, out)
        out.push('\\par')
      })
      break
    }
    case 'li':
      out.push('\\pard\\sa80 ')
      walkChildren(el, out)
      out.push('\\par')
      break
    case 'br':
      out.push('\\line ')
      break
    case 'hr':
      out.push('\\par\\brdrb\\brdrs\\brdrw15\\par')
      break
    case 'img': {
      const src = el.getAttribute('src') || ''
      const m = /^data:([^;]+);base64,(.*)$/.exec(src)
      if (m && m[1].startsWith('image/')) {
        const bin = atob(m[2])
        let hex = ''
        for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
        out.push('\\pard\\qc{\\pict\\pngblip ' + hex + '}\\par')
      }
      break
    }
    case 'table': {
      const rows = Array.from(el.querySelectorAll('tr'))
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('th,td')).map((td) =>
          (td.textContent || '').replace(/\s+/g, ' ').trim()
        )
        out.push('\\pard\\sa60 ')
        out.push(rtfText(cells.join('\t')))
        out.push('\\par')
      }
      break
    }
    default:
      walkChildren(el, out)
  }
}

export async function buildRtf(html: string): Promise<Uint8Array> {
  const doc = parseHtml(html)
  const article = doc.querySelector('article') ?? doc.body
  // 图表需光栅化为 PNG 才能嵌入
  await rasterizeSvgToImg(article)

  const out: string[] = []
  Array.from(article.childNodes).forEach((c) => walk(c, out))
  const body = out.join('').replace(/\r?\n/g, '')

  const rtf =
    `{\\rtf1\\ansi\\ansicpg936\\uc1\\deff0` +
    `{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}` +
    `{\\f1\\fnil\\fcharset0 Times New Roman;}` +
    `{\\f2\\fnil\\fcharset0 Consolas;}}` +
    `\\viewkind4\\uc1\\lang2052\\fs20\n${body}\n}`

  return new TextEncoder().encode(rtf)
}
