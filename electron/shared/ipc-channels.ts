export const IPC = {
  APP_VERSION: 'app:version',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST_DIR: 'file:listDir',
  FILE_CREATE: 'file:create',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_OPEN_DIR: 'dialog:openDir',

  // 笔记库：扫描与监听（选目录复用上面的 DIALOG_OPEN_DIR）
  VAULT_LIST: 'vault:list',
  VAULT_WATCH: 'vault:watch',
  VAULT_UNWATCH: 'vault:unwatch',
  VAULT_CHANGE: 'vault:change',

  // 笔记库：文件树变更（新建文件夹 / 重命名 / 删除）
  VAULT_CREATE_DIR: 'vault:createDir',
  VAULT_RENAME: 'vault:rename',
  VAULT_DELETE: 'vault:delete',

  // 笔记库：全文搜索
  VAULT_SEARCH: 'vault:search',

  // 会话持久化（崩溃恢复）
  SESSION_GET: 'session:get',
  SESSION_PATCH: 'session:patch',

  // 自定义标题栏的窗口控制
  WIN_MINIMIZE: 'win:minimize',
  WIN_TOGGLE_MAXIMIZE: 'win:toggleMaximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  WIN_STATE_CHANGE: 'win:stateChange'
} as const

export interface WindowState {
  maximized: boolean
}

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface DocMeta {
  path: string
  title: string
  updatedAt: number
}

export type EditorMode = 'wysiwyg' | 'source'

/* ── 笔记库文件树 ───────────────────────────── */

export interface FileNode {
  /** 文件名（含扩展名）或目录名 */
  name: string
  /** 绝对路径 */
  path: string
  type: 'file' | 'dir'
  /** 仅目录有，已按「目录在前、名称升序」排好 */
  children?: FileNode[]
}

export type VaultChangeKind = 'add' | 'unlink' | 'addDir' | 'unlinkDir' | 'change'

export interface VaultChange {
  kind: VaultChangeKind
  /** 绝对路径 */
  path: string
}

/* ── 全文搜索结果 ─────────────────────────── */

export interface SearchLineHit {
  /** 行号（从 1 开始） */
  line: number
  /** 命中行文本（已截断，去除首尾空白） */
  text: string
}

export interface SearchFileResult {
  /** 文档绝对路径 */
  path: string
  /** 文件名（含扩展名） */
  name: string
  hits: SearchLineHit[]
}

/* ── 会话状态（崩溃恢复）────────────────────── */

export interface SessionState {
  /** 当前笔记库根目录，未打开则为 null */
  vaultPath: string | null
  /** 当前编辑的文档绝对路径 */
  activePath: string | null
  mode: EditorMode
  /** 侧边栏宽度（px） */
  sidebarWidth: number
}

export const DEFAULT_SESSION: SessionState = {
  vaultPath: null,
  activePath: null,
  mode: 'wysiwyg',
  sidebarWidth: 224
}

/** 侧边栏可调宽度范围，与 --w-sidebar 默认值呼应 */
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 360
