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
  /** 匹配到的整段 frontmatter 区域（含闭合 `---` 行及其后换行、已去 BOM）；无合法 frontmatter 时为 null */
  block: string | null
  /** frontmatter 之后的正文，逐字保留（含其前导空行），用于喂给 Crepe */
  body: string
}

/**
 * 拆分 frontmatter 与正文。匹配以 `---` 起、以 `---` 止的 YAML 块；把**整段匹配区域**作为
 * block 留存（含闭合 `---` 行及其后的换行），正文从匹配结束处逐字切出——
 * 如此 `block + body` 在不改动正文时与原串**逐字节一致**（头与正文间的空行数原样保留）。
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(clean)
  if (!m) return { block: null, body: clean }
  const block = m[0]
  const body = clean.slice(m[0].length)
  return { block, body }
}

/**
 * 把正文拼回留存的 frontmatter。block 通常已以换行结尾（由 splitFrontmatter 得来），
 * 仅当「block 不以换行结尾 且 正文不以换行起」时才补一个换行，避免 `---` 与首行内容粘死；
 * 两侧任一侧已提供换行则不再插入，保证 `block（=原匹配区域）+ body` 在正文不变时逐字节原样。
 * 无 frontmatter（block 为 null）时原样返回正文。
 */
export function reattachFrontmatter(block: string | null, body: string): string {
  if (!block) return body
  const sep = block.endsWith('\n') || /^\n/.test(body) ? '' : '\n'
  return block + sep + body
}

/**
 * 往返模拟：剥离 → 对正文施加变换（默认原样，模拟 Crepe 序列化）→ 拼回 frontmatter。
 * 用于断言「未改动正文时，frontmatter 在 WYSIWYG 往返中原样保真」。
 */
export function roundTripFrontmatter(
  text: string,
  transform: (body: string) => string = (b) => b,
): string {
  const { block, body } = splitFrontmatter(text)
  return reattachFrontmatter(block, transform(body))
}
