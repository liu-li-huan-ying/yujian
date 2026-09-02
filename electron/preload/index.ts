import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type ExportPayload,
  type ExportResult,
  type FileStat,
  type FileNode,
  type ImgHostConfig,
  type ImgHostUploadItem,
  type ImgHostUploadResult,
  type PublishResult,
  type ReadBase64Result,
  type SaveAssetPayload,
  type SavedAsset,
  type ReplaceResult,
  type SearchOptions,
  type SearchResult,
  type SessionState,
  type SnapshotInfo,
  type BrokenLinkReport,
  type VaultChange,
  type WindowState,
  type IntegrityReport,
  type RepairResult,
  type BackupResult,
  type RestoreResult,
  type BacklinkItem,
  type NoteTitleItem,
  type UnlinkedMention
} from '../shared/ipc-channels'

/**
 * 只暴露受控 API。绝不暴露 ipcRenderer 本身或任何 Node 能力。
 */
const api = {
  /** 平台标识：macOS 保留原生红绿灯，Windows / Linux 自绘窗口控制按钮 */
  platform: process.platform,

  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),

  /** 外观：把 app 选中的明暗模式同步到 Electron 原生主题（保存框 / 菜单等原生控件） */
  setNativeTheme: (mode: 'dark' | 'light' | 'system'): Promise<void> =>
    ipcRenderer.invoke(IPC.APP_SET_NATIVE_THEME, mode),

  /** 用系统默认浏览器打开外部链接（Ctrl/⌘+点击编辑器内链接跳转） */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),

  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_READ, filePath),

  /** 读二进制并按扩展名推断 mime，返回 data URL（导出内联图片用）；失败返回 ok:false */
  readFileBase64: (filePath: string): Promise<ReadBase64Result> =>
    ipcRenderer.invoke(IPC.FILE_READ_BASE64, filePath),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FILE_WRITE, filePath, content),

  /** 文件元信息（mtime / 字节数），冲突检测展示磁盘修改时间用 */
  statFile: (filePath: string): Promise<FileStat> =>
    ipcRenderer.invoke(IPC.FILE_STAT, filePath),

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

  /** 全文搜索：在笔记库内检索 Markdown 文档内容，返回命中行。
      file 传入时只搜该单文件（左侧「本文档」范围），不传则递归全库（「全部」范围）。
      opts 支持区分大小写 / 全词匹配；返回含 `truncated` 表示结果因过多被截断。 */
  searchVault: (
    root: string,
    query: string,
    opts?: SearchOptions,
    file?: string
  ): Promise<SearchResult> =>
    ipcRenderer.invoke(IPC.VAULT_SEARCH, root, query, opts, file),

  /** 替换：在搜索命中的文件范围内把 query 全部替换为 replacement（匹配规则与 searchVault 一致）。
      file 传入时仅在单文档范围内替换，不传则全库命中文件范围。 */
  replaceInVault: (
    root: string,
    query: string,
    replacement: string,
    opts?: SearchOptions,
    file?: string
  ): Promise<ReplaceResult> =>
    ipcRenderer.invoke(IPC.VAULT_REPLACE, root, query, replacement, opts, file),

  /** 链接健康检查：扫描 vault 内失效的 [[wikilink]] / 相对路径链接 / 图片，返回断链报告 */
  checkLinks: (root: string): Promise<BrokenLinkReport> =>
    ipcRenderer.invoke(IPC.VAULT_CHECK_LINKS, root),

  /** 完整性自检：扫描索引/磁盘不一致、孤儿快照、缺失附件、断链，返回分组报告 */
  checkIntegrity: (root: string): Promise<IntegrityReport> =>
    ipcRenderer.invoke(IPC.VAULT_INTEGRITY_CHECK, root),

  /** 一键修复：重建索引 / 删除孤儿快照（破坏性动作须前端二次确认后传入） */
  repairIntegrity: (root: string, actions: string[]): Promise<RepairResult> =>
    ipcRenderer.invoke(IPC.VAULT_INTEGRITY_REPAIR, root, actions),

  /** 整库备份：打包为 zip 到 destZip（用户经保存对话框选定） */
  backupVault: (root: string, destZip: string): Promise<BackupResult> =>
    ipcRenderer.invoke(IPC.VAULT_BACKUP, root, destZip),

  /** 整库恢复：从 zip 解包到 targetRoot（默认当前 vault 根） */
  restoreVault: (zipPath: string, targetRoot: string): Promise<RestoreResult> =>
    ipcRenderer.invoke(IPC.VAULT_RESTORE, zipPath, targetRoot),

  /** 双链：把 [[wikilink]] 目标解析为 vault 内绝对路径；找不到返回 null */
  resolveWikiTarget: (root: string, target: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.VAULT_RESOLVE_WIKILINK, root, target),

  /** 双链：反链查询——哪些笔记链接到指定文档，附引用行上下文片段 */
  getBacklinks: (root: string, absPath: string): Promise<BacklinkItem[]> =>
    ipcRenderer.invoke(IPC.VAULT_GET_BACKLINKS, root, absPath),

  /** 双链：[[ 自动补全候选——全部笔记标题（纯索引元数据，不读正文） */
  listNotes: (root: string): Promise<NoteTitleItem[]> =>
    ipcRenderer.invoke(IPC.VAULT_LIST_NOTES, root),

  /** 双链：未链接提及查询——纯文本提到当前笔记名但未加 [[ ]] 的片段 */
  getUnlinkedMentions: (root: string, absPath: string): Promise<UnlinkedMention[]> =>
    ipcRenderer.invoke(IPC.VAULT_UNLINKED_MENTIONS, root, absPath),

  /** 双链：把未链接提及包裹成 [[链接]] 写回磁盘；原文已变时返回 false */
  wrapMention: (root: string, item: UnlinkedMention): Promise<boolean> =>
    ipcRenderer.invoke(IPC.VAULT_WRAP_MENTION, root, item),

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

  /** 凝神 2.0：进入时自动全屏（偏好开关，默认关） */
  setFullscreen: (flag: boolean): void => ipcRenderer.send(IPC.WIN_SET_FULLSCREEN, flag),

  onWindowStateChange: (callback: (state: WindowState) => void): void => {
    ipcRenderer.on(IPC.WIN_STATE_CHANGE, (_event, state: WindowState) => callback(state))
  },

  // ── 导出（HTML / LaTeX 等文本产物 / PDF）──

  /** 通用写盘导出：content 为产物全文，filters 决定保存对话框的文件类型 */
  exportFile: (payload: ExportPayload): Promise<ExportResult> =>
    ipcRenderer.invoke(IPC.EXPORT_FILE, payload),

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
    ipcRenderer.invoke(IPC.IMGHOST_PUBLISH, markdown, docPath),

  // ── 版本快照（Phase 2 批次二）──

  /** 列出某文档的全部快照（按时间倒序） */
  snapshotList: (vaultPath: string, filePath: string): Promise<SnapshotInfo[]> =>
    ipcRenderer.invoke(IPC.SNAPSHOT_LIST, vaultPath, filePath),

  /** 保存一份快照（note / tags / branch 可选）；内容哈希相同则自动去重（blob 跨分支共享） */
  snapshotCreate: (
    vaultPath: string,
    filePath: string,
    content: string,
    note?: string,
    tags?: string[],
    branch?: string
  ): Promise<SnapshotInfo> =>
    ipcRenderer.invoke(IPC.SNAPSHOT_CREATE, vaultPath, filePath, content, note, tags, branch),

  /** 读取某快照内容（用于回滚） */
  snapshotRestore: (vaultPath: string, filePath: string, id: string): Promise<string> =>
    ipcRenderer.invoke(IPC.SNAPSHOT_RESTORE, vaultPath, filePath, id),

  /** 删除某快照（走系统回收站） */
  snapshotDelete: (vaultPath: string, filePath: string, id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SNAPSHOT_DELETE, vaultPath, filePath, id),

  /** 更新某快照的命名标签（git tag 思想）：终稿 / 投稿版 / v1.0 等 */
  snapshotSetTags: (
    vaultPath: string,
    filePath: string,
    id: string,
    tags: string[]
  ): Promise<SnapshotInfo | null> =>
    ipcRenderer.invoke(IPC.SNAPSHOT_SET_TAGS, vaultPath, filePath, id, tags)
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
