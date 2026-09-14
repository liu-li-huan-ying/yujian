import type { CodeBlockConfig } from '@milkdown/kit/component/code-block'
import { escapeXml } from '../../utils/html'
import { i18n } from '../../i18n'
import { errMsg } from '../../../electron/shared/error'
import { renderMermaidSvg } from '../../render/mermaid'

/**
 * Mermaid 在编辑器内的接线 —— Crepe 代码块的 `renderPreview` 钩子。
 *
 * 渲染能力本身在 `src/render/mermaid.ts`（与导出共用同一份 mermaid 单例）。
 * 本模块只管三件编辑器特有的事：**语言判定、输入防抖、按代码块隔离状态与错误降级**。
 *
 * 为什么不用自研 NodeView（架构 §5.3 的原方案）：
 *   代码块组件本身就提供了 preview 契约，直接接管预览区即可。
 *   文档里依然是一个普通的 ```mermaid 代码块 —— 不改 schema、不换 NodeView，
 *   序列化完全不受影响。对「Markdown 往返保真」这条红线来说，这是零风险做法。
 */

type RenderPreview = CodeBlockConfig['renderPreview']

/** 输入过程中语法往往不完整，防抖避免每敲一个字符就重渲染 */
const DEBOUNCE_MS = 400

/** 图表配色跟随应用明暗模式 */
const themeOf = (): 'default' | 'dark' =>
  document.documentElement.dataset.mode === 'light' ? 'default' : 'dark'

function errorHtml(err: unknown): string {
  const message = errMsg(err)
  return `<div class="mermaid-error"><strong>${i18n.ui.mermaidError}</strong><p>${escapeXml(message)}</p></div>`
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
const blockState = new WeakMap<
  (v: string | null) => void,
  { timer: ReturnType<typeof setTimeout> | null; token: number }
>()

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
    void renderMermaidSvg(content, { theme: themeOf(), securityLevel: 'strict' })
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
