/**
 * 主进程入口：只保留引导逻辑。
 *
 * 分工：assetProtocol（自定义协议）/ window（窗口创建与控制）/ ipc（全部 IPC 注册）。
 * 本文件应当长期保持在数十行量级 —— 新增能力请落到对应子模块，不要在此堆积。
 */

import { app, BrowserWindow } from 'electron'
import { registerAssetProtocol } from './assetProtocol'
import { registerIpc } from './ipc'
import { createWindow } from './window'
import { setSoftErrorVerbose } from './softError'

void app.whenReady().then(() => {
  // 打包后主进程没有可见控制台：软错误只入环（供完整性面板查阅），不再打印
  setSoftErrorVerbose(!app.isPackaged)
  registerAssetProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
