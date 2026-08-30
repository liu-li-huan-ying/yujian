/**
 * DOCX（Word）序列化：把规范化 HTML 交给 html-to-docx 生成 .docx。
 *
 * 注意：html-to-docx 只接受位图，Mermaid 的 <svg> 需先经 rasterizeSvgToImg 转成 PNG。
 */
import HTMLToDOCX from 'html-to-docx'
import { parseHtml, rasterizeSvgToImg, toUint8Array } from './domUtils'
import type { SerializeCtx } from './serialize'

/** 取 <article> 内部作为正文，去掉无关外壳 */
function articleInner(html: string): string {
  const doc = parseHtml(html)
  const article = doc.querySelector('article') ?? doc.body
  return article.innerHTML
}

export async function buildDocx(html: string, ctx: SerializeCtx): Promise<Uint8Array> {
  const innerDoc = parseHtml(`<div>${articleInner(html)}</div>`)
  await rasterizeSvgToImg(innerDoc)
  const cleanHtml = innerDoc.body.innerHTML

  const res = await (HTMLToDOCX as unknown as (
    htmlString: string,
    header: unknown,
    options: Record<string, unknown>
  ) => Promise<unknown>)(cleanHtml, null, {
    type: 'blob',
    title: ctx.title,
    font: 'Noto Sans SC, Microsoft YaHei, sans-serif',
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
  })

  return toUint8Array(res)
}
