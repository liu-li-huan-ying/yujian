/**
 * 把导出副本里的 ```mermaid 代码块替换为**内嵌 SVG**，让导出产物不依赖 CDN、离线可正确显示。
 *
 * 渲染能力来自 `src/render/mermaid.ts`（与编辑器预览共用同一份 mermaid 单例与配置路径）——
 * 此前本模块曾自带一份 mermaid 懒加载与 `initialize()`，属重复实现，已合并。
 *
 * 只处理**导出产物的副本**，绝不触碰编辑器内文档。
 * 渲染失败时保留原代码块（图表退化为代码），文档始终有效。
 */
import { renderMermaidSvg } from '../render/mermaid'

/**
 * 导出用配置。
 * - theme 固定浅色：导出产物自带独立样式，不应跟随编辑器当前的明暗模式；
 * - securityLevel 保持 `strict`：导出结果也是自包含 HTML，同样不能让图里的脚本执行。
 */
const EXPORT_MERMAID_OPTS = { theme: 'default', securityLevel: 'strict' } as const

export async function embedMermaidSvg(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = Array.from(doc.querySelectorAll('pre code.language-mermaid'))
  for (const code of blocks) {
    const pre = code.parentElement
    if (!pre) continue
    let svg = ''
    try {
      svg = await renderMermaidSvg(code.textContent ?? '', EXPORT_MERMAID_OPTS)
    } catch {
      svg = '' // 优雅降级：保留原代码块
    }
    if (!svg) continue
    const holder = doc.createElement('div')
    holder.className = 'mermaid'
    holder.innerHTML = svg
    pre.parentNode?.replaceChild(holder, pre)
  }
  return doc.documentElement.outerHTML
}
