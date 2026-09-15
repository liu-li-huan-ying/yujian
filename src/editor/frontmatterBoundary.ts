/**
 * 编辑器边界的 frontmatter 保真。
 *
 * **问题根因**：Crepe（所见即所得）没有 `remark-frontmatter` 插件，其序列化管线
 * 会把文档顶部的 YAML 头整段丢弃。于是「在 WYSIWYG 下编辑/重渲染 → 自动保存写出无头文件
 * → 索引重算 moc=false → MOC 面板消失，重开也读不到」，正是用户报告的「内容地图过一会没了」。
 *
 * **解法（与「Markdown 往返保真」红线一致）**：在编辑器边界「载入前剥离 frontmatter、序列化后
 * 原样拼回」——Crepe 永远只见到正文，frontmatter 作为不变量单独留存，由 `getMarkdown` /
 * `markdownUpdated` 在输出端拼回。纯函数，无副作用，可被主进程测试直接 bundle 验证。
 */

export interface FrontmatterSplit {
  /** `---\n…\n---` 块本体（不含其后的换行、已去 BOM）；无合法 frontmatter 时为 null */
  block: string | null
  /** 头与正文之间的换行（原样保留，如 `\n\n`）。**单独留存**是因为 Crepe 序列化会吃掉
   *  正文的前导空行，若把它算进 body，保存后 `---` 与首个标题就会少一个空行。 */
  sep: string
  /** 正文（已去掉前导换行），用于喂给 Crepe */
  body: string
}

/**
 * 拆分 frontmatter 与正文。匹配以 `---` 起、以 `---` 止的 YAML 块：
 * block 取块本体，其后所有空白（含空行）单独作为 sep，**正文从空白之后逐字切出**——
 * 如此 `block + sep + body` 在不改动正文时与原串**逐字节一致**。
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\s*)/.exec(clean)
  if (!m) return { block: null, sep: '', body: clean }
  const block = `---\n${m[1]}\n---`
  // 至少补一个换行，避免 `---` 与首行内容粘死
  const sep = m[2] || '\n'
  const body = clean.slice(m[0].length)
  return { block, sep, body }
}

/**
 * 把正文拼回留存的 frontmatter（含原本的空行分隔）。
 * 无 frontmatter（block 为 null）时原样返回正文。
 */
export function reattachFrontmatter(block: string | null, body: string, sep = '\n'): string {
  if (!block) return body
  return block + (sep || '\n') + body
}

/**
 * 往返模拟：剥离 → 对正文施加变换（默认原样，模拟 Crepe 序列化）→ 拼回 frontmatter。
 * 用于断言「未改动正文时，frontmatter 在 WYSIWYG 往返中原样保真」。
 */
export function roundTripFrontmatter(
  text: string,
  transform: (body: string) => string = (b) => b,
): string {
  const { block, sep, body } = splitFrontmatter(text)
  return reattachFrontmatter(block, transform(body), sep)
}
