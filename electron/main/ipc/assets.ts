/** 附件落盘与图床 IPC。 */

import { ipcMain } from 'electron'
import {
  IPC,
  type ImgHostConfig,
  type ImgHostUploadItem,
  type PublishResult,
  type SaveAssetPayload,
  type SavedAsset,
} from '../../shared/ipc-channels'
import { saveAsset } from '../assets'
import { getImgHost, publishImages, setImgHost, uploadToImgHost } from '../imghost'

export function registerAssetsIpc(): void {
  // ── 导出（HTML / PDF）──

  ipcMain.handle(IPC.ASSET_SAVE, async (_event, payload: SaveAssetPayload): Promise<SavedAsset> =>
    saveAsset(payload.docPath, payload.vaultPath, payload.base64, payload.ext),
  )

  ipcMain.handle(IPC.IMGHOST_GET, () => getImgHost())

  ipcMain.handle(IPC.IMGHOST_SET, (_event, config: ImgHostConfig | null, token: string) =>
    setImgHost(config, token),
  )

  ipcMain.handle(IPC.IMGHOST_UPLOAD, async (_event, items: ImgHostUploadItem[]) =>
    uploadToImgHost(items),
  )

  ipcMain.handle(
    IPC.IMGHOST_PUBLISH,
    async (_event, markdown: string, docPath: string | null): Promise<PublishResult> =>
      publishImages(markdown, docPath),
  )
}
