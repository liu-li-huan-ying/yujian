/**
 * 大文档分块渲染（批次四 · 大文档性能）
 *
 * 为什么不是「真·虚拟滚动」：ProseMirror 的选区 / IME / 装饰 / 查找全部依赖「文档全量在 DOM」
 * 这一前提；真正的窗口化（只渲染可视块、其余从 DOM 摘除）会破坏 DOM↔doc 的位置映射，
 * 属框架级对抗——需重写 EditorView 的节点映射，风险远大于收益，且与我们的往返保真红线冲突。
 *
 * 采用 Chromium 原生 `content-visibility: auto`：DOM 保持完整，浏览器仅**跳过屏外块的
 * 布局与绘制**——选区、查找、装饰、IME、导出全部不受影响。它是纯 CSS、可整体回退的方案，
 * 且是 Chromium 为「长文档」设计的既定机制（非自造）。间距/尺寸估算配合
 * `contain-intrinsic-size: auto <est>`：浏览器记住已渲染过的真实高度，滚动条不跳变。
 *
 * 自适应：只对**大文档**（`doc.content.size` 超阈值）给 `.ProseMirror` 挂 `.yj-huge-doc`，
 * 普通文档完全不受影响（规避 `content-visibility` 始终带 layout/style/paint 包含的潜在副作用）。
 * 被作用的具体块类型见 `src/styles/editor.css`（仅取不含内联浮层的块：段落 / 标题 / 列表 /
 * 引用 / 分隔线），刻意排除 `.milkdown-code-block` 等自带 `position:absolute` 弹层的组件块。
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'

/** 阈值：`doc.content.size` 超过此值视为大文档（约 2 万字符量级，远超一屏） */
export const HUGE_DOC_THRESHOLD = 20_000

/** 挂在 ProseMirror 根上的类名（CSS 依据） */
export const HUGE_DOC_CLASS = 'yj-huge-doc'

/** 纯函数：由 `doc.content.size` 判定是否大文档（可单测，无 DOM 依赖） */
export function isHugeDoc(contentSize: number, threshold: number = HUGE_DOC_THRESHOLD): boolean {
  return contentSize > threshold
}

export function createHugeDocPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('yujian-huge-doc'),
    view(view) {
      let last = isHugeDoc(view.state.doc.content.size)
      view.dom.classList.toggle(HUGE_DOC_CLASS, last)
      return {
        update(v) {
          // `content.size` 是 O(1)（Fragment 缓存长度），故此处零成本
          const big = isHugeDoc(v.state.doc.content.size)
          if (big === last) return
          last = big
          v.dom.classList.toggle(HUGE_DOC_CLASS, big)
        }
      }
    }
  })
}
