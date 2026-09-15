/** 会话持久化 IPC（崩溃恢复）。 */

import { ipcMain } from 'electron'
import { IPC, type SessionState } from '../../shared/ipc-channels'
import { patchSession, readSession } from '../session'

export function registerSessionIpc(): void {
  // ── 会话持久化（崩溃恢复）──

  ipcMain.handle(IPC.SESSION_GET, () => readSession())

  ipcMain.handle(IPC.SESSION_PATCH, async (_event, patch: Partial<SessionState>) =>
    patchSession(patch),
  )
}
