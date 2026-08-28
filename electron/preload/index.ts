import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type WindowState } from '../shared/ipc-channels'

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

  openFileDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE),

  saveFileDialog: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_SAVE_FILE, defaultPath),

  // ── 自绘标题栏的窗口控制 ──
  minimize: (): void => ipcRenderer.send(IPC.WIN_MINIMIZE),

  toggleMaximize: (): void => ipcRenderer.send(IPC.WIN_TOGGLE_MAXIMIZE),

  close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),

  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WIN_IS_MAXIMIZED),

  onWindowStateChange: (callback: (state: WindowState) => void): void => {
    ipcRenderer.on(IPC.WIN_STATE_CHANGE, (_event, state: WindowState) => callback(state))
  }
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
