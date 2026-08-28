export const IPC = {
  APP_VERSION: 'app:version',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST_DIR: 'file:listDir',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_OPEN_DIR: 'dialog:openDir'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface DocMeta {
  path: string
  title: string
  updatedAt: number
}

export type EditorMode = 'wysiwyg' | 'source'
