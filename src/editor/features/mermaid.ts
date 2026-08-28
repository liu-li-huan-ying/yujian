import type { CodeBlockConfig } from '@milkdown/kit/component/code-block'

/**
 * Mermaid 图表渲染 —— 挂在 Crepe 代码块的 `renderPreview` 钩子上。
 *
 * 为什么不用自研 NodeView（架构 §5.3 的原方案）：
 *   代码块组件本身就提供了 preview 契约，直接接管预览区即可。
 *   文档里依然是一个普通的 ```mermaid 代码块 —— 不改 schema、不换 NodeView，
 *   序列化完全不受影响。对「Markdown 往返保真」这条红线来说，这是零风险做法。
 */

type MermaidApi = (typeof import('mermaid'))['default']
type RenderPreview = CodeBlockConfig['renderPreview']

/** 输入过程中语法往往不完整，防抖避免每敲一个字符就重渲染 */
const DEBOUNCE_MS = 400

let mermaidPromise: Promise<MermaidApi> | null = null
let appliedTheme: string | null = null
let seq = 0

/** mermaid 体积很大，动态引入，不拖慢首屏 */
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid)
  return mermaidPromise
}

/** 图表配色跟随应用明暗模式 */
async function ensureMermaid(): Promise<MermaidApi> {
  const mermaid = await loadMermaid()
  const theme = document.documentElement.dataset.mode === 'light' ? 'default' : 'dark'

  if (theme !== appliedTheme) {
    mermaid.initialize({
      startOnLoad: false,
      // 严格模式：净化渲染输出，防止不可信 markdown 里的脚本被执行
      securityLevel: 'strict',
      theme
    })
    appliedTheme = theme
  }

  return mermaid
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function errorHtml(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return `<div class="mermaid-error"><strong>图表语法有误</strong><p>${escapeHtml(message)}</p></div>`
}

async function renderSvg(code: string): Promise<string> {
  const mermaid = await ensureMermaid()
  const id = `mermaid-${Date.now()}-${seq++}`

  // mermaid 需要真实容器来测量尺寸；用离屏容器，量完立刻销毁
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-9999px;top:0'
  document.body.appendChild(container)

  try {
    const { svg } = await mermaid.render(id, code, container)
    return svg
  } finally {
    container.remove()
    // 解析失败时 mermaid 可能往 body 里塞一个错误图，一并清掉
    document.getElementById(`d${id}`)?.remove()
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
/** 自增令牌：只认最后一次请求的结果，杜绝慢渲染覆盖新渲染 */
let token = 0

export const renderPreview: RenderPreview = (language, content, applyPreview) => {
  if (language !== 'mermaid') return null

  if (!content.trim()) {
    applyPreview(null)
    return null
  }

  const mine = ++token
  if (timer) clearTimeout(timer)

  timer = setTimeout(() => {
    void renderSvg(content)
      .then((svg) => {
        if (mine === token) applyPreview(svg)
      })
      .catch((err: unknown) => {
        if (mine === token) applyPreview(errorHtml(err))
      })
  }, DEBOUNCE_MS)

  // 返回 undefined → 组件进入异步模式：保留上一张图（或显示 loading），
  // 等 applyPreview 回调再替换
}
