/** 文件读写 / 新建改名删除移动 / 系统文件对话框。 */

import { dialog, ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { IPC, type FileStat, type ReadBase64Result } from '../../shared/ipc-channels'
import { errMsg } from '../../shared/error'
import { atomicWrite } from '../atomicWrite'
import { backupBeforeSave, readPrevContent } from '../autoBackup'
import { createDoc, createFolder, deleteItem, moveItem, renameItem } from '../vault'
import { reportSoftError } from '../softError'

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]

export function registerFilesIpc(): void {
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
    '.avif': 'image/avif',
  }

  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string) => readFile(filePath, 'utf-8'))

  /** 文件元信息：mtime / 字节数（冲突检测展示磁盘修改时间）。不存在时 exists:false */
  ipcMain.handle(IPC.FILE_STAT, async (_event, filePath: string): Promise<FileStat> => {
    try {
      const s = await stat(filePath)
      return { exists: true, mtimeMs: s.mtimeMs, size: s.size }
    } catch (e) {
      reportSoftError('file.stat', e, 'debug')
      return { exists: false, mtimeMs: 0, size: 0 }
    }
  })

  // 读二进制为 data URL（导出内联图片）；未知扩展名兜底为通用二进制类型
  ipcMain.handle(
    IPC.FILE_READ_BASE64,
    async (_event, filePath: string): Promise<ReadBase64Result> => {
      try {
        const buf = await readFile(filePath)
        const mime = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
        return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
      } catch (e) {
        return { ok: false, error: errMsg(e) }
      }
    },
  )

  ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string) => {
    // 保命防线：覆盖前把上一版留给版本历史（库内 / 非空 / 内容有变 才留档；
    // 失败只记软错误，绝不阻断本次保存）。详见 autoBackup.ts 的设计取舍。
    const prev = await readPrevContent(filePath)
    if (prev !== content) await backupBeforeSave(filePath, prev)
    // 原子写（临时文件 + rename），并对 Windows 只读 / 同步锁导致的 rename EPERM 做兜底
    await atomicWrite(filePath, content)
  })

  ipcMain.handle(IPC.FILE_CREATE, async (_event, dir: string, name?: string) =>
    createDoc(dir, name ?? '未命名'),
  )

  ipcMain.handle(IPC.VAULT_CREATE_DIR, async (_event, parentDir: string, name?: string) =>
    createFolder(parentDir, name ?? '未命名文件夹'),
  )

  ipcMain.handle(IPC.VAULT_RENAME, async (_event, oldPath: string, newName: string) =>
    renameItem(oldPath, newName),
  )

  ipcMain.handle(IPC.VAULT_DELETE, async (_event, targetPath: string) => deleteItem(targetPath))

  ipcMain.handle(
    IPC.VAULT_MOVE,
    async (_event, oldPath: string, destDir: string, newName?: string) =>
      moveItem(oldPath, destDir, newName),
  )

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: MD_FILTERS,
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_SAVE_FILE, async (_event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: MD_FILTERS,
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DIR, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
}
