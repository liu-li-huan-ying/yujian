import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { IPC, type WindowState } from '../shared/ipc-channels'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

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
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#16171B',
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

  const notify = (): void => {
    const state: WindowState = { maximized: win.isMaximized() }
    win.webContents.send(IPC.WIN_STATE_CHANGE, state)
  }
  win.on('maximize', notify)
  win.on('unmaximize', notify)
}

function registerIpc(): void {
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string) =>
    readFile(filePath, 'utf-8')
  )

  ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string) => {
    // 先写临时文件再改名：写入中断也不会损坏原文
    const dir = dirname(filePath)
    const tmp = join(dir, `.${Date.now()}.tmp`)
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, content, 'utf-8')
    const { rename } = await import('node:fs/promises')
    await rename(tmp, filePath)
  })

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
