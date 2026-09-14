/**
 * Mermaid 渲染引擎 —— **全项目唯一的一份 mermaid 懒加载单例**。
 *
 * 为什么必须唯一：mermaid 是一个**全局单例对象**，`initialize()` 改的是它的全局配置。
 * 此前编辑器与导出各自写了一份 `loadMermaid()` + 各自的 `initialize()`，两处配置
 * （theme / securityLevel）互不相干地覆盖同一份全局状态，极易漂移；而本项目
 * 有一条既定原则——「编辑器里看到的必须与导出的结果一致」（MathJax 正是为此共用
 * `src/render/mathjax.ts`）。mermaid 这里同样贯彻。
 *
 * 分工：
 *   - 本模块 = 引擎（加载 + 配置 + 渲染成 SVG 字符串），与编辑器、与导出都无关；
 *   - `src/editor/features/mermaid.ts` = 代码块预览钩子（防抖、按块隔离、错误降级）；
 *   - `src/export/embedMermaid.ts` = 把导出副本里的 ```mermaid 代码块替换为内嵌 SVG。
 *
 * 渲染失败由**调用方**决定降级方式（编辑器显示错误徽标、导出保留原代码块），
 * 故本模块只抛错 / 返回 null，不自行决定 UI 文案。
 */

/** mermaid 体积很大，惰性动态引入，不拖慢首屏（也避免被静态拽进主包） */
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null

/** 图表文字统一用品牌等宽字体（与编辑器其余特殊格式一致）；末尾 mono 兜底 */
export const MERMAID_FONT =
  "'Maple Mono', ui-monospace, 'Sarasa Mono SC', Consolas, monospace"

export interface MermaidRenderOptions {
  /** 配色：编辑器跟随应用明暗；导出文档默认浅色 */
  theme: 'default' | 'dark'
  /**
   * 安全级别。
   * - 编辑器内必须 `strict`（净化渲染输出，防止不可信 markdown 里的脚本被执行）；
   * - 导出产物是自包含 HTML，同样应保持 `strict`。
   */
  securityLevel: 'strict' | 'loose'
}

/** 渲染 id 自增后缀：mermaid 渲染期间会往文档临时挂节点，重名会互相干扰 */
let seq = 0

async function loadMermaid(): Promise<typeof import('mermaid')['default']> {
  mermaidPromise ??= import('mermaid').then(({ default: m }) => m)
  return mermaidPromise
}

/** 已下发的配置签名：相同配置不重复 `initialize()`（它会改全局状态，且非幂等开销） */
let appliedConfig: string | null = null

/**
 * 渲染一段 mermaid 源码为 SVG 字符串。
 *
 * 失败时**抛出**（与 `renderMathToSvg` 的降级策略不同：公式降级成行内徽标最自然，
 * 图表没有「半张图」的概念，故由调用方决定显示错误还是回退成代码块）。
 *
 * 用离屏容器渲染：mermaid 需要真实元素来测量尺寸，容器**必须有实际宽度**，
 * 否则 SVG 量出 0 宽会导致文字重叠。量完立即销毁。
 */
export async function renderMermaidSvg(
  code: string,
  opts: MermaidRenderOptions
): Promise<string> {
  const text = code.trim()
  if (!text) return ''

  const mermaid = await loadMermaid()
  const key = `${opts.theme}|${opts.securityLevel}`
  if (key !== appliedConfig) {
    mermaid.initialize({
      startOnLoad: false,
      theme: opts.theme,
      securityLevel: opts.securityLevel,
      fontFamily: MERMAID_FONT,
    })
    appliedConfig = key
  }

  const id = `yujian-mmd-${Date.now()}-${seq++}`
  const container = document.createElement('div')
  container.style.cssText =
    'position:absolute;left:-9999px;top:0;width:800px;height:auto;visibility:hidden'
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)

  try {
    const { svg } = await mermaid.render(id, text, container)
    return svg ?? ''
  } finally {
    container.remove()
    // 解析失败时 mermaid 可能往 body 里塞一个错误图，一并清掉
    document.getElementById(`d${id}`)?.remove()
  }
}
