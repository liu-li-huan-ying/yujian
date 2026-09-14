/**
 * 快捷键组合的「解析 / 规范化 / 匹配」—— 纯函数，零运行时依赖，可进 Node 单测。
 *
 * 存在意义：键位一旦可配置，就必须有一个**唯一**的标准形，否则「Ctrl+Shift+P」、
 * 「shift+ctrl+p」、「Ctrl+P+Shift」会存成三条互相冲突的记录，匹配时还会漏。
 * 故所有键位（默认表、用户覆盖、按键事件）一律先归一到 `KeyCombo`，再转成规范串比较。
 *
 * 两个刻意的简化：
 * ① **不区分 Ctrl 与 Cmd**：本应用是跨平台 Electron，`e.ctrlKey || e.metaKey` 现状即如此，
 *    显示统一为 `Ctrl`（macOS 上用户按 Cmd 同样生效）。省掉一整个平台分支。
 * ② **主键取 `e.key` 而非 `e.code`**：与现有 `onKeydown` 一致（`Ctrl+/` 读到的就是 `/`），
 *    不引入键盘布局差异的第二套语义。
 */

export interface KeyCombo {
  /** Ctrl（Windows / Linux）或 Cmd（macOS）—— 同一修饰位，显示统一为 Ctrl */
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** 规范化主键：单字符大写（P、/、\\）、F1~F12，或 Enter / Space / Esc / Tab / Up… */
  key: string
}

/** 事件里只按下修饰键时 `e.key` 的取值：这类事件不构成键位 */
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'capslock'])

/** 命名键别名：把五花八门的 `e.key` 收成短而稳定的写法 */
const KEY_ALIAS: Record<string, string> = {
  escape: 'Esc',
  esc: 'Esc',
  space: 'Space',
  spacebar: 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
}

/** 修饰键别名 → 修饰位名。Cmd / Meta / Command 与 Ctrl 归一（见文件头说明 ①） */
const MOD_ALIAS: Record<string, keyof Pick<KeyCombo, 'ctrl' | 'shift' | 'alt'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  meta: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
}

/** F1~F12 */
const F_KEY = /^f(\d{1,2})$/i

/**
 * 把任意写法的主键归一：单字符转大写，命名键走别名表，F 键统一 `F` + 数字。
 * 无法识别时原样返回大写首字母形式，绝不返回空串（空串会让键位变成「只按修饰键」）。
 */
export function normalizeKey(raw: string): string {
  // 空格键必须最先认：`' '.trim()` 是空串，落到后面的长度判断就丢了
  if (raw === ' ') return 'Space'
  const k = raw.trim()
  if (!k) return ''
  if (k.length === 1) return k.toUpperCase()
  const lower = k.toLowerCase()
  if (KEY_ALIAS[lower]) return KEY_ALIAS[lower]
  const f = F_KEY.exec(lower)
  if (f) return `F${Number(f[1])}`
  // 未收录的命名键（如 'ContextMenu'）：保留首字母大写，保证可逆、不丢信息
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * 解析键位串（如 `Ctrl+Shift+P`）成 `KeyCombo`；不合法返回 null。
 * 顺序与大小写随意（`shift+ctrl+p` 等价），多余空格忽略。
 */
export function parseCombo(input: string): KeyCombo | null {
  if (typeof input !== 'string') return null
  const parts = input
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return null

  const combo: KeyCombo = { ctrl: false, shift: false, alt: false, key: '' }
  // 末段是主键，其余都必须是修饰键；`Ctrl++` 之类的畸形输入会被 filter 掉空段后落到这里判空
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = MOD_ALIAS[parts[i]!.toLowerCase()]
    if (!mod) return null
    combo[mod] = true
  }
  const rawKey = parts[parts.length - 1]!
  // 主键段本身不能是修饰键名（`Ctrl+Shift` 不是键位）
  if (MOD_ALIAS[rawKey.toLowerCase()]) return null
  const key = normalizeKey(rawKey)
  if (!key || MODIFIER_KEYS.has(key.toLowerCase())) return null
  combo.key = key
  return combo
}

/** 规范串：固定 `Ctrl+Alt+Shift+Key` 顺序，可直接做 Map 键 / 存储值 / 相等比较 */
export function formatCombo(combo: KeyCombo): string {
  const out: string[] = []
  if (combo.ctrl) out.push('Ctrl')
  if (combo.alt) out.push('Alt')
  if (combo.shift) out.push('Shift')
  out.push(combo.key)
  return out.join('+')
}

/** 解析 + 重新格式化：把任意写法收敛成规范串；不合法返回 null */
export function normalizeCombo(input: string): string | null {
  const c = parseCombo(input)
  return c ? formatCombo(c) : null
}

export function comboEquals(a: KeyCombo, b: KeyCombo): boolean {
  return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.key === b.key
}

/**
 * 键位是否「可绑定」。
 *
 * 光按一个字母键（如 `A`）不该能被占为全局快捷键 —— 那会让人打不出字。
 * 故要求：带 Ctrl 或 Alt，或者是功能键 F1~F12（F1 帮助、F3 查找就是这么用的）。
 * 单独按 Shift 不算修饰，避免 `Shift+A`（= 大写 A）被当成快捷键。
 */
export function isBindable(combo: KeyCombo): boolean {
  if (!combo.key) return false
  if (combo.ctrl || combo.alt) return true
  return /^F\d{1,2}$/.test(combo.key)
}

/** 键盘事件 → `KeyCombo`；只按下修饰键时返回 null（那是「正在按 Ctrl」，不是一次按键） */
export function eventToCombo(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): KeyCombo | null {
  const lower = String(e.key ?? '').toLowerCase()
  if (!lower || MODIFIER_KEYS.has(lower)) return null
  const key = normalizeKey(e.key)
  if (!key) return null
  return {
    ctrl: !!(e.ctrlKey || e.metaKey),
    shift: !!e.shiftKey,
    alt: !!e.altKey,
    key,
  }
}

/** 事件是否命中该键位（内部即「归一后比较」，避免调用方各写一套） */
export function eventMatches(combo: KeyCombo, e: Parameters<typeof eventToCombo>[0]): boolean {
  const got = eventToCombo(e)
  return !!got && comboEquals(got, combo)
}
