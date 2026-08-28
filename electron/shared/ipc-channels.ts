export const IPC = {
  APP_VERSION: 'app:version',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST_DIR: 'file:listDir',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_OPEN_DIR: 'dialog:openDir',

  // 自定义标题栏的窗口控制
  WIN_MINIMIZE: 'win:minimize',
  WIN_TOGGLE_MAXIMIZE: 'win:toggleMaximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  WIN_STATE_CHANGE: 'win:stateChange'
} as const

export interface WindowState {
  maximized: boolean
}

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface DocMeta {
  path: string
  title: string
  updatedAt: number
}

export type EditorMode = 'wysiwyg' | 'source'
