/** 自绘标题栏的窗口控制 IPC（绑定到具体窗口实例，由 window.ts 在创建窗口时注册）。 */

import { BrowserWindow, ipcMain } from 'electron'
import { IPC, type WindowState } from '../../shared/ipc-channels'

export function registerWindowIpc(win: BrowserWindow): void {
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
