/**
 * 搜索正则构造 —— **三进程共享的单一来源**。
 *
 * 为什么放在 `electron/shared/` 而不是 `src/utils/`：主进程的库级搜索（`vault.ts`）
 * 与渲染层的编辑器内搜索（`find-wysiwyg` / `find-source`）必须用同一套正则语义，
 * 否则「全词匹配」在两边行为会分叉。而 `src/` 属渲染层，主进程 import 它会破坏
 * 三进程边界（主进程构建会被渲染层的 DOM 依赖拖崩）。
 * `shared/` 是双方都够得着、且互不依赖的中立位置——与 `ipc-channels` /
 * `wikilink-syntax` 同属一类：**跨进程契约**。
 */

/** 把字符串转义为正则字面量，避免用户输入里的 . * + 等被当作元字符 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Unicode 词字符类：覆盖所有「字母」（含中日韩汉字 / 日文假名 / 韩文谚文）/ 数字 + 下划线。
 *
 * 为什么不用原生 `\b`：JS 的 `\b` 只认 ASCII 词（`[A-Za-z0-9_]`），CJK 一律算「非词」，
 * 导致「全词匹配」开时 `\b开\b` 仍会在「开源」里命中「开」（两侧都不是 ASCII 词 → 被当成边界）。
 * 这里用显式 lookbehind / lookahead，把 CJK 也当作词字符，使「全词匹配」对中英文一致生效。
 * 该写法需要 `u` 标志（见下）。
 */
const WORD_CHAR = '[\\p{L}\\p{N}_]'

/** 按选项构造搜索正则：wholeWord 加「Unicode 词边界」，caseSensitive 控制大小写。
 *  regex=true 时 query 直接作为正则表达式（非法时降级为转义字面量，避免整次高亮失败）。
 *
 * 其中 `wholeWord` 此前用 `\b`，对中文是空操作；现改为「Unicode 词边界」，
 * 中文的「全词匹配」才真正生效（见上方 WORD_CHAR 注释）。`u` 标志仅在需要 `\p{}` 时出现，
 * 不影响纯拉丁匹配的既有行为。 */
export function buildRegex(
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  regex = false,
): RegExp {
  const flags = caseSensitive ? '' : 'i'
  if (regex) {
    try {
      return new RegExp(query, `${flags}g`)
    } catch {
      return new RegExp(escapeRegExp(query), `${flags}g`)
    }
  }
  let pattern = escapeRegExp(query)
  if (wholeWord) {
    // 词边界需 `u` 标志才能解析 `\p{L}`；同时保留 `g` 供装饰层逐次 exec 扫描
    pattern = `(?<!${WORD_CHAR})${pattern}(?!${WORD_CHAR})`
    return new RegExp(pattern, `${flags}gu`)
  }
  return new RegExp(pattern, `${flags}g`)
}
