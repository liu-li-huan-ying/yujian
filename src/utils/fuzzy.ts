/**
 * 模糊匹配 —— 命令面板 / 快速打开笔记的检索内核。
 *
 * 纯函数、零依赖（不碰 Vue / Electron / DOM），因此可以直接进 `npm run test`
 * 的 Node 门禁（见 scripts/test-core.mjs [M] 段）。
 *
 * 算法选择说明：这里用「贪心子序列 + 打分」，而不是 fuse.js 那套位图/DP。
 * 理由：①仓库本来没有模糊匹配依赖，为一个输入框引一个库不划算（依赖最少化）；
 * ②命令与笔记标题都很短（< 60 字），贪心的结果质量与最优解肉眼无差；
 * ③纯函数可单测，符合本项目「逻辑层必须有断言守着」的规矩。
 */

export interface FuzzyResult {
  /** 得分，越大越优；查询串为空时恒为 0 */
  score: number
  /** 命中字符在 target 中的下标，升序，用于高亮 */
  positions: number[]
}

/** 词边界前导符：命中落在这些字符之后，说明命中了一个「词首」，值得加权 */
const SEPARATORS = new Set([
  '/', '\\', '-', '_', '.', ' ', '\t',
  '·', '、', '，', ',', '。', '；', ';', '：', ':',
  '(', ')', '[', ']', '{', '}', '（', '）', '【', '】',
])

/**
 * 逐字符转小写比较，而不是 `String.toLowerCase()` 整串转换：
 * 个别字符（如土耳其语 İ）小写化后长度会变，整串转换会让下标与原文错位，
 * 高亮位置就画错地方了。逐字符比较天然免疫。
 */
function lower(ch: string): string {
  const c = ch.toLowerCase()
  // 长度变化的极端字符直接当作不匹配，宁可漏也不画错
  return c.length === 1 ? c : ch
}

function isBoundary(target: string, i: number): boolean {
  if (i === 0) return true
  const prev = target[i - 1]
  if (SEPARATORS.has(prev)) return true
  // camelCase 边界：小写紧接大写（如 `openVault` 里的 V）
  const cur = target[i]
  return prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z'
}

/**
 * 子序列模糊匹配。命中返回得分与下标，未命中返回 null。
 *
 * 打分权重（经验值，可测）：连续命中 +4、词首命中 +3、前缀命中 +6；
 * 跨度过长与长文本各扣一点，用于同分排序，不影响「是否命中」。
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query === '') return { score: 0, positions: [] }
  if (query.length > target.length) return null

  const positions: number[] = []
  let score = 0
  let qi = 0
  let prev = -2

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (lower(target[ti]) !== lower(query[qi])) continue
    positions.push(ti)
    score += 1
    if (ti === prev + 1) score += 4 // 连续命中：越连贯越像用户想要的
    if (isBoundary(target, ti)) score += 3 // 词首命中：`openVault` 打 `ov` 也能中
    prev = ti
    qi++
  }

  // 查询串没走完 → 不是 target 的子序列
  if (qi < query.length) return null

  if (positions[0] === 0) score += 6 // 前缀命中权重最高，符合「按开头找」的直觉
  const span = positions[positions.length - 1] - positions[0] + 1
  score -= (span - query.length) * 0.5 // 越紧凑越好
  score -= target.length * 0.02 // 同分时短目标优先

  return { score, positions }
}

export interface RankedItem<T> {
  item: T
  score: number
  positions: number[]
}

/**
 * 对一组条目排序取前 `limit` 条。
 *
 * 空查询不打分、保持原始顺序（此时「顺序」本身就是有意义的信息，
 * 比如命令面板初始展示按分组排列）。排序稳定：同分按原下标，保证结果可复现。
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  limit = 50,
): RankedItem<T>[] {
  if (query.trim() === '') {
    return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }))
  }

  const scored: (RankedItem<T> & { index: number })[] = []
  items.forEach((item, index) => {
    const r = fuzzyMatch(query, getText(item))
    if (r) scored.push({ item, score: r.score, positions: r.positions, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(({ item, score, positions }) => ({ item, score, positions }))
}

export interface TextSegment {
  text: string
  /** true 表示这段是命中字符，渲染时加高亮底衬 */
  hit: boolean
}

/**
 * 把命中位置摊成「连续分段」，供模板逐段渲染。
 *
 * 刻意返回分段数组而不是拼好的 HTML 字符串：拼字符串只能 `v-html`，
 * 而文件名/标题是用户数据，走 v-html 就等于开了 XSS 的口子。
 * 分段渲染既安全，又天然免疫转义问题。
 */
export function highlightSegments(text: string, positions: readonly number[]): TextSegment[] {
  if (positions.length === 0) return [{ text, hit: false }]

  const hits = new Set(positions)
  const out: TextSegment[] = []
  let buf = ''
  let bufHit = hits.has(0)

  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i)
    if (hit !== bufHit && buf !== '') {
      out.push({ text: buf, hit: bufHit })
      buf = ''
    }
    bufHit = hit
    buf += text[i]
  }
  if (buf !== '') out.push({ text: buf, hit: bufHit })
  return out
}
