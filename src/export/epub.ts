/**
 * EPUB 3 序列化：用 jszip 手工拼装符合规范的电子书包。
 * 纯 JS / 无外部二进制依赖。Mermaid 图表以内联 <svg> 保留（EPUB 支持 SVG）。
 */
import JSZip from 'jszip'
import { parseHtml, collectImages, escapeXml } from './domUtils'
import type { SerializeCtx } from './serialize'

interface NavItem {
  id: string
  level: number
  text: string
}

function uuidFrom(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `urn:uuid:${h.toString(16).padStart(8, '0')}-yujian-2026-0000-0000-000000000000`
}

/** 目录：从标题生成 EPUB3 nav（扁平列表，按层级缩进） */
function buildNav(items: NavItem[], title: string): string {
  const lis = items
    .map(
      (it) =>
        `<li class="lv${it.level}"><a href="section-001.xhtml#${it.id}">${escapeXml(it.text)}</a></li>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><meta charset="utf-8"/><title>${escapeXml(title)} · 目录</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>${escapeXml(title)} · 目录</h1><ol>${lis}</ol></nav>
</body>
</html>`
}

export async function buildEpub(html: string, ctx: SerializeCtx): Promise<Uint8Array> {
  const doc = parseHtml(html)
  const article = doc.querySelector('article') ?? doc.body

  // 收集并改写图片路径
  const imgs = collectImages(article)
  const imgEls = Array.from(article.querySelectorAll('img'))
  imgEls.forEach((img, i) => {
    if (imgs[i]) img.setAttribute('src', `images/${imgs[i].name}`)
  })

  // 给标题补锚点，供 nav 跳转
  const headings = Array.from(article.querySelectorAll('h1,h2,h3,h4,h5,h6'))
  const navItems: NavItem[] = headings.map((h, i) => {
    const id = `h-${i + 1}`
    h.setAttribute('id', id)
    return { id, level: Number(h.tagName[1]) || 1, text: (h.textContent || '').trim() }
  })

  const bodyXhtml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE html>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">\n` +
    `<head><meta charset="utf-8"/><title>${escapeXml(ctx.title)}</title>` +
    `<link rel="stylesheet" href="style.css"/></head>\n` +
    `<body>${new XMLSerializer().serializeToString(article)}</body>\n</html>`

  const styleCss = `body{font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;line-height:1.75;margin:1em 1.2em;color:#1c1e1f}
h1,h2,h3{line-height:1.3;font-weight:600}
img{max-width:100%;height:auto;display:block;margin:1em auto}
pre{background:#f3f2ee;border:1px solid #e7e6e2;border-radius:8px;padding:12px 14px;overflow:auto}
code{font-family:'Sarasa Mono SC',Consolas,monospace;font-size:.9em;background:#f3f2ee;padding:.1em .35em;border-radius:4px}
blockquote{border-left:3px solid #248077;background:#f6f5f1;margin:1em 0;padding:.4em 1em}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #e7e6e2;padding:6px 10px}
nav ol{list-style:none;padding-left:0}
nav .lv2{padding-left:1.2em}
nav .lv3{padding-left:2.4em}
nav .lv4,nav .lv5,nav .lv6{padding-left:3.4em;font-size:.92em;color:#5b6266}`

  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="section-001" href="section-001.xhtml" media-type="application/xhtml+xml"/>`,
    ...imgs.map(
      (im, i) =>
        `<item id="img-${i + 1}" href="images/${im.name}" media-type="${im.mime}"/>`
    )
  ].join('\n')

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uuidFrom(ctx.title + (ctx.date || ''))}</dc:identifier>
<dc:title>${escapeXml(ctx.title)}</dc:title>
<dc:language>zh-CN</dc:language>
${ctx.author ? `<dc:creator>${escapeXml(ctx.author)}</dc:creator>` : ''}
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
${manifestItems}
</manifest>
<spine>
<itemref idref="section-001"/>
</spine>
</package>`

  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:org:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  const zip = new JSZip()
  // mimetype 须为首个条目且不压缩
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', container)
  zip.file('OEBPS/content.opf', opf)
  zip.file('OEBPS/nav.xhtml', buildNav(navItems, ctx.title))
  zip.file('OEBPS/style.css', styleCss)
  zip.file('OEBPS/section-001.xhtml', bodyXhtml)
  for (const im of imgs) zip.file(`OEBPS/images/${im.name}`, im.data)

  return zip.generateAsync({ type: 'uint8array' })
}
