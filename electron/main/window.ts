/**
 * 主窗口的创建与窗口控制：自绘标题栏所需的 IPC、兼容模式开关、主窗口引用。
 * `mainWindow` 由本模块统一持有（笔记库监听需要往渲染层推事件）。
 */

import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { stopWatching } from './vault'
import { registerWindowIpc } from './ipc/win'
import { setSafetySink } from './safetyEvents'
import { IPC } from '../shared/ipc-channels'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/** 主窗口引用：笔记库监听需要往渲染层推事件 */
let mainWindow: BrowserWindow | null = null

/** 取得主窗口（未创建时返回 null） */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

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

export function createWindow(): void {
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
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 拼写检查（2026-10-04）：写作工具的核心期待，中文用户无感、英文用户明显缺失。
      // ⚠️ 刻意**不开** backgroundThrottling:false —— 那会让后台一直满负荷渲染。
      // 自动保存被节流的问题改由渲染层「失焦即保存」精准解决
      // （见 src/utils/flushGuard.ts：写作场景「边写边查资料」很常见）。
      spellcheck: true,
    },
  })

  registerWindowIpc(win)

  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
    // 窗口销毁时必须解绑 sink：否则 sink 里捕获的 win 已失效，
    // 之后再发生降级会往一个已销毁的 webContents 发消息而抛错。
    // 且此时 getMainWindow() 已返回 null，sink 本身也该退休了。
    setSafetySink(null)
    stopWatching()
  })

  win.once('ready-to-show', () => win.show())

  // 安全网降级事件 → 渲染层实时推送（2026-10-04 补链路）：
  // 此前 setSafetySink 从未被调用，降级事件只进主进程内存环、**渲染层收不到**，
  // 表现为「上一轮做完的事只到 IPC 边界就断了」。这里接上最后一跳。
  setSafetySink((notice) => {
    // 窗口可能已销毁（sink 解绑有竞态窗口），故双重判空而非只靠 closed 事件
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return
    w.webContents.send(IPC.SAFETY_NOTICE, notice)
  })

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
