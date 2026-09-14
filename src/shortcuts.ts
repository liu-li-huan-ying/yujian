/**
 * 快捷键绑定的「单一事实来源」—— 默认值 + 用户覆盖 + 冲突判定 + 持久化。
 *
 * 设计要点：
 * ① **默认键位不在本文件，而在 `utils/commands.ts` 的 `keys` 字段**（命令目录已是单一事实来源，
 *    再抄一份必然过期）。本文件只负责「覆盖 / 解析 / 冲突」。
 * ② **只存覆盖**：`localStorage` 里只写被改过的命令，默认值改了用户没碰过的命令会跟着走，
 *    不会出现「升级后旧键位被钉死」。
 * ③ **覆盖值 `''` 表示显式解绑**（区别于「未设置」= 用默认值）。
 * ④ 零 Vue 依赖：状态变更用订阅回调通知，便于 esbuild → mjs 后在 Node 里单测。
 */

import { COMMANDS, type CommandId, type CommandSpec } from './utils/commands'
import { isBindable, normalizeCombo, parseCombo } from './utils/keymap'

export const SHORTCUTS_STORAGE_KEY = 'yujian.shortcuts'

/** 只需 getItem / setItem / removeItem，便于测试注入假存储 */
export interface ShortcutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 保留键位的原因：`app` 本应用固定入口 · `system` 系统/浏览器抢走 · `editor` 编辑器正文在用 */
export type ReservedReason = 'app' | 'system' | 'editor'

export interface ReservedEntry {
  combo: string
  reason: ReservedReason
  /** `app` 类的被占用动作名在 i18n 里的路径（如 `palette.quickOpen`），供 UI 显示 */
  labelPath?: string
}

/** 命令表里的默认键位（规范串），只取能解析的 —— 写错的默认值不该让整个应用起不来 */
export const DEFAULT_BINDINGS: Partial<Record<CommandId, string>> = (() => {
  const out: Partial<Record<CommandId, string>> = {}
  // 断言成 `CommandSpec[]`：COMMANDS 是 `as const` 元组，各成员的字面量类型并不都带 `keys`
  for (const c of COMMANDS as readonly CommandSpec[]) {
    if (!c.keys) continue
    const norm = normalizeCombo(c.keys)
    if (norm) out[c.id as CommandId] = norm
  }
  return out
})()

/**
 * 不可分配给普通命令的键位。
 *
 * - `app`：打开设置本身的入口（命令面板 / 快速打开）。放出去会出现「把打开键位设置的那
 *   个键改掉了，于是再也进不来」的死锁 —— 形态上仍可从活动栏点开，但键盘用户会被卡住。
 * - `system`：Electron / 浏览器 / 操作系统先手，我们拦不到或拦了会破坏基本操作（新建窗口、
 *   关闭标签、打印、刷新、开发者工具）。
 * - `editor`：编辑器正文正在用的编辑键位（全选 / 复制 / 撤销 / 加粗…）。占用后正文里该键失效。
 */
export const RESERVED: readonly ReservedEntry[] = [
  { combo: 'Ctrl+K', reason: 'app', labelPath: 'palette.quickOpen' },
  { combo: 'Ctrl+Shift+P', reason: 'app', labelPath: 'palette.title' },
  { combo: 'Ctrl+N', reason: 'system' },
  { combo: 'Ctrl+Shift+N', reason: 'system' },
  { combo: 'Ctrl+T', reason: 'system' },
  { combo: 'Ctrl+Shift+T', reason: 'system' },
  { combo: 'Ctrl+W', reason: 'system' },
  { combo: 'Ctrl+P', reason: 'system' },
  { combo: 'Ctrl+R', reason: 'system' },
  { combo: 'Ctrl+Shift+R', reason: 'system' },
  { combo: 'Ctrl+Q', reason: 'system' },
  { combo: 'Ctrl+Shift+I', reason: 'system' },
  { combo: 'Ctrl+Shift+J', reason: 'system' },
  { combo: 'Ctrl+Shift+C', reason: 'system' },
  { combo: 'F5', reason: 'system' },
  { combo: 'F11', reason: 'system' },
  { combo: 'F12', reason: 'system' },
  { combo: 'Alt+F4', reason: 'system' },
  { combo: 'Ctrl+A', reason: 'editor' },
  { combo: 'Ctrl+C', reason: 'editor' },
  { combo: 'Ctrl+X', reason: 'editor' },
  { combo: 'Ctrl+V', reason: 'editor' },
  { combo: 'Ctrl+Z', reason: 'editor' },
  { combo: 'Ctrl+Y', reason: 'editor' },
  { combo: 'Ctrl+Shift+Z', reason: 'editor' },
  { combo: 'Ctrl+B', reason: 'editor' },
  { combo: 'Ctrl+I', reason: 'editor' },
  { combo: 'Ctrl+U', reason: 'editor' },
]

export type Conflict =
  | { kind: 'command'; id: CommandId; combo: string }
  | { kind: 'reserved'; entry: ReservedEntry; combo: string }

export type SetResult = { ok: true } | { ok: false; conflict: Conflict }

/* ── 存储后端（可注入，便于测试） ── */

let storage: ShortcutStorage | null = null

function defaultStorage(): ShortcutStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // 隐私模式 / 禁用存储：快捷键仍可用，只是不跨会话记住
    return null
  }
}

export function setShortcutsStorage(impl: ShortcutStorage | null): void {
  storage = impl
  loaded = false
  version++
  notify()
}

/* ── 状态 ── */

let overrides: Record<string, string> = {}
let loaded = false
let version = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

/** 订阅变更（返回退订函数）。组件用它把自己的 version ref 顶起来，触发 computed 重算 */
export function onShortcutsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getShortcutsVersion(): number {
  return version
}

function isCommandId(id: string): id is CommandId {
  return COMMANDS.some((c) => c.id === id)
}

/** 读存储并做一次清洗：未知命令 / 不可解析 / 不可绑定的脏数据直接丢掉，绝不让它污染运行时 */
export function loadShortcuts(): Record<string, string> {
  const store = storage ?? defaultStorage()
  overrides = {}
  if (store) {
    try {
      const raw = store.getItem(SHORTCUTS_STORAGE_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (!isCommandId(k)) continue
            if (typeof v !== 'string') continue
            // '' = 显式解绑，是合法值
            if (v === '') {
              overrides[k] = ''
              continue
            }
            const norm = normalizeCombo(v)
            if (!norm) continue
            // 防呆：localStorage 是用户可以手改的。若放一个「裸字母」进来，它会进派发表，
            // 于是正文里每按一次该字母就触发命令（还 preventDefault，字都打不出来）。
            // 故读盘时与写入时同标准：可解析 **且** 可绑定才留下。
            const combo = parseCombo(norm)
            if (!combo || !isBindable(combo)) continue
            overrides[k] = norm
          }
        }
      }
    } catch {
      overrides = {}
    }
  }
  loaded = true
  return { ...overrides }
}

function ensureLoaded(): void {
  if (!loaded) loadShortcuts()
}

function persist(): void {
  const store = storage ?? defaultStorage()
  if (!store) return
  try {
    if (Object.keys(overrides).length === 0) store.removeItem(SHORTCUTS_STORAGE_KEY)
    else store.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // 写不进去不影响本次会话使用
  }
}

/* ── 查询 ── */

export function getDefaultBinding(id: CommandId): string | undefined {
  return DEFAULT_BINDINGS[id]
}

/** 当前生效键位：用户覆盖（含显式解绑）优先，否则默认值 */
export function getBinding(id: CommandId): string | undefined {
  ensureLoaded()
  if (id in overrides) return overrides[id] || undefined
  return DEFAULT_BINDINGS[id]
}

/** 是否被用户改过（决定「重置」按钮是否可点） */
export function isCustomized(id: CommandId): boolean {
  ensureLoaded()
  return id in overrides
}

export function hasAnyCustomization(): boolean {
  ensureLoaded()
  return Object.keys(overrides).length > 0
}

/** 全量解析结果，供 UI 表格与派发表使用 */
export function resolveBindings(): Record<string, string | undefined> {
  ensureLoaded()
  const out: Record<string, string | undefined> = {}
  for (const c of COMMANDS) out[c.id] = getBinding(c.id)
  return out
}

/** 反向索引：规范串 → 命令 id。派发时一次建表，避免每次按键遍历全表 */
export function buildDispatchTable(): Map<string, CommandId> {
  ensureLoaded()
  const map = new Map<string, CommandId>()
  for (const c of COMMANDS) {
    const b = getBinding(c.id)
    if (!b) continue
    // 后者不覆盖前者：真出现重复（用户不该能造出来）时保留靠前的命令，行为确定
    if (!map.has(b)) map.set(b, c.id)
  }
  return map
}

/**
 * 该键位是否已被别人占用。`exceptId` 用于「改自己的键位时不算跟自己冲突」。
 * 保留键位一律算冲突（`app` 类最优先，其次是 `system` / `editor`）。
 */
export function findConflict(combo: string, exceptId?: CommandId): Conflict | null {
  ensureLoaded()
  const norm = normalizeCombo(combo)
  if (!norm) return null
  const reserved = RESERVED.find((r) => r.combo === norm)
  if (reserved) return { kind: 'reserved', entry: reserved, combo: norm }
  for (const c of COMMANDS) {
    if (c.id === exceptId) continue
    if (getBinding(c.id) === norm) return { kind: 'command', id: c.id, combo: norm }
  }
  return null
}

/* ── 修改 ── */

/**
 * 设置键位。`combo` 传 `''` 表示解绑（不需要冲突判定）。
 * 撞到别人时**默认不生效**并返回冲突，由 UI 问用户「替换 / 取消」后再以 `steal: true` 调用 ——
 * 宁可多问一句，也不要悄悄夺走用户已设好的键位。
 */
export function setBinding(id: CommandId, combo: string, opts?: { steal?: boolean }): SetResult {
  ensureLoaded()
  if (combo === '') {
    overrides[id] = ''
    version++
    persist()
    notify()
    return { ok: true }
  }
  const norm = normalizeCombo(combo)
  // 解析不出（如 `Ctrl++`）或不可绑定（光一个字母键）→ 拒绝
  const c = norm ? parseCombo(norm) : null
  if (!norm || !c || !isBindable(c)) {
    return { ok: false, conflict: { kind: 'reserved', entry: { combo, reason: 'system' }, combo } }
  }

  const conflict = findConflict(norm, id)
  if (conflict) {
    // 保留键位**抢不走**：能抢的是别人设的键，不是「打开设置本身」或系统 / 编辑器的键
    if (conflict.kind === 'reserved') return { ok: false, conflict }
    if (!opts?.steal) return { ok: false, conflict }
    // 抢占：把原主人的键位清空，保证一条键位只有一个主人
    overrides[conflict.id] = ''
  }
  overrides[id] = norm
  version++
  persist()
  notify()
  return { ok: true }
}

/** 恢复某个命令的默认键位 */
export function resetBinding(id: CommandId): void {
  ensureLoaded()
  if (!(id in overrides)) return
  delete overrides[id]
  version++
  persist()
  notify()
}

/** 全部恢复默认 */
export function resetAllBindings(): void {
  ensureLoaded()
  overrides = {}
  version++
  persist()
  notify()
}
