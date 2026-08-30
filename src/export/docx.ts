/**
 * DOCX（Word）序列化简易实现：用 jszip 手工拼装符合 OOXML 的 .docx 包。
 *
 * 为什么不用 html-to-docx：该包在模块顶层 import 了 crypto/fs/path/zlib/stream/http 等一整条
 * Node 内置模块，浏览器里不存在；Vite 会将其 externalize 成空壳，渲染进程启动时求值即崩，
 * 导致整窗漆黑。本实现纯 JS / 零 Node 依赖，与已落地的 ODT/EPUB 同构。
 *
 * Mermaid 的 <svg> 需先经 rasterizeSvgToImg 转成 PNG 位图（Word 不认 SVG）。
 */
import JSZip from 'jszip'
import {
  parseHtml,
  rasterizeSvgToImg,
  collectImages,
  escapeXml
} from './domUtils'
import type { SerializeCtx } from './serialize'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const CP_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
const DC_NS = 'http://purl.org/dc/elements/1.1/'
const DCTERMS_NS = 'http://purl.org/dc/terms/'
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance'
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const EP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'

const wx = escapeXml

/** 图片最大宽度（EMU，≈5.7in，A4 去掉 1in 页边距内可用宽度） */
const MAX_IMG_EMU = 5200000

interface ImgRel {
  rId: string
  name: string
  mime: string
  bytes: Uint8Array
  cx: number
  cy: number
}

/** 从 PNG IHDR 读取像素尺寸（JPEG 等返回 null，走比例回退） */
function pngSize(data: Uint8Array): [number, number] | null {
  if (data.length < 24) return null
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return null
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return [dv.getUint32(16), dv.getUint32(20)]
}

interface RPr {
  b: boolean
  i: boolean
  u: boolean
  mono: boolean
}

function rprStr(p: RPr): string {
  let s = ''
  if (p.b) s += '<w:b/>'
  if (p.i) s += '<w:i/>'
  if (p.u) s += '<w:u w:val="single"/>'
  if (p.mono) {
    s += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
    s += '<w:sz w:val="18"/><w:szCs w:val="18"/>'
  }
  return s
}

function run(rpr: string, text: string): string {
  if (!text) return ''
  const pr = rpr ? `<w:rPr>${rpr}</w:rPr>` : ''
  return `<w:r>${pr}<w:t xml:space="preserve">${wx(text)}</w:t></w:r>`
}

function drawing(rel: ImgRel): string {
  const docPrId = rel.rId.replace(/\D/g, '') || '1'
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${rel.cx}" cy="${rel.cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${rel.name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${rel.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rel.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${rel.cx}" cy="${rel.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
}

export async function buildDocx(html: string, ctx: SerializeCtx): Promise<Uint8Array> {
  const doc = parseHtml(html)
  const article = doc.querySelector('article') ?? doc.body
  await rasterizeSvgToImg(article)

  const imgs = collectImages(article)
  const dataImgEls = Array.from(article.querySelectorAll('img[src^="data:"]')) as HTMLImageElement[]
  const imgRels: ImgRel[] = dataImgEls.map((_el, i) => {
    const im = imgs[i]
    let cx = MAX_IMG_EMU
    let cy = Math.round(MAX_IMG_EMU * 0.75)
    if (im && im.mime === 'image/png') {
      const sz = pngSize(im.data)
      if (sz && sz[0] > 0) {
        const ratio = MAX_IMG_EMU / sz[0]
        cx = MAX_IMG_EMU
        cy = Math.max(1, Math.round(sz[1] * ratio))
      }
    }
    return {
      rId: `rIdImg${i + 1}`,
      name: im ? im.name : `img-${i + 1}.png`,
      mime: im ? im.mime : 'image/png',
      bytes: im ? im.data : new Uint8Array(0),
      cx,
      cy
    }
  })
  const imgMap = new Map<HTMLElement, ImgRel>()
  dataImgEls.forEach((el, i) => imgMap.set(el, imgRels[i]))

  const hyperlinks: { rid: string; href: string }[] = []
  const hyperlinkMap = new Map<string, string>()
  let hyperlinkSeq = 0
  function addHyperlink(href: string): string {
    const clean = href.trim()
    if (!clean) return ''
    const existing = hyperlinkMap.get(clean)
    if (existing) return existing
    const rid = `rIdH${++hyperlinkSeq}`
    hyperlinkMap.set(clean, rid)
    hyperlinks.push({ rid, href: clean })
    return rid
  }

  const base: RPr = { b: false, i: false, u: false, mono: false }

  function runsFrom(node: Node, p: RPr): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || ''
      return t ? run(rprStr(p), t) : ''
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    const np: RPr = { ...p }
    switch (tag) {
      case 'strong':
      case 'b':
        np.b = true
        break
      case 'em':
      case 'i':
        np.i = true
        break
      case 'u':
        np.u = true
        break
      case 'code':
        np.mono = true
        break
      case 'br':
        return '<w:r><w:br/></w:r>'
      case 'img': {
        const rel = imgMap.get(el)
        return rel ? `<w:r>${drawing(rel)}</w:r>` : ''
      }
      case 'a': {
        const href = el.getAttribute('href') || ''
        const rid = addHyperlink(href)
        const inner = Array.from(el.childNodes)
          .map((c) => runsFrom(c, np))
          .join('')
        return rid ? `<w:hyperlink r:id="${rid}">${inner}</w:hyperlink>` : inner
      }
      default:
        break
    }
    return Array.from(el.childNodes)
      .map((c) => runsFrom(c, np))
      .join('')
  }

  function blockToXml(node: Node, level: number): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').trim()
      return t ? `<w:p>${run(rprStr(base), t)}</w:p>` : ''
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
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
        const runs = Array.from(el.childNodes)
          .map((c) => runsFrom(c, base))
          .join('')
        return `<w:p><w:pPr><w:pStyle w:val="Heading${lvl}"/></w:pPr>${runs}</w:p>`
      }
      case 'p':
        return `<w:p>${Array.from(el.childNodes)
          .map((c) => runsFrom(c, base))
          .join('')}</w:p>`
      case 'div':
        return Array.from(el.childNodes)
          .map((c) => blockToXml(c, level))
          .join('')
      case 'blockquote':
        return `<w:p><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr>${Array.from(
          el.childNodes
        )
          .map((c) => runsFrom(c, base))
          .join('')}</w:p>`
      case 'pre': {
        const text = el.textContent || ''
        const lines = text.split('\n')
        const runs = lines
          .map((line, idx) =>
            idx === lines.length - 1 ? run(rprStr({ ...base, mono: true }), line) : run(rprStr({ ...base, mono: true }), line) + '<w:r><w:br/></w:r>'
          )
          .join('')
        return `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${runs}</w:p>`
      }
      case 'ul':
      case 'ol': {
        const numId = tag === 'ol' ? 1 : 2
        let xml = ''
        Array.from(el.children)
          .filter((c) => c.tagName.toLowerCase() === 'li')
          .forEach((li) => {
            const liEl = li as HTMLElement
            const runs = Array.from(liEl.childNodes)
              .filter(
                (n) =>
                  !(
                    n.nodeType === Node.ELEMENT_NODE &&
                    ['ul', 'ol'].includes((n as HTMLElement).tagName.toLowerCase())
                  )
              )
              .map((c) => runsFrom(c, base))
              .join('')
            xml += `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runs}</w:p>`
            Array.from(liEl.children)
              .filter((c) => ['ul', 'ol'].includes(c.tagName.toLowerCase()))
              .forEach((n) => (xml += blockToXml(n, level + 1)))
          })
        return xml
      }
      case 'li':
        return '' // 仅作为 ul/ol 子节点时处理
      case 'hr':
        return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`
      case 'img': {
        const rel = imgMap.get(el)
        return rel ? `<w:p><w:r>${drawing(rel)}</w:r></w:p>` : ''
      }
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'))
        const cells = rows
          .map((tr) => {
            const tcs = Array.from(tr.querySelectorAll('th,td'))
            const tcXml = tcs
              .map((cell) => {
                const runs = Array.from(cell.childNodes)
                  .map((c) => runsFrom(c, base))
                  .join('')
                return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${runs}</w:p></w:tc>`
              })
              .join('')
            return `<w:tr>${tcXml}</w:tr>`
          })
          .join('')
        return `<w:tbl><w:tblPr><w:tblBorders>` +
          `<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
          `<w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
          `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
          `<w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
          `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
          `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>` +
          `</w:tblBorders></w:tblPr>${cells}</w:tbl>`
      }
      default:
        return Array.from(el.childNodes)
          .map((c) => blockToXml(c, level))
          .join('')
    }
  }

  const bodyXml = Array.from(article.childNodes)
    .map((c) => blockToXml(c, 0))
    .join('')

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${bodyXml}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:styles xmlns:w="${W_NS}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>` +
    `<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    headingStyle('1', '36', '240', '120') +
    headingStyle('2', '30', '220', '100') +
    headingStyle('3', '26', '200', '80') +
    headingStyle('4', '22', '180', '60') +
    headingStyle('5', '22', '160', '40') +
    headingStyle('6', '20', '140', '20') +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
    `</w:styles>`

  function headingStyle(lvl: string, sz: string, before: string, after: string): string {
    return `<w:style w:type="paragraph" w:styleId="Heading${lvl}"><w:name w:val="heading ${lvl}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${Number(lvl) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`
  }

  const numberingXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:numbering xmlns:w="${W_NS}">` +
    abstractNum(0, 'decimal', ['%1.', '%1.%2.', '%1.%2.%3.', '%1.%2.%3.%4.', '%1.%2.%3.%4.%5.', '%1.%2.%3.%4.%5.%6.']) +
    abstractNum(1, 'bullet', ['•', 'o', '▪', '•', 'o', '▪']) +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
    `</w:numbering>`

  function abstractNum(id: number, fmt: string, texts: string[]): string {
    const levels = texts
      .map(
        (txt, i) =>
          `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${txt}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(i + 1) * 720}" w:hanging="360"/></w:pPr></w:lvl>`
      )
      .join('')
    return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
  }

  const coreXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<cp:coreProperties xmlns:cp="${CP_NS}" xmlns:dc="${DC_NS}" xmlns:dcterms="${DCTERMS_NS}" xmlns:xsi="${XSI_NS}">` +
    `<dc:title>${wx(ctx.title)}</dc:title>` +
    `<dc:creator>${wx(ctx.author || '玉笺 Markdown 编辑器')}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>` +
    `</cp:coreProperties>`

  const appXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Properties xmlns="${EP_NS}"><Application>玉笺 Markdown 编辑器</Application></Properties>`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="${CT_NS}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    imgRels.map((r) => `<Override PartName="/word/media/${r.name}" ContentType="${r.mime}"/>`).join('') +
    `</Types>`

  const pkgRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_NS}/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${R_NS}/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/>` +
    imgRels
      .map(
        (r) =>
          `<Relationship Id="${r.rId}" Type="${R_NS}/image" Target="media/${r.name}"/>`
      )
      .join('') +
    hyperlinks
      .map(
        (h) =>
          `<Relationship Id="${h.rid}" Type="${R_NS}/hyperlink" Target="${wx(h.href)}" TargetMode="External"/>`
      )
      .join('') +
    `</Relationships>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', pkgRels)
  zip.file('word/document.xml', documentXml)
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/numbering.xml', numberingXml)
  zip.file('word/_rels/document.xml.rels', docRels)
  zip.file('docProps/core.xml', coreXml)
  zip.file('docProps/app.xml', appXml)
  for (const r of imgRels) {
    if (r.bytes.length) zip.file(`word/media/${r.name}`, r.bytes)
  }

  return zip.generateAsync({ type: 'uint8array' })
}
