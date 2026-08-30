import mermaid from 'mermaid'

/**
 * 把 Mermaid 图表渲染成内嵌 SVG，让导出产物**不依赖 CDN**、离线也能正确显示。
 * 编辑器内已用 mermaid（代码块预览），这里复用同一套能力，不新增依赖。
 *
 * 渲染失败时返回 null，调用方保留原始代码块——图表退化为代码，文档始终有效。
 */

let counter = 0

/** 渲染一段 mermaid 源码为 SVG 字符串；失败返回 null */
export async function renderMermaidSvg(code: string): Promise<string | null> {
  const text = code.trim()
  if (!text) return null
  try {
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
    // id 必须唯一：mermaid 渲染期间会往文档临时挂节点，重名会互相干扰
    const { svg } = await mermaid.render(`yujian-mmd-${Date.now()}-${counter++}`, text)
    return svg ?? null
  } catch {
    return null
  }
}

/**
 * 把 HTML 中 ```mermaid 代码块替换为内嵌 SVG（导出专用）。
 * 只处理导出产物的副本，绝不触碰编辑器内文档。
 */
export async function embedMermaidSvg(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = Array.from(doc.querySelectorAll('pre code.language-mermaid'))
  for (const code of blocks) {
    const pre = code.parentElement
    if (!pre) continue
    const svg = await renderMermaidSvg(code.textContent ?? '')
    if (!svg) continue // 优雅降级：保留原代码块
    const holder = doc.createElement('div')
    holder.className = 'mermaid'
    holder.innerHTML = svg
    pre.parentNode?.replaceChild(holder, pre)
  }
  return doc.documentElement.outerHTML
}
