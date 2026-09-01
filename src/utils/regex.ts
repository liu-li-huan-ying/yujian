/** 把字符串转义为正则字面量，避免用户输入里的 . * + 等被当作元字符 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按选项构造搜索正则：wholeWord 加词边界，caseSensitive 控制大小写 */
export function buildRegex(query: string, caseSensitive: boolean, wholeWord: boolean): RegExp {
  let pattern = escapeRegExp(query)
  if (wholeWord) pattern = `\\b${pattern}\\b`
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi')
}
