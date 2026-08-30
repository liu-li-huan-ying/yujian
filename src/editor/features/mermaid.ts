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

  // mermaid 需要真实容器来测量尺寸；用离屏容器，量完立刻销毁。
  // 注意：容器必须有实际宽度，否则 SVG 测量为 0 会导致渲染异常或文字重叠。
  const container = document.createElement('div')
  container.style.cssText =
    'position:absolute;left:-9999px;top:0;width:800px;height:auto;visibility:hidden'
  container.setAttribute('aria-hidden', 'true')
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

/**
 * 每个代码块实例的预览回调（applyPreview）是各自独立的闭包，用它作键，
 * 给每个图维护自己独立的「防抖定时器 + 结果令牌」。
 *
 * 关键：之前用模块级共享的 timer / token —— 多个图并存时，新图的渲染会清掉
 * 旧图的定时器、且旧图的结果令牌被判失效被丢弃，于是「只有最后渲染的那张图能出来，
 * 其余都消失」，即用户说的『多个图放在一起渲染能力很弱』。改为按块隔离后，
 * 任意数量的图都能各自独立、正确地渲染。
 */
const blockState = new WeakMap<(v: string | null) => void, { timer: ReturnType<typeof setTimeout> | null; token: number }>()

export const renderPreview: RenderPreview = (language, content, applyPreview) => {
  if (language !== 'mermaid') return null

  if (!content.trim()) {
    applyPreview(null)
    return null
  }

  let st = blockState.get(applyPreview)
  if (!st) {
    st = { timer: null, token: 0 }
    blockState.set(applyPreview, st)
  }
  const mine = ++st.token
  if (st.timer) clearTimeout(st.timer)

  st.timer = setTimeout(() => {
    void renderSvg(content)
      .then((svg) => {
        if (mine === st!.token) applyPreview(svg)
      })
      .catch((err: unknown) => {
        if (mine === st!.token) applyPreview(errorHtml(err))
      })
  }, DEBOUNCE_MS)

  // 返回 undefined → 组件进入异步模式：保留上一张图（或显示 loading），
  // 等 applyPreview 回调再替换
}
