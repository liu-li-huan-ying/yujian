import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/**
 * 内联标记装饰：在所见即所得里把 Markdown 的 `==高亮==`、`^上标^`、`~下标~`
 * 以对应样式呈现，但**不改动文档源码**——装饰层只负责"显示"，源文本原样保留在模型里，
 * 因此不引入任何新 schema，Markdown 往返保真红线不受影响。
 *
 * 导出 HTML 时由 domUtils.replaceInlineMarkupInHtml 把这些装饰区间转换为语义标签
 * （<mark> / <sup> / <sub>），详见该函数的说明。
 *
 * 与 emoji 装饰同一思路：编辑区仅做视觉呈现，导出副本才落地为真实标签。
 *
 * <kbd> 与任意内联 HTML 由 htmlInline 节点承载（features/htmlInline.ts），不在此装饰，
 * 以免把代码块里的 <kbd> 字面量误装饰。
 *
 * 跳过代码块 / 行内代码 / 数学节点，避免把代码与公式里的字面量误装饰。
 */

interface MarkupSpec {
  cls: string
  re: RegExp
}

const SPECS: MarkupSpec[] = [
  // 高亮：==文本==（MarkText / Typora 约定）
  { cls: 'yj-hl', re: /==([^\n=]{1,200}?)==/g },
  // 上标：^文本^（不与行首 ^ 锚点、公式 ^ 冲突：内部不含 ^ 与空格）
  { cls: 'yj-sup', re: /\^([^\^\n ]{1,200}?)\^/g },
  // 下标：~文本~（单波浪线；前后不接 ~ 以免误吞 GFM ~~删除线~~）
  { cls: 'yj-sub', re: /(?<!~)~([^~\n]{1,200}?)~(?!~)/g }
]

const key = new PluginKey('yujian-inline-markup')

export function inlineMarkupDecorationPlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      decorations(state) {
        const decos: Decoration[] = []
        state.doc.descendants((node, pos, parent) => {
          if (parent) {
            const t = parent.type.name
            if (t === 'code_block' || t === 'code_inline' || t === 'math_inline') return
          }
          if (!node.isText || !node.text) return
          const text = node.text
          for (const spec of SPECS) {
            // 每次用全新正则实例，避免 lastIndex 跨文本节点串扰
            const re = new RegExp(spec.re.source, spec.re.flags)
            let m: RegExpExecArray | null
            while ((m = re.exec(text))) {
              const from = pos + m.index
              const to = from + m[0].length
              decos.push(Decoration.inline(from, to, { class: spec.cls }))
              // 防零宽匹配死循环
              if (m.index === re.lastIndex) re.lastIndex++
            }
          }
        })
        return DecorationSet.create(state.doc, decos)
      }
    }
  })
}
