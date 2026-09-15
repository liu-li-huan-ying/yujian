import { ref } from 'vue'
import { useI18n } from '../i18n'
import { isSameText, siblingMinePath } from '../utils/conflict'

/** 冲突处理需要的编辑器能力（`instanceof` 太脆，按能力声明接口） */
export interface ConflictEditorLike {
  /** 读内存中的正文（用于与磁盘比较） */
  getMarkdown: () => string
  /** 取消待执行的自动保存 —— 否则 800ms 后会把外部改动覆盖掉 */
  cancelPendingSave: () => void
  /** 把内存版本写回磁盘（「保留我的」） */
  save: () => Promise<void>
  /** 从磁盘重新载入（「采用磁盘版本」/「两份都留」后） */
  load: (path: string) => Promise<void>
}

export interface FileConflictHooks {
  /** 当前编辑文档路径（getter，保持响应式） */
  filePath: () => string | null
  /** 编辑器宿主实例；null 表示编辑器尚未就绪 */
  host: () => ConflictEditorLike | null
  /** 顶部轻提示 */
  showToast: (msg: string, type?: 'ok' | 'err' | 'info', duration?: number) => void
}

export interface ConflictInfo {
  path: string
  /** 内存中的「我的版本」 */
  mine: string
  /** 磁盘上的版本 */
  disk: string
  /** 磁盘 mtime（取不到则 null），供对话框展示「谁更新」 */
  diskMtime: number | null
}

/**
 * 有意重写磁盘之后抑制一段冲突检测窗口，避免自身触发的 watcher 事件被误判为外部改动。
 * 5s 是「写盘 + watcher 回推」的宽松上限，不是用户可感知的等待。
 */
const SUPPRESS_MS = 5000

/**
 * 外部修改冲突检测 —— 当笔记库里「当前正在编辑」的文档被玉笺之外（别的编辑器 /
 * Git 切分支 / 资源管理器改名）改写时，若磁盘内容与编辑器内存内容不同，弹出三选一
 * 对话框，**绝不静默覆盖**。
 *
 * 三条边界（都是踩出来的，改动前先读）：
 *  1. **自己的保存回声**：磁盘 == 内存（含 CRLF/LF 归一化）→ 直接忽略，不误报；
 *  2. **任意有意写盘之后**（保存 / 恢复备份）→ 用抑制窗压掉自身回声；
 *  3. **只在编辑器就绪时比对**：宿主为 null 时 `getMarkdown()` 取不到内容，
 *     按空串参与比较会报出一场「我的版本是空的」假冲突（见 `detectConflict` 注释）。
 */
export function useFileConflict(hooks: FileConflictHooks) {
  const { t: L } = useI18n()
  const U = L.ui

  const conflict = ref<ConflictInfo | null>(null)
  const conflictOpen = ref(false)

  let suppressUntil = 0
  const suppressed = (): boolean => Date.now() < suppressUntil
  const suppress = (): void => {
    suppressUntil = Date.now() + SUPPRESS_MS
  }

  /** 与磁盘比对后判定是否冲突；不冲突（含回声）则什么也不做 */
  async function detectConflict(path: string): Promise<void> {
    if (suppressed() || conflictOpen.value) return
    const editor = hooks.host()
    try {
      const disk = await window.api.readFile(path)
      const mine = editor?.getMarkdown() ?? ''
      if (isSameText(disk, mine)) return // 自己的保存回声，忽略
      // 确有外部改动且与内存不同 → 取消待执行的自动保存，避免把外部改动覆盖掉
      editor?.cancelPendingSave()
      const st = await window.api.statFile(path).catch(() => null)
      conflict.value = { path, mine, disk, diskMtime: st?.exists ? st.mtimeMs : null }
      conflictOpen.value = true
    } catch {
      // 读不到磁盘内容：不处理（文件可能刚被删，生命周期由文件树事件接管）
    }
  }

  function finishConflict(): void {
    conflictOpen.value = false
    conflict.value = null
  }

  /** 保留我的：覆盖外部改动，把内存版本写回磁盘（保真、不丢字） */
  function onConflictKeepMine(): void {
    const c = conflict.value
    if (!c) return
    suppress()
    void hooks.host()?.save()
    finishConflict()
  }

  /** 采用磁盘：丢弃内存改动，从磁盘重新载入 */
  async function onConflictUseDisk(): Promise<void> {
    const c = conflict.value
    if (!c) return
    suppress()
    const editor = hooks.host()
    await editor?.load(c.path).catch(() => {})
    finishConflict()
  }

  /** 两份都留：我的版本另存为兄弟文件（`note.mine.md`），当前文档采用磁盘版本 */
  async function onConflictKeepBoth(): Promise<void> {
    const c = conflict.value
    if (!c) return
    suppress()
    const minePath = siblingMinePath(c.path)
    try {
      await window.api.writeFile(minePath, c.mine)
    } catch {
      /* 另存失败不阻断：仍载入磁盘版本，至少不丢磁盘内容 */
    }
    const editor = hooks.host()
    await editor?.load(c.path).catch(() => {})
    const base = minePath.split(/[\\/]/).pop() ?? minePath
    hooks.showToast(U.backupConflictBothSaved.replace('{p}', base), 'ok')
    finishConflict()
  }

  /** 恢复备份之后：重载当前文档以反映磁盘最新内容，并抑制「外部修改」误报 */
  function onBackupRestored(): void {
    suppress()
    const path = hooks.filePath()
    const editor = hooks.host()
    if (path) void editor?.load(path).catch(() => {})
  }

  return {
    conflict,
    conflictOpen,
    detectConflict,
    onConflictKeepMine,
    onConflictUseDisk,
    onConflictKeepBoth,
    onBackupRestored,
  }
}
