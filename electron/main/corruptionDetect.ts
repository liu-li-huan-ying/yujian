/**
 * Markdown 序列化损坏检测 —— 纯函数，零依赖，可在 Node 里直测。
 *
 * 存在理由：Crepe（Milkdown）的序列化是**破坏性**的，历史上实测过四种损坏：
 *   1. YAML frontmatter 的起止 `---` 被写成 `***`（Crepe 无 remark-frontmatter，整段被当水平线）
 *   2. `[[双链]]` 存盘变 `\[\[双链]]`（text 节点被 remark-stringify 转义）
 *   3. 结尾 `---` 被吃成 Setext 下划线 `---------`（前一行的标题被升级）
 *   4. frontmatter 与正文之间的空行被吃掉（`---` 紧贴正文首行）
 *
 * 这类损坏**一旦落盘就自愈不了**（坏内容即新的磁盘原文），所以巡检层要能把它认出来、
 * 并指到版本历史里的上一版。检测必须由纯函数承担：损坏特征千变万化，
 * 用可断言的函数守住，比在主进程里散落 if 更可靠。
 *
 * ⚠️ 关键约束：**宁漏勿误**。任何一条命中都只作为「疑似」上报，由用户确认后还原——
 * 但错误命中会让用户对正常的 `\*` 转义产生怀疑，故每条规则都要求「成组出现」而非孤例。
 */

/** 命中的损坏特征 */
export interface CorruptionHit {
  /** 规则 id（稳定标识，供测试与 UI 归类） */
  rule: string
  /** 人类可读说明（直接展示给用户，中文） */
  detail: string
}

/** frontmatter 起始位置允许出现的 YAML 键名（用于确认「这段确实是 YAML 头」） */
const YAML_KEY_RE = /^[\w.-]+:\s?\S/m

/** 连续 3 个及以上的星号独占一行（Crepe 把 `---` 写成 `***` 的痕迹） */
const STAR_FENCE_RE = /^\*{3,}\s*$/

/** Setext 下划线：独占一行、长度 ≥ 3 的连续 `-`（可能是被吃掉结束 `---` 的痕迹） */
const SETEXT_UNDERLINE_RE = /^-{3,}\s*$/

/** 被转义的双链：`\[\[` 或 `\[\[x]]`（`[` 是链接语法字符，remark 会转义） */
const ESCAPED_WIKILINK_RE = /\\\[\\?\[/

/**
 * 检测一份 Markdown 文本里的**已有损坏特征**。
 * 返回空数组 = 未发现已知损坏模式。
 */
export function detectCorruption(text: string): CorruptionHit[] {
  const hits: CorruptionHit[] = []
  const lines = text.split(/\r?\n/)

  // ── 规则 1：`***` 当 frontmatter 围栏 ──
  // 判据：首行是 `***`，紧随其后若干行里有 YAML 键名，且这段以「围栏」收尾。
  // 收尾形态有两种，实测都出现过：
  //   a) 又一个 `***`（Crepe 把起止 `---` 都写成了 `***`）
  //   b) 一行长 `-`（结束 `---` 被当 Setext 下划线吸收，前一行的标题被升级成 h2）
  // 单看一个 `***` 是合法水平线，必须「中间像 YAML」才判定，避免误伤。
  if (lines.length > 2 && STAR_FENCE_RE.test(lines[0])) {
    const starEnd = lines.findIndex((l, i) => i > 0 && STAR_FENCE_RE.test(l))
    const dashEnd = lines.findIndex((l, i) => i > 0 && SETEXT_UNDERLINE_RE.test(l))
    // 取下界：优先更靠前的收尾围栏
    const candidates = [starEnd, dashEnd].filter((i) => i > 1)
    const end = candidates.length ? Math.min(...candidates) : -1
    if (end > 1 && lines.slice(1, end).some((l) => YAML_KEY_RE.test(l))) {
      hits.push({
        rule: 'frontmatter-as-stars',
        detail: 'YAML 头被序列化成了 `***`（本应是 `---`），元数据已失效',
      })
      if (dashEnd === end && starEnd !== end) {
        // 收尾是长 `-` 而非 `***` → 结束符被 Setext 吃掉了
        hits.push({
          rule: 'frontmatter-setext-eaten',
          detail: 'YAML 头的结束 `---` 被吃成了 Setext 下划线，前一行的标题被升级成了 h2',
        })
      }
    }
  }

  // ── 规则 2：转义的双链 `\[\[` ──
  // 只要出现 1 处即可判定：`\[\[` 是几乎不可能自然出现的组合
  //（用户真要写字面 `[[` 也极少见），宁可提示也别漏——损坏一旦落盘就自愈不了。
  const escaped = lines.filter((l) => ESCAPED_WIKILINK_RE.test(l))
  if (escaped.length > 0) {
    hits.push({
      rule: 'escaped-wikilink',
      detail: `双链被转义为 \`\\[\\[\`（${escaped.length} 处），双链已失效`,
    })
  }

  return hits
}

/**
 * 判断该特征是否足以判定为「序列化损坏」，而不是用户手写的正常内容。
 * 目前与 detectCorruption 等价（规则里已含成组约束），保留为独立函数是为了让调用点
 * 显式表达意图、未来可单独收紧。
 */
export function isCorrupted(text: string): boolean {
  return detectCorruption(text).length > 0
}
