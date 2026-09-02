/**
 * 程序化改动的同源事件抑制：我们在渲染层显式调用 refreshTree 后，主进程 watcher
 * 还会把同一次磁盘改动以 unlink/add/unlinkDir/addDir 的形式推回来。若不处理，会出现
 * 「一次改动刷新两次」（两次全量扫描，库大时浪费）以及更危险的竞态——正在编辑的文档被
 * 移动 / 重命名时，watcher 的 unlink(旧路径) 会让 onVaultChange 误判为「外部删除」而关掉标签。
 *
 * 这里以「路径集合 + 时间窗」标定我们刚亲手做过的改动，让同源事件直接被忽略；
 * 真正的外部改动路径不在集合内，照常触发刷新 / 冲突检测。该状态由两个进程共享
 * （App 读、Sidebar 写），故放在独立模块，避免重复实现与状态错乱。
 */

let opSuppressUntil = 0
const opImmunePaths = new Set<string>()

/** 当前事件是否属「我们刚亲手做的改动」回声：是则忽略 */
export function isVaultEventSuppressed(path: string): boolean {
  if (opImmunePaths.size && Date.now() >= opSuppressUntil) {
    opImmunePaths.clear()
    return false
  }
  return opImmunePaths.has(path)
}

/** 登记刚发生的程序化改动路径，使其在窗口内被 watcher 回声忽略 */
export function markProgrammatic(paths: string[], windowMs = 1000): void {
  opSuppressUntil = Date.now() + windowMs
  for (const p of paths) if (p) opImmunePaths.add(p)
}

/** 取某文件同名的 .assets 资源目录绝对路径（用于一并抑制其 unlinkDir/addDir 回声） */
export function assetsPathOf(p: string): string {
  const ext = p.toLowerCase().lastIndexOf('.')
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (ext <= slash || ext < 0) return ''
  const base = p.slice(0, ext)
  return `${base}.assets`
}
