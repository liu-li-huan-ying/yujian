import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
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
  type SearchOptions
} from '../shared/ipc-channels'
import { createDoc, createFolder, deleteItem, listTree, renameItem, replaceInVault, searchVault, stopWatching, watchVault, checkLinks } from './vault'
import { patchSession, readSession } from './session'
import { saveAsset } from './assets'
import { getImgHost, setImgHost, uploadToImgHost, publishImages } from './imghost'
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot, setSnapshotTags } from './snapshots'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

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
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
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
    // 先写临时文件再改名：写入中途崩溃也不会损坏原文
    const dir = dirname(filePath)
    const tmp = join(dir, `.${Date.now()}.tmp`)
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, filePath)
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

  ipcMain.handle(IPC.VAULT_LIST, async (_event, root: string) => listTree(root))

  ipcMain.handle(IPC.VAULT_WATCH, (_event, root: string) => {
    watchVault(root, (change: VaultChange) => {
      mainWindow?.webContents.send(IPC.VAULT_CHANGE, change)
    })
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
    const tmp = join(tmpdir(), `.yujian-export-${Date.now()}.html`)
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
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
