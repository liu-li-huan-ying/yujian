/** 导出落盘 IPC：文本 / 二进制共用写盘，PDF 走隐藏窗口 + 系统打印管线。 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { IPC, type ExportPayload, type ExportResult } from '../../shared/ipc-channels'
import { errMsg } from '../../shared/error'

export function registerExportIpc(): void {
  // 通用写盘导出：HTML / LaTeX 等文本产物共用，保存对话框类型由 payload.filters 决定。
  // 二进制格式（docx/epub/rtf/odt）经 binaryBase64 传字节，优先按其写盘。
  ipcMain.handle(IPC.EXPORT_FILE, async (_event, payload: ExportPayload): Promise<ExportResult> => {
    const ext = extname(payload.defaultName).replace(/^\./, '') || 'txt'
    const result = await dialog.showSaveDialog({
      defaultPath: payload.defaultName,
      filters: payload.filters ?? [{ name: '文件', extensions: [ext] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      if (payload.binaryBase64) {
        // 二进制：base64 解码为 Buffer 写盘（保留二进制精确性，避免文本编码损坏）
        await writeFile(result.filePath, Buffer.from(payload.binaryBase64, 'base64'))
      } else {
        await writeFile(result.filePath, payload.content, 'utf-8')
      }
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    }
  })

  ipcMain.handle(IPC.EXPORT_PDF, async (_event, payload: ExportPayload): Promise<ExportResult> => {
    const result = await dialog.showSaveDialog({
      defaultPath: payload.defaultName,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    // 用隐藏窗口渲染 HTML，再走系统打印管线生成 PDF（所见即所得导出）
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true },
    })
    // 落临时文件再 loadFile：避免超大文档超出 data: URL 长度上限
    const tmp = join(tmpdir(), `.yujian-export-${randomUUID()}.html`)
    try {
      await writeFile(tmp, payload.content, 'utf-8')
      await win.loadFile(tmp)
      // 等首屏与图表（mermaid）渲染完成再打印
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 600)
        win.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      const buf = await win.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4',
      })
      await writeFile(result.filePath, buf)
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    } finally {
      win.destroy()
      await unlink(tmp).catch(() => {})
    }
  })
}
