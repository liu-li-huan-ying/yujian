import { markdownLineEnding } from 'micromark-util-character'

/**
 * 内联标记语法：`~下标~` / `^上标^` / `==高亮==` —— micromark + mdast 扩展。
 *
 * 为什么必须做「真节点」而不是装饰：
 *   1. gfm 的删除线 `singleTilde` 默认为 `true`，会把单个 `~` 当成删除线解析，
 *      切回源码时被规范化成 `~~` —— 用户改 `~~`→`~` 又被写回 `~~`，源码被污染。
 *   2. 即便关掉 singleTilde，`mdast-util-gfm-strikethrough` 仍静态注册了
 *      `unsafe: [{character:'~', inConstruct:'phrasing'}]`，序列化时会把 `~` 转义成 `\~`。
 *   只有让「序列化由节点自己的 handler 输出定界符」才能绕开转义，做到往返保真。
 *
 * 因此这里：解析时把 `~x~` 整体吃掉、产出叶子节点（value 存内容），
 * 序列化时由 inlineMarksHandlers() 原样输出 `~` + value + `~`。
 *
 * 本文件刻意**不 import 任何 Milkdown 模块** —— 纯 remark 扩展，可在 Node 里直接跑测试验证。
 */

export type InlineMarkName = 'sub' | 'sup' | 'mark'

interface Spec {
  name: InlineMarkName
  char: number
  /** 定界符是双字符（==）还是单字符（~ / ^） */
  double: boolean
}

const TILDE = 126 // ~
const CARET = 94 // ^
const EQUALS = 61 // =
const SPACE = 32

const SPECS: Spec[] = [
  { name: 'sub', char: TILDE, double: false },
  { name: 'sup', char: CARET, double: false },
  { name: 'mark', char: EQUALS, double: true }
]

/**
 * 叶子式内联标记的分词器：从开定界符一路吃到闭定界符。
 * 内容里不允许出现定界符本身（遇到即视为闭合），也不跨行。
 * `solid` 要求至少一个非空白字符，避免 `~~` / `====` 这种空标记误命中。
 */
function makeTokenizer(spec: Spec) {
  const { name, char, double } = spec
  const marker = name + 'Marker'

  return function (effects: any, ok: any, nok: any) {
    let solid = false

    return start

    function start(code: number) {
      if (code !== char) return nok(code)
      effects.enter(marker)
      effects.consume(code)
      return double ? openSecond : opened
    }

    function openSecond(code: number) {
      if (code !== char) return nok(code)
      effects.consume(code)
      return opened
    }

    function opened(code: number) {
      effects.exit(marker)
      effects.enter(name)
      return content(code)
    }

    function content(code: number) {
      if (code === null || markdownLineEnding(code)) return nok(code)
      if (code === char) {
        effects.exit(name)
        effects.enter(marker)
        effects.consume(code)
        if (!double) {
          effects.exit(marker)
          return solid ? ok(code) : nok(code)
        }
        return closeSecond
      }
      if (code !== SPACE) solid = true
      effects.consume(code)
      return content
    }

    function closeSecond(code: number) {
      if (code !== char) return nok(code)
      effects.consume(code)
      effects.exit(marker)
      return solid ? ok(code) : nok(code)
    }
  }
}

/** micromark 语法扩展：注册 `~` / `^` / `=` 三个行内构造 */
export function inlineMarksSyntax(): any {
  const text: Record<number, any> = {}
  for (const spec of SPECS) {
    text[spec.char] = { name: spec.name, tokenize: makeTokenizer(spec) }
  }
  return { text }
}

/**
 * mdast 构造扩展：行内标记 token → `{type, value}` 叶子节点。
 *
 * 注意 `this.exit(token)` **不返回节点**（它只出栈并补 position.end），
 * 所以要在 enter 时把节点存进 `this.data` 上的栈，exit 时取出回填 value。
 * 用栈而非单变量，保证即使出现嵌套也不会串味。
 */
export function inlineMarksFromMarkdown(): any {
  const enter: Record<string, any> = {}
  const exit: Record<string, any> = {}
  const KEY = '__inlineMarks'

  for (const spec of SPECS) {
    enter[spec.name] = function (this: any, token: any) {
      const node = { type: spec.name, value: '' }
      this.enter(node, token)
      const stack: any[] = (this.data[KEY] ||= [])
      stack.push(node)
    }
    exit[spec.name] = function (this: any, token: any) {
      const stack: any[] = (this.data[KEY] ||= [])
      const node = stack.pop()
      if (node) node.value = this.sliceSerialize(token)
      this.exit(token)
    }
  }

  return { enter, exit }
}

/** remark-stringify 的 handlers：由节点自己输出定界符，不经过 safe() 转义 */
export function inlineMarksHandlers(): Record<string, any> {
  const handlers: Record<string, any> = {}
  for (const spec of SPECS) {
    const d = String.fromCharCode(spec.char).repeat(spec.double ? 2 : 1)
    handlers[spec.name] = (node: any) => d + String(node?.value ?? '') + d
  }
  return handlers
}

/**
 * remark 插件：把「语法扩展 / mdast 扩展 / 序列化 handler」三件套挂到 processor.data() 上。
 *
 * 序列化 handler 走 `data('toMarkdownExtensions')` —— 这是 remark 官方扩展通道
 * （remark-gfm 自己就是这么做的，remark-stringify 内部 `self.data('toMarkdownExtensions')`
 * 直接喂给 toMarkdown）。相比去改 Milkdown 的 remarkStringifyOptionsCtx，这条路不依赖
 * 任何插件注册时序，必然生效。
 *
 * 这一步不可省：没有这些 handler，remark-stringify 遇到 sub/sup/mark 节点会直接抛
 * `Cannot handle unknown node`，含上下标的文档在保存时就会崩。
 */
export function remarkInlineMarks(this: any): void {
  const data = this.data()
  const mm: any[] = data.micromarkExtensions || (data.micromarkExtensions = [])
  const fm: any[] = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  const tm: any[] = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])

  mm.push(inlineMarksSyntax())
  fm.push(inlineMarksFromMarkdown())
  tm.push({ handlers: inlineMarksHandlers() })
}
