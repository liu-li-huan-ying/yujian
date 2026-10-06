/**
 * 批量替换确认框的路径清单折叠（纯逻辑，无 vue / 无 IO，可被 `bundle()` 直测）。
 *
 * ## 为什么只显示 basename 而不显示全路径
 *
 * 全文路径里 90% 的字符是重复的库根前缀，真正区分文件的是**文件名**。
 * 但**只给 basename 会丢关键信息**：两个不同文件夹下的 `README.md` 看起来一样，
 * 用户无法判断「是不是我要改的那个」。故保留**父目录 + 文件名**（`笔记/日报.md`），
 * 仅在仍然过长时中间省略。
 *
 * 为什么不显示 vault 根前缀：确认框就长在搜索面板里，而面板已经知道当前库是谁，
 * 重复一遍是噪音。
 */

/** 取「父目录/文件名」（跨平台分隔符均可） */
export function shortPath(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return fullPath
  const file = parts[parts.length - 1]
  const parent = parts[parts.length - 2]
  return `${parent}/${file}`
}

/** 中间省略（保留首尾，扩展名必须完整保留 —— 用户靠它认文件类型） */
export function elideName(p: string, max = 34): string {
  if (p.length <= max) return p
  const dot = p.lastIndexOf('.')
  const ext = dot > 0 && p.length - dot <= 6 ? p.slice(dot) : ''
  const stem = ext ? p.slice(0, p.length - ext.length) : p
  const keep = Math.max(2, max - ext.length - 1)
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return stem.slice(0, head) + '…' + (tail > 0 ? stem.slice(stem.length - tail) : '') + ext
}

/**
 * 生成确认框要展示的清单。
 * @param paths 全部受影响文件
 * @param foldAt 超过此数则截断（调用方负责「还有 K 个」的展开交互）
 */
export function foldFilePaths(paths: readonly string[], foldAt = 8): string[] {
  return paths.slice(0, foldAt).map((p) => elideName(shortPath(p)))
}
