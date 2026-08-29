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
    sidebar: 'Sidebar',
    toggleSidebarTitle: 'Show or hide the sidebar',
    toggleOutlineTitle: 'Show or hide the outline',
    noVaultTitle: 'No vault opened',
    noVaultHint: 'Pick a folder to start writing',
    chooseFolder: 'Choose Folder',
    emptyFolderTitle: 'This folder is empty',
    emptyFolderHint: 'Drop in some Markdown files, or click + on the top right',
    startupTitle: 'On Startup',
    startupRestore: 'Restore last session',
    startupRestoreDesc: 'Reopen the last vault and document',
    startupFresh: 'Show a fresh page',
    startupFreshDesc: 'Start with an empty vault, no last state restored',
    newDoc: 'New Document',
    saveAs: 'Save As',
    about: 'About',
    more: 'More',
    exportTitle: 'Export',
    exportMenuHtml: 'HTML file',
    exportMenuPdf: 'PDF file',
    helpTitle: 'Help & Shortcuts',
    /* ── Multi-tab / Find (Phase 2 Batch 1) ── */
    close: 'Close',
    closeOthers: 'Close Others',
    closeToRight: 'Close to Right',
    find: 'Find',
    findPlaceholder: 'Find…',
    replace: 'Replace',
    replacePlaceholder: 'Replace with…',
    hideReplace: 'Hide Replace',
    caseSensitive: 'Match Case',
    wholeWord: 'Whole Word',
    prev: 'Previous',
    next: 'Next',
    replaceOne: 'Replace',
    replaceAll: 'Replace All',
    noMatch: 'No match',
    selection: 'Sel',
    tabPos: 'Current / total',
    moreTabs: '{n} tabs',
    /* ── Version snapshots (Batch 2) ── */
    snapshots: 'Snapshots',
    snapshotSave: 'Save snapshot',
    snapshotNote: 'Note',
    snapshotNotePlaceholder: 'Note (optional, e.g. "before publish")',
    snapshotEmpty: 'No snapshots yet. Save or click "Save snapshot" to keep one.',
    snapshotRestore: 'Restore',
    snapshotDelete: 'Delete',
    snapshotCount: '{n} snapshots',
    diffAdd: 'Added',
    diffDel: 'Removed',
    /* ── Writing stats (Batch 2) ── */
    stats: 'Stats',
    charCount: 'Han',
    wordCount: 'Words',
    totalChars: 'Chars',
    totalCharsNoSpace: 'Chars (no space)',
    readingTime: 'Read',
    selectionStats: 'Selection',
    writingGoal: 'Writing goal',
    writingGoalPlaceholder: 'Target count',
    goalProgress: 'Progress',
    /* ── Focus mode (typewriter + zen, Batch 2) ── */
    focus: 'Focus',
    focusTitle: 'Focus mode: center current line + dim the rest'
  },

  /* ── Help panel: shortcuts + guide ── */
  help: {
    tabShortcuts: 'Shortcuts',
    tabGuide: 'Guide',
    close: '×',
    aboutTitle: 'About 玉笺',
    scFile: 'File',
    scOpen: 'Open file',
    scSave: 'Save document',
    scView: 'View',
    scSidebar: 'Show / hide sidebar',
    scOutline: 'Show / hide outline',
    scMode: 'Toggle WYSIWYG / Source',
    scGeneral: 'General',
    scHelp: 'Open help',
    guideTitle: 'Get Started with 玉笺',
    guideIntro:
      '玉笺 is a desktop Markdown editor for technical writers: WYSIWYG and source modes, a jade-textured interface, local-first, with faithful Markdown round-tripping.',
    guideSections: [
      {
        h: '1 · Open a vault',
        p: 'Click "Choose Folder" in the sidebar or the folder icon in the title bar to pick a local folder as your vault. Its .md files and sibling .assets show up live in the left file tree.'
      },
      {
        h: '2 · Create & write',
        p: 'The "＋" in the title bar creates a document in the vault. The body is WYSIWYG by default; switch to precise editing via the "WYSIWYG / Source" segment or Ctrl+/.'
      },
      {
        h: '3 · Two synced panels',
        p: 'The left tree manages documents; the right outline highlights the current section on scroll and jumps on click. Both panels toggle independently (Ctrl+\\ / Ctrl+Shift+\\) and auto-collapse on narrow windows.'
      },
      {
        h: '4 · Export & share',
        p: 'The title-bar "Export" produces a single HTML or PDF. Export reads the editor DOM directly, true WYSIWYG; assets can ship as a sibling .assets folder or inline base64.'
      },
      {
        h: '5 · Images & img host',
        p: 'Local images live in a same-named .assets folder with relative links. To publish externally, configure an img host under "More · Image Host" and replace links in one click.'
      },
      {
        h: '6 · Appearance & skins',
        p: 'The palette icon cycles five traditional Chinese kiln skins (Celadon / Sky / Moon / Dai / Amber) and dark / light / system — material and hue are decoupled, switching is instant.'
      }
    ],
    aboutBody:
      '玉笺 · Jade Markdown Editor\nVersion 1.1 · Electron + Vue 3 + Milkdown\nLocal-first · Faithful round-trip · No cloud tracking'
  }
}

export type Locale = typeof enUS
export default enUS
