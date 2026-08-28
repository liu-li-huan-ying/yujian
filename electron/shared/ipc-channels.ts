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
  WIN_STATE_CHANGE: 'win:stateChange',

  // 导出（渲染模式所见即所得 → HTML / PDF）
  EXPORT_HTML: 'export:html',
  EXPORT_PDF: 'export:pdf',

  // 图片：粘贴/拖入落盘到文档同级 .assets
  ASSET_SAVE: 'asset:save',

  // 图床：配置读写（密钥只在主进程，safeStorage 加密）
  IMGHOST_GET: 'imghost:get',
  IMGHOST_SET: 'imghost:set',
  // 图床：上传文档内本地图片，返回远程 URL（密钥不离开主进程）
  IMGHOST_UPLOAD: 'imghost:upload',
  // 图床：上传文档内全部本地图片并把 Markdown 引用改写为远程 URL
  IMGHOST_PUBLISH: 'imghost:publish'
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

/** 启动偏好：恢复上次会话（默认）/ 每次启动显示全新页面 */
export type StartupMode = 'restore' | 'fresh'

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
  /** 启动偏好：恢复上次会话 / 每次启动显示全新页面 */
  startupMode: StartupMode
}

export const DEFAULT_SESSION: SessionState = {
  vaultPath: null,
  activePath: null,
  mode: 'wysiwyg',
  sidebarWidth: 224,
  startupMode: 'restore'
}

/* ── 导出（HTML / PDF）────────────────────────── */

/** 渲染进程组装好的完整文档 + 建议文件名 */
export interface ExportPayload {
  /** 完整 HTML 文档字符串（含 <!DOCTYPE> 与内联样式） */
  html: string
  /** 保存对话框的默认文件名（含扩展名） */
  defaultName: string
}

export interface ExportResult {
  ok: boolean
  /** 用户取消保存对话框 */
  canceled?: boolean
  /** 成功时的最终保存路径 */
  path?: string
  /** 失败时的错误信息 */
  error?: string
}

/* ── 图片落盘 ─────────────────────────────── */

export interface SaveAssetPayload {
  /** 当前文档路径（无则为 null，落到库根或临时目录） */
  docPath: string | null
  /** 当前笔记库根（无文档时用于决定落盘位置） */
  vaultPath: string | null
  /** 图片字节的 base64 */
  base64: string
  /** 扩展名（png/jpg/...，不含点） */
  ext: string
}

export interface SavedAsset {
  /** 磁盘绝对路径 */
  absPath: string
  /** 相对文档目录的路径（如 `笔记.assets/foo.png`） */
  relPath: string
}

/* ── 图床 ─────────────────────────────────── */

/** 图床配置（密钥不出现在此结构，由主进程单独加密存储） */
export interface ImgHostConfig {
  /** 提供方标识，如 smms */
  provider: string
  /** 展示用名称 */
  name: string
  /** 上传端点（SM.MS: https://sm.ms/api/v2/upload） */
  endpoint: string
  /** 自定义请求头（如 Authorization），值留空，真正密钥在主进程解密注入 */
  tokenHeader: string
}

export interface ImgHostUploadItem {
  /** 本地磁盘绝对路径 */
  path: string
  /** 用于回带对应关系的本地引用（相对或 file:// 绝对） */
  ref: string
}

export interface ImgHostUploadResult {
  ok: boolean
  /** 每个本地引用的上传结果 */
  items: Array<{ ref: string; url?: string; error?: string }>
}

/* ── 图床发布（上传 + 改写）────────────────────── */

/** 上传文档内本地图片并把引用改写为远程 URL 的结果 */
export interface PublishResult {
  ok: boolean
  /** 文档中没有可上传的本地图片 */
  noImages?: boolean
  /** 改写后的完整 Markdown（成功且有图片时返回） */
  markdown?: string
  /** 成功上传的张数 */
  uploaded: number
  /** 失败的张数 */
  failed: number
  /** 失败时的错误信息 */
  error?: string
}


/** 侧边栏可调宽度范围，与 --w-sidebar 默认值呼应 */
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 360
