/**
 * 外部改动冲突的**纯判定**（零依赖：不 import vue、不碰 IPC）。
 *
 * 为什么单独成文件：这两条判定都是「错了就会静默毁数据 / 静默骚扰用户」的类型，
 * 必须有断言钉死。放在 App.vue 里既无法测，也容易在下一次改动中被顺手写错。
 * 编排（读盘、弹窗、抑制窗）在 `composables/useFileConflict.ts`。
 */

/**
 * 冲突「另存我的版本」的兄弟路径：在扩展名前插入标记。
 *
 * `a/b/note.md` → `a/b/note.mine.md`；无扩展名则直接追加。
 *
 * ⚠️ 扩展名判定必须要求「最后一个 `.` 在最后一个路径分隔符之后」——
 * 否则目录名里的点会被当成扩展名，`my.notes/readme` 会被切成 `my.mine.notes/readme`
 * 这种不存在的目录（另存直接失败）。
 */
export function siblingMinePath(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (dot > slash) return `${path.slice(0, dot)}.mine${path.slice(dot)}`
  return `${path}.mine`
}

/**
 * 文本等价判定（忽略行尾差异）。
 *
 * 用于识别「自己的保存回声」：我们把内容写盘后，主进程 watcher 会把同一改动推回来；
 * 若磁盘内容与内存相同就不该报冲突。但写盘路径可能把 LF 规范化成 CRLF（或反之），
 * 逐字符比较会**误报外部改动** → 用户面前反复弹「文件被外部修改」的对话框。
 */
export function isSameText(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\r\n/g, '\n')
  return norm(a) === norm(b)
}
