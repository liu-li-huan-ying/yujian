/**
 * English locale
 * Covers: Crepe BlockEdit / Placeholder / ImageBlock labels + app UI strings
 */
const enUS = {
  /* ── Crepe BlockEdit toolbar ── */
  blockEdit: {
    textGroup: {
      label: 'Text',
      text: { label: 'Text' },
      h1: { label: 'Heading 1' },
      h2: { label: 'Heading 2' },
      h3: { label: 'Heading 3' },
      h4: { label: 'Heading 4' },
      h5: { label: 'Heading 5' },
      h6: { label: 'Heading 6' },
      quote: { label: 'Quote' },
      divider: { label: 'Divider' }
    },
    listGroup: {
      label: 'List',
      bulletList: { label: 'Bullet List' },
      orderedList: { label: 'Ordered List' },
      taskList: { label: 'Task List' }
    },
    advancedGroup: {
      label: 'Advanced',
      image: { label: 'Image' },
      codeBlock: { label: 'Code Block' },
      table: { label: 'Table' },
      math: { label: 'Math' }
    }
  },

  /* ── Crepe Placeholder ── */
  placeholder: {
    text: 'Please enter…'
  },

  /* ── Crepe ImageBlock ── */
  imageBlock: {
    blockUploadButton: 'Upload file',
    blockConfirmButton: 'Confirm',
    blockCaptionPlaceholderText: 'Write image caption',
    blockUploadPlaceholderText: 'or paste the image link…',
    inlineUploadButton: 'Upload',
    inlineUploadPlaceholderText: 'or paste link…'
  },

  /* ── Crepe CodeMirror (source mode) ── */
  codeMirror: {
    previewLabel: 'Preview',
    previewLoading: 'Rendering…',
    searchPlaceholder: 'Search language',
    noResultText: 'No match',
    copyText: 'Copy'
  },

  /* ── App UI ── */
  ui: {
    open: 'Open',
    save: 'Save',
    exportHtml: 'HTML',
    exportPdf: 'PDF',
    imgHost: 'Img Host',
    modeWysiwyg: 'WYSIWYG',
    modeSource: 'Source',
    statusSaved: 'Saved',
    statusUnsaved: 'Unsaved',
    statusNoFile: 'No file',
    willNormalize: 'Will normalize on save',
    toastExportHtmlOk: 'Exported: ',
    toastExportPdfOk: 'Exported: ',
    toastExportCanceled: 'Export canceled',
    toastExportErr: 'Export failed: ',
    toastNoDoc: 'Please open a document first',
    toastNoContent: 'Document has no content',
    toastImgHostPublishOk: ' images uploaded to host',
    toastImgHostPublishFail: 'Upload failed: ',
    toastImgHostNoImages: 'No local images in document',
    imgHostSettingsTitle: 'Image Hosting Settings',
    imgHostClose: '×',
    imgHostService: 'Hosting Service',
    imgHostSmms: 'SM.MS',
    imgHostCustom: 'Custom (PicGo compatible)',
    imgHostName: 'Display Name',
    imgHostEndpoint: 'Endpoint',
    imgHostTokenHeader: 'Token Header',
    imgHostToken: 'Token',
    imgHostTokenHint: 'Leave empty to keep existing token',
    imgHostTokenSecure:
      'Token is encrypted via safeStorage in main process only, never sent to renderer.',
    imgHostSaveConfig: 'Save Config',
    imgHostTestChannel: 'Test Channel',
    imgHostUploadDoc: 'Upload Doc Images',
    imgHostChannelOk: 'Channel OK',
    imgHostChannelErr: 'Channel error: ',
    imgHostConfigSaved: 'Config saved (token encrypted)',
    imgHostFillEndpoint: 'Enter upload endpoint',
    imgHostTesting: 'Testing…',
    imgHostNeedDoc: 'Save document before uploading',
    imgHostRewriteMissing: 'Missing rewrite result',
    appearance: 'Appearance',
    skin: 'Skin',
    theme: 'Theme',
    modeDark: 'Dark',
    modeLight: 'Light',
    modeSystem: 'System',
    skinCeladon: 'Celadon',
    skinSky: 'Sky',
    skinMoon: 'Moon',
    skinDai: 'Dai',
    skinAmber: 'Amber',
    appearanceClose: '×',
    switchVault: 'Switch Folder',
    preferences: 'Preferences',
    prefsClose: '×',
    outline: 'Outline',
    outlineEmpty: 'No headings',
    noVaultTitle: 'No vault opened',
    noVaultHint: 'Pick a folder to start writing',
    chooseFolder: 'Choose Folder',
    emptyFolderTitle: 'This folder is empty',
    emptyFolderHint: 'Drop in some Markdown files, or click + on the top right',
    startupTitle: 'On Startup',
    startupRestore: 'Restore last session',
    startupRestoreDesc: 'Reopen the last vault and document',
    startupFresh: 'Show a fresh page',
    startupFreshDesc: 'Start with an empty vault, no last state restored'
  }
}

export type Locale = typeof enUS
export default enUS
