/**
 * 中文自然排序（纯函数，零依赖）：把字符串拆成 token，数值段按值比较、文字段按语种比较。
 * 补齐 Intl.Collator 的 numeric 只认阿拉伯数字、不认中文数字词（一/十/百/万）的短板。
 */

/**
 * 以人为本的自然排序（中文章节感知版）：
 * 把字符串拆成 token，数值段（阿拉伯数字串 **与** 中文数字词「一/五/七/十/百…」）按数值比较，
 * 文字段按语种（中文拼音 / 英文字母）比较。从而
 *   - 阿拉伯数字按值：「第2章」<「第10章」
 *   - 中文数字词按值：「第一章」<「第五章」<「第七章」<「第十章」<「第二十章」
 *   - 文字按拼音、英文按字母，sensitivity:'base' 忽略大小写与重音
 * 与 Windows 资源管理器 / macOS Finder 一致，且补齐了 localeCompare(numeric:true) 不认识中文数字词的短板。
 *
 * 设计依据（网络调研）：MDN / 多篇博客 / 开源库 chinese_number_to_digits 一致指出
 * Intl.Collator 的 numeric 仅处理阿拉伯数字，中文章节排序需「中文数字→阿拉伯数值」后自然排序。
 */
const cnDigit: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 貳: 2,
  三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6,
  七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9,
}
const cnUnit: Record<string, number> = {
  十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000,
  万: 10000, 萬: 10000, 亿: 100000000,
}
function isCnNum(ch: string): boolean {
  return ch in cnDigit || ch in cnUnit
}
/** 中文数字词 → 阿拉伯数值（覆盖 十/百/千/万/亿，含「一十」「二十」「一千二百三十四」等） */
function parseCnNumber(s: string): number {
  if (!s) return 0
  let total = 0 // 已完成 万/亿 分组的累计值
  let group = 0 // 当前分组（万以内）累计值
  let current = 0 // 正在构造的个位数
  for (const ch of s) {
    if (ch in cnDigit) {
      current = cnDigit[ch]
    } else {
      const unit = cnUnit[ch]
      if (unit >= 10000) {
        group = (group + current) * unit
        total += group
        group = 0
        current = 0
      } else {
        // 十/百/千：孤立即当 1×unit（「十」=10、「百」=100、「一千」=1000）
        group += (current === 0 ? 1 : current) * unit
        current = 0
      }
    }
  }
  return total + group + current
}

type Token = { num: boolean; value: number; raw: string }
function tokenize(s: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch >= '0' && ch <= '9') {
      let buf = ''
      while (i < s.length && s[i] >= '0' && s[i] <= '9') buf += s[i++]
      tokens.push({ num: true, value: parseInt(buf, 10), raw: buf })
    } else if (isCnNum(ch)) {
      let buf = ''
      while (i < s.length && isCnNum(s[i])) buf += s[i++]
      tokens.push({ num: true, value: parseCnNumber(buf), raw: buf })
    } else {
      let buf = ''
      while (i < s.length && !(s[i] >= '0' && s[i] <= '9') && !isCnNum(s[i])) buf += s[i++]
      tokens.push({ num: false, value: 0, raw: buf })
    }
  }
  return tokens
}

const literalCollator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' })
export function humanCompare(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  const n = Math.max(ta.length, tb.length)
  for (let k = 0; k < n; k++) {
    const xa = ta[k]
    const xb = tb[k]
    if (!xa) return -1
    if (!xb) return 1
    if (xa.num && xb.num) {
      if (xa.value !== xb.value) return xa.value - xb.value
    } else {
      // 两端类型不同（数值 vs 文字），或同为文字 → 按语种比较原始片段
      const r = literalCollator.compare(xa.raw, xb.raw)
      if (r !== 0) return r
    }
  }
  return 0
}
