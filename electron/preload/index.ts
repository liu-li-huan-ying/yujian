import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'

/**
 * 只暴露受控 API。绝不暴露 ipcRenderer 本身或任何 Node 能力。
 */
const api = {
  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),

  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FILE_READ, filePath),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FILE_WRITE, filePath, content)
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
