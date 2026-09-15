/** 应用级 IPC：版本号 / 原生主题跟随 / 外链打开 / 软错误查阅与清空。 */

import { app, ipcMain, nativeTheme, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { clearSoftErrors, countSoftErrors, getSoftErrors, summarizeSoftErrors } from '../softError'

export function registerAppIpc(): void {
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

  // 软错误（已知可容忍失败）查阅：把被 catch 吞掉的 IO 失败暴露给完整性面板。
  // 纯读内存环（softError.ts），无写操作，故不需要二次确认。
  ipcMain.handle(IPC.SOFT_ERRORS_GET, async (_event, limit?: number) => ({
    entries: getSoftErrors({ limit }),
    summary: summarizeSoftErrors(),
    warnCount: countSoftErrors(),
  }))

  // 软错误清空：用户确认已知晓后调用。返回清掉的条数。
  ipcMain.handle(IPC.SOFT_ERRORS_CLEAR, async () => ({ cleared: clearSoftErrors() }))
}
