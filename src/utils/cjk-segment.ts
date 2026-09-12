/**
 * 中文（广义 CJK）词边界 —— 批次四「中文分词」的纯函数层，供编辑器双击选词使用。
 *
 * 为什么需要它：ProseMirror 的双击选词按「词字符 / 空白」切分，而中文**词间没有空格**，
 * 于是双击中文往往整段选中（`#标签`、`双击选词` 等处都因此不好用）。
 *
 * 实现选择：直接用浏览器原生 **Intl.Segmenter**（ICU 分词），不引第三方分词库。
 * 理由：零依赖、跨平台一致、与系统输入法 / macOS·Windows 分词同源，也正是 Obsidian / Typora
 * 这类成熟产品采用的路径。代价是中文切分偏保守（「编辑器」可能切成「编辑」+「器」），
 * 但**可预测**，且已彻底解决「整段选中」这个真正的痛点；不为此自造词典。
 *
 * ⚠️ 单测只能断言**不变量**（区间落在文本内、区间内容与切片一致、英文整词可切出等），
 * 不可断言具体中文切分结果 —— ICU 版本升级会微调词典，硬断言会假红。
 */

/**
 * 判定为 CJK 的字符范围：日文假名、中日韩汉字（含扩展 A / 兼容区）、韩文谚文。
 * 一律写 `\u` 转义而非字面字符 —— 裸 CJK 字符区间在编辑器与编码门禁里容易被误伤。
 */
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/

/** CJK 标点与全角符号（不是"词"，但双击落在它上面时也不该整段选中） */
const CJK_PUNCT = /[\u3000-\u303F\uFF00-\uFFEF]/

/**
 * 该字符是否属于 CJK 书写系统（汉字 / 假名 / 谚文 / CJK 标点与全角符号）。
 * 拉丁字母、数字、半角标点返回 false —— 交给编辑器默认逻辑（它对西文处理得很好）。
 */
export function isCjkChar(ch: string): boolean {
  if (!ch) return false
  return CJK.test(ch) || CJK_PUNCT.test(ch)
}

export interface WordRange {
  /** 词首偏移（含） */
  start: number
  /** 词尾偏移（不含） */
  end: number
  /** 词文本，恒等于 `text.slice(start, end)` */
  text: string
}

/** 单个汉字的判定（不含假名 / 谚文 / 标点）—— 仅用于「双字回退」的收紧条件 */
const HAN = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]$/

/**
 * ICU 对**未登录的双字词**常切成两个单字（实测：「开源」→「开」+「源」、
 * 「挤压」→「挤」+「压」、「玉笺」→「玉」+「笺」）。若原样采用，双击中文会有相当比例
 * 只选中一个字，体验打折。
 *
 * 这里做一层**保守**回退：一个「长度 1 的汉字词」，若**紧邻的下一个词也是长度 1 的汉字**，
 * 则合并为一个双字词（中文双字词占多数）。
 *
 * 保守之处：只要相邻段不是单字汉字（更长、或是标点 / 西文 / 空白），就**绝不跨过去合并**——
 * 于是「我」+「喜欢」不会被拼成「我喜」、「编」也不会粘上后面的逗号。
 */
function mergeLoneHan(words: WordRange[], text: string): WordRange[] {
  const out: WordRange[] = []
  let i = 0
  while (i < words.length) {
    const w = words[i]
    const next = words[i + 1]
    if (
      w.end - w.start === 1 &&
      HAN.test(w.text) &&
      next &&
      next.start === w.end && // 紧邻：中间没有空白 / 标点
      next.end - next.start === 1 &&
      HAN.test(next.text)
    ) {
      out.push({ start: w.start, end: next.end, text: text.slice(w.start, next.end) })
      i += 2
      continue
    }
    out.push(w)
    i++
  }
  return out
}

/**
 * 对一段文本分词，只返回「像词」的段（跳过空白与标点），并对未登录的单字做保守双字合并。
 * 运行环境不支持 `Intl.Segmenter` 时返回空数组 —— 调用方据此回退到默认行为，不会崩。
 */
export function segmentWords(text: string): WordRange[] {
  if (!text) return []
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return []
  const seg = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const out: WordRange[] = []
  for (const part of seg.segment(text)) {
    if (!part.isWordLike) continue
    out.push({ start: part.index, end: part.index + part.segment.length, text: part.segment })
  }
  return mergeLoneHan(out, text)
}

/**
 * 取包含 `offset` 的词；落在空白 / 标点上（即不属于任何词）时返回 `null`。
 * `offset` 越界（<0 或 >= length）一律返回 `null`。
 */
export function wordRangeAt(text: string, offset: number): WordRange | null {
  if (!text || offset < 0 || offset >= text.length) return null
  for (const w of segmentWords(text)) {
    if (offset >= w.start && offset < w.end) return w
  }
  return null
}
