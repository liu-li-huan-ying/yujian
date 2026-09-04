import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron'
import { readFile, stat, unlink, writeFile, readdir, copyFile } from 'node:fs/promises'
import { atomicWrite } from './atomicWrite'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  IPC,
  type ExportPayload,
  type ExportResult,
  type ImgHostConfig,
  type ImgHostUploadItem,
  type PublishResult,
  type ReadBase64Result,
  type SaveAssetPayload,
  type SavedAsset,
  type SessionState,
  type SnapshotInfo,
  type VaultChange,
  type WindowState,
  type SearchOptions,
  type IntegrityAction,
  type FileStat,
  type UnlinkedMention
} from '../shared/ipc-channels'
import { createDoc, createFolder, deleteItem, listTree, renameItem, moveItem, replaceInVault, searchVault, stopWatching, watchVault, checkLinks } from './vault'
import * as VaultIndex from './vaultIndex'
import * as VaultIntegrity from './vaultIntegrity'
import * as VaultBackup from './vaultBackup'
import { patchSession, readSession } from './session'
import { saveAsset } from './assets'
import { getImgHost, setImgHost, uploadToImgHost, publishImages } from './imghost'
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot, setSnapshotTags } from './snapshots'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/**
 * 自定义资源协议 `jade-asset://`：渲染层把相对图片路径解析为绝对路径后，
 * 以 `jade-asset://local/<encodeURIComponent(绝对路径)>` 形式引用。
 * 主进程按绝对路径读盘返回字节流。
 *
 * 为什么不用 `file://`：开发模式渲染进程跑在 `http://localhost`，
 * 浏览器会拦截 http 源加载 `file://` 资源，导致图片在 dev 下全部裂开；
 * 生产用 `loadFile`（`file://` 源）则正常。统一走特权自定义协议后，
 * 开发 / 生产两种加载方式都能正确显示，且避免 `file://` 跨源限制。
 *
 * 必须在 app ready 之前注册（registerSchemesAsPrivileged）。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jade-asset',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
])

/** 按扩展名推断图片 MIME（协议处理器返回时使用） */
const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

/**
 * 处理 `jade-asset://local/<encoded-abs-path>` 请求：
 * 解码出磁盘绝对路径 → 读盘 → 以对应 MIME 返回。
 * 仅渲染层（本应用自身代码）会构造这种 URL，路径来自当前文档目录，不存在越权读取。
 */
function handleJadeAsset(request: GlobalRequest): GlobalResponse {
  try {
    const url = new URL(request.url)
    // pathname 形如 /%2FC%3A%2F...（绝对路径整体被 encodeURIComponent），
    // 解码后会多出一个协议层引入的前导斜杠：//C:/...（Windows）或 //Users/...（macOS）。
    let abs = decodeURIComponent(url.pathname)
    // 去掉那一个多余的协议层前导斜杠，恢复真实绝对路径
    abs = abs.replace(/^\//, '')
    // Windows 盘符归一：/C:/... → C:/...
    abs = abs.replace(/^\/([A-Za-z]:)/, '$1')
    const buf = readFileSync(abs)
    const mime = ASSET_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    return new Response(buf as unknown as BodyInit, {
      headers: {
        'content-type': mime,
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=31536000, immutable'
      }
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

/** 主窗口引用：笔记库监听需要往渲染层推事件 */
let mainWindow: BrowserWindow | null = null

/**
 * 兼容模式：受限环境（CI、无 GPU 的容器、沙箱）下 GPU 进程会反复崩溃，
 * 最终触发 "GPU process isn't usable" 导致应用直接退出。
 *
 * 常规桌面使用不要开启 —— 其中的 no-sandbox 会降低 Chromium 沙箱强度。
 * 需要时：MD_EDITOR_COMPAT_MODE=1 npm run dev
 */
if (process.env.MD_EDITOR_COMPAT_MODE === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

function createWindow(): void {
  // 应用图标：开发期指向项目 build/icon.png；打包后 exe 图标由 electron-builder 注入，
  // build/icon.png 不再随包发布，此时 existsSync 为 false → 回退到平台默认。
  const iconFile = join(app.getAppPath(), 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#16171B',
    icon: existsSync(iconFile) ? iconFile : undefined,
    // 隐藏原生标题栏，改用自绘标题栏。
    // 注意：不能用 frame:false —— 那会让 Windows 窗口失去拖拽边框与阴影。
    // titleBarStyle:'hidden' 只移除标题栏区域，缩放与阴影都保留。
    // macOS 用 hiddenInset 保留原生红绿灯（更符合平台习惯）。
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition:
      process.platform === 'darwin' ? { x: 14, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  registerWindowIpc(win)

  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
    stopWatching()
  })

  win.once('ready-to-show', () => win.show())

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]

/** 自绘标题栏的窗口控制 */
function registerWindowIpc(win: BrowserWindow): void {
  ipcMain.on(IPC.WIN_MINIMIZE, () => win.minimize())

  ipcMain.on(IPC.WIN_TOGGLE_MAXIMIZE, () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on(IPC.WIN_CLOSE, () => win.close())

  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, () => win.isMaximized())

  // 凝神 2.0：进入时自动全屏（偏好开关，默认关）
  ipcMain.on(IPC.WIN_SET_FULLSCREEN, (_event, flag: unknown) => {
    win.setFullScreen(flag === true)
  })

  const notify = (): void => {
    const state: WindowState = { maximized: win.isMaximized() }
    win.webContents.send(IPC.WIN_STATE_CHANGE, state)
  }
  win.on('maximize', notify)
  win.on('unmaximize', notify)
}

function registerIpc(): void {
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion())

  // 外观：让原生保存框 / 菜单等随 app 明暗模式切换，避免深色 app 里弹出浅色对话框、文字发白看不清
  ipcMain.handle(IPC.APP_SET_NATIVE_THEME, (_event, mode: unknown) => {
    if (mode === 'dark' || mode === 'light' || mode === 'system') {
      nativeTheme.themeSource = mode
    }
  })

  // 渲染层请求用系统默认浏览器打开外部链接（Ctrl/⌘+点击编辑器内链接跳转）。
  // 仅放行 http(s)，避免 file:// 或 javascript: 等被误打开。
  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, (_event, url: string) => {
    // 只放行 http(s) 与 file://（用户自己的本地文件）——拒绝 javascript:/data:/vbscript: 等危险协议
    if (typeof url === 'string' && (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url))) {
      void shell.openExternal(url)
    }
  })

  /** 图片内联：按扩展名推断 mime（导出内联图片用） */
  const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif'
  }

  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string) =>
    readFile(filePath, 'utf-8')
  )

  /** 文件元信息：mtime / 字节数（冲突检测展示磁盘修改时间）。不存在时 exists:false */
  ipcMain.handle(IPC.FILE_STAT, async (_event, filePath: string): Promise<FileStat> => {
    try {
      const s = await stat(filePath)
      return { exists: true, mtimeMs: s.mtimeMs, size: s.size }
    } catch {
      return { exists: false, mtimeMs: 0, size: 0 }
    }
  })

  // 读二进制为 data URL（导出内联图片）；未知扩展名兜底为通用二进制类型
  ipcMain.handle(
    IPC.FILE_READ_BASE64,
    async (_event, filePath: string): Promise<ReadBase64Result> => {
      try {
        const buf = await readFile(filePath)
        const mime = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
        return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string) => {
    // 原子写（临时文件 + rename），并对 Windows 只读 / 同步锁导致的 rename EPERM 做兜底
    await atomicWrite(filePath, content)
  })

  ipcMain.handle(IPC.FILE_CREATE, async (_event, dir: string, name?: string) =>
    createDoc(dir, name ?? '未命名')
  )

  ipcMain.handle(IPC.VAULT_CREATE_DIR, async (_event, parentDir: string, name?: string) =>
    createFolder(parentDir, name ?? '未命名文件夹')
  )

  ipcMain.handle(IPC.VAULT_RENAME, async (_event, oldPath: string, newName: string) =>
    renameItem(oldPath, newName)
  )

  ipcMain.handle(IPC.VAULT_DELETE, async (_event, targetPath: string) =>
    deleteItem(targetPath)
  )

  ipcMain.handle(
    IPC.VAULT_MOVE,
    async (_event, oldPath: string, destDir: string, newName?: string) =>
      moveItem(oldPath, destDir, newName)
  )

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: MD_FILTERS
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_SAVE_FILE, async (_event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: MD_FILTERS
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DIR, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── 笔记库 ──

  /**
   * 空库欢迎文档：全新空库首次打开时，自动放入随包发布的《使用说明》。
   * 仅当库根不存在「使用说明.md」且没有任何 .md 笔记时播种，
   * 既保证「安装即自带」，又绝不污染已有笔记文件夹、也尊重用户的删除。
   */
  async function seedWelcomeDoc(root: string): Promise<void> {
    try {
      const target = join(root, '使用说明.md')
      if (existsSync(target)) return
      const entries = await readdir(root)
      if (entries.some((n) => /\.(md|markdown)$/i.test(n))) return
      const candidates = [
        join(process.resourcesPath, 'resources', '使用说明.md'),
        join(app.getAppPath(), 'resources', '使用说明.md')
      ]
      const src = candidates.find((p) => existsSync(p))
      if (!src) return
      await copyFile(src, target)
    } catch {
      // 播种失败静默忽略，绝不影响正常使用
    }
  }

  ipcMain.handle(IPC.VAULT_LIST, async (_event, root: string) => listTree(root))

  ipcMain.handle(IPC.VAULT_WATCH, (_event, root: string) => {
    watchVault(root, (change: VaultChange) => {
      mainWindow?.webContents.send(IPC.VAULT_CHANGE, change)
    })
    void seedWelcomeDoc(root)
  })

  ipcMain.handle(IPC.VAULT_UNWATCH, () => stopWatching())

  ipcMain.handle(
    IPC.VAULT_SEARCH,
    (_event, root: string, query: string, opts?: SearchOptions, file?: string) =>
      searchVault(root, query, opts, file)
  )

  ipcMain.handle(
    IPC.VAULT_REPLACE,
    (
      _event,
      root: string,
      query: string,
      replacement: string,
      opts?: SearchOptions,
      file?: string
    ) => replaceInVault(root, query, replacement, opts, file)
  )

  ipcMain.handle(IPC.VAULT_CHECK_LINKS, async (_event, root: string) => checkLinks(root))

  // 统一索引层：手动重建（自检 / 用户触发）。索引是「可重建缓存」，丢失本会静默自动重建，此通道供显式重建。
  ipcMain.handle(IPC.VAULT_INDEX_REBUILD, async (_event, root: string) => {
    const built = await VaultIndex.buildIndex(root)
    await VaultIndex.saveIndex(root, built)
    return { ok: true, files: Object.keys(built.files).length }
  })

  // 完整性自检：扫描索引/磁盘不一致、孤儿快照、缺失附件、断链（详见 vaultIntegrity.ts）。
  ipcMain.handle(IPC.VAULT_INTEGRITY_CHECK, async (_event, root: string) =>
    VaultIntegrity.runIntegrityCheck(root)
  )

  // 一键修复：重建索引 / 删除孤儿快照（破坏性动作由前端二次确认后传入）。
  ipcMain.handle(
    IPC.VAULT_INTEGRITY_REPAIR,
    async (_event, root: string, actions: string[]) =>
      VaultIntegrity.repairIntegrity(root, actions as IntegrityAction[])
  )

  // 整库备份：打包为 zip 到用户选定的目标路径（排除 .mdeditor 缓存）。
  ipcMain.handle(
    IPC.VAULT_BACKUP,
    async (_event, root: string, destZip: string) => VaultBackup.backupVault(root, destZip)
  )

  // 整库恢复：从 zip 解包到目标根（默认当前 vault 根，覆盖同名文件；含 zip-slip 防护）。
  ipcMain.handle(
    IPC.VAULT_RESTORE,
    async (_event, zipPath: string, targetRoot: string) =>
      VaultBackup.restoreVault(zipPath, targetRoot)
  )

  // 双链：把 [[wikilink]] 目标解析为 vault 内绝对路径（找不到返回 null，由前端决定创建或提示）
  ipcMain.handle(IPC.VAULT_RESOLVE_WIKILINK, (_event, root: string, target: string) =>
    VaultIndex.resolveWikiTarget(root, target)
  )

  // 双链：反链查询——哪些笔记链接到指定文档，附引用行上下文片段
  ipcMain.handle(IPC.VAULT_GET_BACKLINKS, (_event, root: string, absPath: string) =>
    VaultIndex.getBacklinksWithContext(root, absPath)
  )
  // 双链：[[ 自动补全候选——全部笔记标题（纯索引元数据，不读正文）
  ipcMain.handle(IPC.VAULT_LIST_NOTES, (_event, root: string) => VaultIndex.listNoteTitles(root))
  // 双链：未链接提及查询——纯文本提到当前笔记名但未加 [[ ]] 的片段
  ipcMain.handle(IPC.VAULT_UNLINKED_MENTIONS, (_event, root: string, absPath: string) =>
    VaultIndex.getUnlinkedMentions(root, absPath)
  )
  // 双链：把未链接提及包裹成 [[链接]] 写回磁盘（落笔前回验原文，绝不静默覆盖）
  ipcMain.handle(
    IPC.VAULT_WRAP_MENTION,
    async (_event, root: string, item: UnlinkedMention) =>
      VaultIndex.wrapUnlinkedMention(root, item)
  )
  // 标签聚合：列出全部标签（含计数 / 层级），由索引派生不存原始图
  ipcMain.handle(IPC.VAULT_LIST_TAGS, (_event, root: string) => VaultIndex.listTags(root))
  // 标签聚合：按标签列出旗下笔记（点击标签面板条目时拉取）
  ipcMain.handle(IPC.VAULT_GET_NOTES_BY_TAG, (_event, root: string, tag: string) =>
    VaultIndex.getNotesByTag(root, tag),
  )
  // 内容地图：列出全库 moc: true 的笔记（主题入口清单）
  ipcMain.handle(IPC.VAULT_LIST_MOCS, (_event, root: string) => VaultIndex.listMocs(root))
  // 内容地图：某篇 MOC 的下级聚合（标签 / 出链 / 反链分组）
  ipcMain.handle(IPC.VAULT_GET_MOC_OUTLINE, (_event, root: string, path: string) =>
    VaultIndex.getMocOutline(root, path),
  )

  // ── 会话持久化（崩溃恢复）──

  ipcMain.handle(IPC.SESSION_GET, () => readSession())

  ipcMain.handle(IPC.SESSION_PATCH, async (_event, patch: Partial<SessionState>) =>
    patchSession(patch)
  )

  // ── 导出（HTML / PDF）──

  ipcMain.handle(IPC.ASSET_SAVE, async (_event, payload: SaveAssetPayload): Promise<SavedAsset> =>
    saveAsset(payload.docPath, payload.vaultPath, payload.base64, payload.ext)
  )

  ipcMain.handle(IPC.IMGHOST_GET, () => getImgHost())

  ipcMain.handle(IPC.IMGHOST_SET, (_event, config: ImgHostConfig | null, token: string) =>
    setImgHost(config, token)
  )

  ipcMain.handle(IPC.IMGHOST_UPLOAD, async (_event, items: ImgHostUploadItem[]) =>
    uploadToImgHost(items)
  )

  ipcMain.handle(
    IPC.IMGHOST_PUBLISH,
    async (_event, markdown: string, docPath: string | null): Promise<PublishResult> =>
      publishImages(markdown, docPath)
  )

  // ── 版本快照（Phase 2 批次二）──

  ipcMain.handle(
    IPC.SNAPSHOT_LIST,
    async (_event, vaultPath: string, filePath: string): Promise<SnapshotInfo[]> =>
      listSnapshots(vaultPath, filePath)
  )

  ipcMain.handle(
    IPC.SNAPSHOT_CREATE,
    async (
      _event,
      vaultPath: string,
      filePath: string,
      content: string,
      note?: string,
      tags?: string[],
      branch?: string
    ): Promise<SnapshotInfo> =>
      createSnapshot(vaultPath, filePath, content, note, tags, branch)
  )

  ipcMain.handle(
    IPC.SNAPSHOT_RESTORE,
    async (_event, vaultPath: string, filePath: string, id: string): Promise<string> =>
      restoreSnapshot(vaultPath, filePath, id)
  )

  ipcMain.handle(
    IPC.SNAPSHOT_DELETE,
    async (_event, vaultPath: string, filePath: string, id: string): Promise<void> =>
      deleteSnapshot(vaultPath, filePath, id)
  )

  ipcMain.handle(
    IPC.SNAPSHOT_SET_TAGS,
    async (
      _event,
      vaultPath: string,
      filePath: string,
      id: string,
      tags: string[]
    ): Promise<SnapshotInfo | null> => setSnapshotTags(vaultPath, filePath, id, tags)
  )

  // 通用写盘导出：HTML / LaTeX 等文本产物共用，保存对话框类型由 payload.filters 决定。
  // 二进制格式（docx/epub/rtf/odt）经 binaryBase64 传字节，优先按其写盘。
  ipcMain.handle(IPC.EXPORT_FILE, async (_event, payload: ExportPayload): Promise<ExportResult> => {
    const ext = extname(payload.defaultName).replace(/^\./, '') || 'txt'
    const result = await dialog.showSaveDialog({
      defaultPath: payload.defaultName,
      filters: payload.filters ?? [{ name: '文件', extensions: [ext] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      if (payload.binaryBase64) {
        // 二进制：base64 解码为 Buffer 写盘（保留二进制精确性，避免文本编码损坏）
        await writeFile(result.filePath, Buffer.from(payload.binaryBase64, 'base64'))
      } else {
        await writeFile(result.filePath, payload.content, 'utf-8')
      }
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.EXPORT_PDF, async (_event, payload: ExportPayload): Promise<ExportResult> => {
    const result = await dialog.showSaveDialog({
      defaultPath: payload.defaultName,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    // 用隐藏窗口渲染 HTML，再走系统打印管线生成 PDF（所见即所得导出）
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true }
    })
    // 落临时文件再 loadFile：避免超大文档超出 data: URL 长度上限
    const tmp = join(tmpdir(), `.yujian-export-${randomUUID()}.html`)
    try {
      await writeFile(tmp, payload.content, 'utf-8')
      await win.loadFile(tmp)
      // 等首屏与图表（mermaid）渲染完成再打印
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 600)
        win.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      const buf = await win.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4'
      })
      await writeFile(result.filePath, buf)
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      win.destroy()
      await unlink(tmp).catch(() => {})
    }
  })
}

void app.whenReady().then(() => {
  protocol.handle('jade-asset', handleJadeAsset)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
