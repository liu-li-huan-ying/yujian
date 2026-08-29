/**
 * 写作统计纯函数：汉字数 / 英文词数 / 字符数(含·不含空白) / 阅读时长。
 *
 * 设计：纯函数、无副作用、零依赖，便于在状态栏紧凑读数、统计弹层、选区统计间复用，
 * 也方便单测。阅读时长采用中文 300 字/分、英文 200 词/分的混合线性估算
 * （中文与英文阅读速度不同，单独统计后相加更准）。
 */

export interface TextStats {
  /** 汉字数（CJK 表意文字，含扩展区，不含中文标点） */
  han: number
  /** 英文词数（连续字母序列，含缩写连字符） */
  words: number
  /** 字符总数（含空白，等于 text.length） */
  chars: number
  /** 字符总数（不含空白） */
  charsNoSpace: number
  /** 预计阅读时长（分钟，向上取整，至少 1；空文档为 0） */
  readingMinutes: number
}

const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/g
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g

/** 统计汉字数（CJK 统一表意文字 + 扩展 A + 兼容区） */
export function countHan(text: string): number {
  const m = text.match(HAN_RE)
  return m ? m.length : 0
}

/** 统计英文词数 */
export function countWords(text: string): number {
  const m = text.match(WORD_RE)
  return m ? m.length : 0
}

/** 计算一段文本的全部写作指标 */
export function computeStats(text: string): TextStats {
  const han = countHan(text)
  const words = countWords(text)
  const chars = text.length
  const charsNoSpace = text.replace(/\s/g, '').length
  // 阅读时长：中文 300 字/分 + 英文 200 词/分，混合相加
  const minutes = han / 300 + words / 200
  const readingMinutes = charsNoSpace === 0 ? 0 : Math.max(1, Math.round(minutes))
  return { han, words, chars, charsNoSpace, readingMinutes }
}
