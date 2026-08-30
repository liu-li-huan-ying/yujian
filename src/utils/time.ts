/**
 * 时间格式化工具。
 *
 * 设计要点：一律使用运行环境的「本地时区」——`Date` 的 get* 系列方法读取的是操作系统当前时区，
 * 因此无需硬编码东八区，换到任何时区的电脑都会自动按本机时间显示。
 * 需要把「本机时区」明示给用户时（如快照时间戳 tooltip），用 `localTimeZone()` 取 IANA 时区名。
 */

/** 把 epoch ms 格式化为 `2026-08-30 09:03:12`（本机时区，零填充） */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}

/** 取本机 IANA 时区名（如 `Asia/Shanghai` / `America/New_York），用于向用户明示所用时区 */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}
