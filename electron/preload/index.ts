import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type ExportPayload,
  type ExportResult,
  type FileNode,
  type ImgHostConfig,
  type ImgHostUploadItem,
  type ImgHostUploadResult,
  type PublishResult,
  type SaveAssetPayload,
  type SavedAsset,
  type SearchFileResult,
  type SessionState,
  type VaultChange,
  type WindowState
} from '../shared/ipc-channels'

/**
 * 只暴露受控 API。绝不暴露 ipcRenderer 本身或任何 Node 能力。
 */
const api = {
  /** 平台标识：macOS 保留原生红绿灯，Windows / Linux 自绘窗口控制按钮 */
  platform: process.platform,

  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),

  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_READ, filePath),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FILE_WRITE, filePath, content),

  /** 在指定目录新建文档，返回最终路径（重名自动加序号，不覆盖已有内容） */
  createDoc: (dir: string, name?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_CREATE, dir, name),

  /** 在指定父目录下新建文件夹，返回最终路径 */
  createFolder: (parentDir: string, name?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.VAULT_CREATE_DIR, parentDir, name),

  /** 重命名文件或文件夹（含同名 .assets 同步），返回新路径 */
  renameItem: (oldPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke(IPC.VAULT_RENAME, oldPath, newName),

  /** 删除文件或文件夹（递归删除，含同名 .assets 清理） */
  deleteItem: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.VAULT_DELETE, targetPath),

  openFileDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE),

  saveFileDialog: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_SAVE_FILE, defaultPath),

  /** 选择笔记库根目录 */
  openDirDialog: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR),

  // ── 笔记库 ──

  listVault: (root: string): Promise<FileNode[]> =>
    ipcRenderer.invoke(IPC.VAULT_LIST, root),

  /** 全文搜索：在笔记库内递归检索所有 Markdown 文档内容，返回命中行 */
  searchVault: (root: string, query: string): Promise<SearchFileResult[]> =>
    ipcRenderer.invoke(IPC.VAULT_SEARCH, root, query),

  watchVault: (root: string): Promise<void> =>
    ipcRenderer.invoke(IPC.VAULT_WATCH, root),

  unwatchVault: (): Promise<void> => ipcRenderer.invoke(IPC.VAULT_UNWATCH),

  /** 磁盘上的外部改动持续推来（别的编辑器保存、Git 切分支、资源管理器改名） */
  onVaultChange: (callback: (change: VaultChange) => void): void => {
    ipcRenderer.on(IPC.VAULT_CHANGE, (_event, change: VaultChange) => callback(change))
  },

  // ── 会话持久化（崩溃恢复）──

  getSession: (): Promise<SessionState> => ipcRenderer.invoke(IPC.SESSION_GET),

  patchSession: (patch: Partial<SessionState>): Promise<SessionState> =>
    ipcRenderer.invoke(IPC.SESSION_PATCH, patch),

  // ── 自绘标题栏的窗口控制 ──
  minimize: (): void => ipcRenderer.send(IPC.WIN_MINIMIZE),

  toggleMaximize: (): void => ipcRenderer.send(IPC.WIN_TOGGLE_MAXIMIZE),

  close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),

  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED),

  onWindowStateChange: (callback: (state: WindowState) => void): void => {
    ipcRenderer.on(IPC.WIN_STATE_CHANGE, (_event, state: WindowState) => callback(state))
  },

  // ── 导出（HTML / PDF）──

  exportHtml: (payload: ExportPayload): Promise<ExportResult> =>
    ipcRenderer.invoke(IPC.EXPORT_HTML, payload),

  exportPdf: (payload: ExportPayload): Promise<ExportResult> =>
    ipcRenderer.invoke(IPC.EXPORT_PDF, payload),

  // ── 图片落盘 ──

  saveAsset: (payload: SaveAssetPayload): Promise<SavedAsset> =>
    ipcRenderer.invoke(IPC.ASSET_SAVE, payload),

  // ── 图床（密钥只在主进程）──

  getImgHost: (): Promise<ImgHostConfig | null> =>
    ipcRenderer.invoke(IPC.IMGHOST_GET),

  /**
   * 保存图床配置。token 为密钥明文，仅经此 IPC 传入主进程后由 safeStorage 加密落盘，
   * 绝不回传渲染层、绝不出现在 ImgHostConfig（渲染层读到的配置不含密钥）。
   */
  setImgHost: (config: ImgHostConfig | null, token: string): Promise<void> =>
    ipcRenderer.invoke(IPC.IMGHOST_SET, config, token),

  uploadToImgHost: (items: ImgHostUploadItem[]): Promise<ImgHostUploadResult> =>
    ipcRenderer.invoke(IPC.IMGHOST_UPLOAD, items),

  /** 上传文档内本地图片到图床，并把 Markdown 中的本地引用改写为远程 URL（密钥只在主进程） */
  publishImages: (markdown: string, docPath: string | null): Promise<PublishResult> =>
    ipcRenderer.invoke(IPC.IMGHOST_PUBLISH, markdown, docPath)
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
