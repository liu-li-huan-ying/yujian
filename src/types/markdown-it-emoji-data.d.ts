/**
 * markdown-it-emoji 的词典子路径只有 .mjs 实现、不带类型声明。
 * 这里补一个最小声明，供 EMOJI_MAP（name → emoji 字符）复用全量 GitHub 短代码词典。
 */
declare module 'markdown-it-emoji/lib/data/full.mjs' {
  const data: Record<string, string>
  export default data
}
