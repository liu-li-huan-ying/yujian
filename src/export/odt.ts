/**
 * ODT（OpenDocument Text）序列化：手工拼装符合 ODF 1.2 的 .odt 包。
 * 纯 JS / 无外部二进制依赖。Mermaid 图表先光栅化为 PNG 再嵌入（ODT 图片为位图）。
 */
import JSZip from 'jszip'
import { parseHtml, rasterizeSvgToImg, collectImages, escapeXml } from './domUtils'
import type { SerializeCtx } from './serialize'

function odtEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function pxToCm(v: string | null): number {
  if (!v) return 0
  const n = parseFloat(v)
  if (!isFinite(n)) return 0
  return Math.round(n * 0.02646 * 100) / 100
}

function inline(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(odtEscape(node.textContent || ''))
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  switch (tag) {
    case 'strong':
    case 'b':
      out.push('<text:span text:style-name="bold">')
      inlineChildren(el, out)
      out.push('</text:span>')
      break
    case 'em':
    case 'i':
      out.push('<text:span text:style-name="italic">')
      inlineChildren(el, out)
      out.push('</text:span>')
      break
    case 'u':
      out.push('<text:span text:style-name="underline">')
      inlineChildren(el, out)
      out.push('</text:span>')
      break
    case 'code':
      out.push('<text:span text:style-name="mono">')
      out.push(odtEscape(el.textContent || ''))
      out.push('</text:span>')
      break
    case 'br':
      out.push('<text:line-break/>')
      break
    case 'a': {
      const href = el.getAttribute('href') || ''
      out.push(`<text:a xlink:type="simple" xlink:href="${odtEscape(href)}">`)
      inlineChildren(el, out)
      out.push('</text:a>')
      break
    }
    default:
      inlineChildren(el, out)
  }
}
function inlineChildren(el: Element, out: string[]): void {
  el.childNodes.forEach((c) => inline(c, out))
}

function block(node: Node, out: string[], imgs: { name: string }[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent || '').trim()
    if (t) out.push(`<text:p>${odtEscape(t)}</text:p>`)
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
      const lvl = tag[1]
      out.push(`<text:h text:outline-level="${lvl}" text:style-name="Heading${lvl}">`)
      inlineChildren(el, out)
      out.push('</text:h>')
      break
    }
    case 'p':
    case 'div':
      out.push('<text:p>')
      inlineChildren(el, out)
      out.push('</text:p>')
      break
    case 'blockquote':
      out.push('<text:p text:style-name="Quote">')
      inlineChildren(el, out)
      out.push('</text:p>')
      break
    case 'pre':
      out.push('<text:p text:style-name="code">')
      out.push(odtEscape(el.textContent || ''))
      out.push('</text:p>')
      break
    case 'ul':
    case 'ol': {
      out.push('<text:list>')
      Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .forEach((li) => {
          out.push('<text:list-item><text:p>')
          inlineChildren(li, out)
          out.push('</text:p></text:list-item>')
        })
      out.push('</text:list>')
      break
    }
    case 'li':
      out.push('<text:p>')
      inlineChildren(el, out)
      out.push('</text:p>')
      break
    case 'hr':
      out.push('<text:p>————————</text:p>')
      break
    case 'img': {
      const src = el.getAttribute('src') || ''
      const im = imgs.find((i) => src.endsWith(i.name))
      if (im) {
        const w = pxToCm(el.getAttribute('width')) || 15
        const h = pxToCm(el.getAttribute('height')) || 9
        out.push(
          `<draw:frame draw:name="${im.name}" svg:width="${w}cm" svg:height="${h}cm" text:anchor-type="as-char">` +
            `<draw:image xlink:type="simple" xlink:href="Pictures/${im.name}"/></draw:frame>`
        )
      }
      break
    }
    case 'table': {
      out.push('<table:table>')
      Array.from(el.querySelectorAll('tr')).forEach((tr) => {
        out.push('<table:table-row>')
        Array.from(tr.querySelectorAll('th,td')).forEach((cell) => {
          out.push('<table:table-cell>')
          out.push('<text:p>')
          out.push(odtEscape((cell.textContent || '').replace(/\s+/g, ' ').trim()))
          out.push('</text:p>')
          out.push('</table:table-cell>')
        })
        out.push('</table:table-row>')
      })
      out.push('</table:table>')
      break
    }
    default:
      Array.from(el.childNodes).forEach((c) => block(c, out, imgs))
  }
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
<office:styles>
<style:style style:name="Standard" style:family="paragraph"><style:paragraph-properties/><style:text-properties style:font-name="Microsoft YaHei" style:font-size="11pt"/></style:style>
<style:style style:name="Heading" style:family="paragraph"><style:paragraph-properties/><style:text-properties style:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading1" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading2" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="17pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading3" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading4" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading5" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="11pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading6" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="10pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.8cm" fo:margin-right="0.8cm" fo:background-color="#f6f5f1"/></style:style>
<style:style style:name="code" style:family="paragraph"><style:text-properties style:font-name="Consolas" fo:font-size="10pt"/></style:style>
<style:style style:name="bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="underline" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto"/></style:style>
<style:style style:name="mono" style:family="text"><style:text-properties style:font-name="Consolas"/></style:style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="Mpm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Mpm1"/></office:master-styles>
</office:document-styles>`

export async function buildOdt(html: string, ctx: SerializeCtx): Promise<Uint8Array> {
  const doc = parseHtml(html)
  const article = doc.querySelector('article') ?? doc.body
  await rasterizeSvgToImg(article)

  const imgs = collectImages(article)
  // 改写图片 src 为 Pictures/ 内路径，供 ODT 引用
  const imgEls = Array.from(article.querySelectorAll('img'))
  imgEls.forEach((img, i) => {
    if (imgs[i]) img.setAttribute('src', `Pictures/${imgs[i].name}`)
  })

  const body: string[] = []
  Array.from(article.childNodes).forEach((c) => block(c, body, imgs.map((im) => ({ name: im.name }))))
  const bodyXml = body.join('')

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
<office:body><office:text>${bodyXml}</office:text></office:body>
</office:document-content>`

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
<office:meta><dc:title>${escapeXml(ctx.title)}</dc:title>${ctx.author ? `<dc:creator>${escapeXml(ctx.author)}</dc:creator>` : ''}<meta:creation-date>2026-01-01T00:00:00</meta:creation-date></office:meta>
</office:document-meta>`

  const manifestItems = [
    `<manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/>`,
    `<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>`,
    `<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/>`,
    `<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml"/>`,
    ...imgs.map(
      (im) =>
        `<manifest:file-entry manifest:media-type="${im.mime}" manifest:full-path="Pictures/${im.name}"/>`
    )
  ].join('\n')
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
${manifestItems}
</manifest:manifest>`

  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', manifestXml)
  zip.file('content.xml', contentXml)
  zip.file('styles.xml', STYLES_XML)
  zip.file('meta.xml', metaXml)
  for (const im of imgs) zip.file(`Pictures/${im.name}`, im.data)

  return zip.generateAsync({ type: 'uint8array' })
}
