export interface OutlineItem {
  /** 标题级别 1~6 */
  level: number
  /** 清理行内格式后的展示文本 */
  text: string
  /** 标题所在行（1-based），用于源码模式跳转 */
  line: number
  /** 在文档中的顺序序号（0-based），用于所见即所得模式按 DOM 顺序跳转与高亮 */
  index: number
}

/** 去掉 Markdown 行内格式，得到干净的展示文本（保留中文与语义） */
function cleanHeading(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1') // 行内代码
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗体 **
    .replace(/\*([^*]+)\*/g, '$1') // 斜体 *
    .replace(/__([^_]+)__/g, '$1') // 粗体 __
    .replace(/_([^_]+)_/g, '$1') // 斜体 _
    .replace(/~~([^~]+)~~/g, '$1') // 删除线
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 → 文字
    .replace(/\s+/g, ' ')
    .trim()
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/
const FENCE_RE = /^\s*(```|~~~)/

/**
 * 从 Markdown 文本解析标题大纲。
 * 跳过围栏代码块内的 `#`（避免把代码里的井号误判为标题），
 * 跳过无文本的空标题。
 */
export function parseOutline(md: string): OutlineItem[] {
  const lines = md.split('\n')
  const items: OutlineItem[] = []
  let inFence = false
  let fenceChar = ''
  let index = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const ch = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceChar = ch
      } else if (fenceChar === ch) {
        inFence = false
        fenceChar = ''
      }
      continue
    }
    if (inFence) continue

    const m = HEADING_RE.exec(line)
    if (!m) continue
    const text = cleanHeading(m[2])
    if (!text) continue

    items.push({ level: m[1].length, text, line: i + 1, index })
    index++
  }

  return items
}
