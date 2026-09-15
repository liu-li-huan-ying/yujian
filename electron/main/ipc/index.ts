/**
 * 主进程 IPC 总注册口：按域分模块，此处只做汇总。
 * 窗口控制（ipc/win.ts）需绑定窗口实例，由 window.ts 在创建窗口时单独注册。
 */

import { registerAppIpc } from './app'
import { registerAssetsIpc } from './assets'
import { registerExportIpc } from './export'
import { registerFilesIpc } from './files'
import { registerPkmIpc } from './pkm'
import { registerSessionIpc } from './session'
import { registerSnapshotsIpc } from './snapshots'
import { registerVaultIpc } from './vault'

export function registerIpc(): void {
  registerAppIpc()
  registerFilesIpc()
  registerVaultIpc()
  registerPkmIpc()
  registerSessionIpc()
  registerAssetsIpc()
  registerSnapshotsIpc()
  registerExportIpc()
}
