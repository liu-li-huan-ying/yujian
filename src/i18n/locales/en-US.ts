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
    /* ── Search (dual scope: all / this doc) ── */
    scopeVault: 'All',
    scopeDoc: 'This doc',
    scopeDocHint: 'Open a document first',
    noResult: 'No results for “{q}”',
    searching: 'Searching…',
    /* ── Version snapshots (Batch 2) ── */
    snapshots: 'Snapshots',
    snapshotSave: 'Save snapshot',
    snapshotNote: 'Note',
    snapshotNotePlaceholder: 'Note (optional, e.g. "before publish")',
    snapshotEmpty: 'No snapshots yet. Save or click "Save snapshot" to keep one.',
    snapshotRestore: 'Restore',
    snapshotDelete: 'Delete',
    snapshotCount: '{n} snapshots',
    snapshotTimezone: 'Local timezone: {tz}',
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
    /* ── Status bar stat units (zh/en consistent) ── */
    unitHan: 'chars',
    unitWord: 'words',
    unitMin: 'min',
    /* ── Sidebar global replace (reuses replace/replacePlaceholder/replaceAll above) ── */
    replaceConfirm: 'This replaces all {n} matches and cannot be undone. Continue?',
    replaceDone: 'Replaced {n} matches in {files} files',
    replaceFail: 'Replace failed',
    /* ── Focus mode (typewriter + zen, Batch 2) ── */
    focus: 'Focus',
    focusTitle: 'Focus mode: center current line + dim the rest',
    /* ── Focus 2.0: retreat bar + settings panel ── */
    zenSettings: 'Focus settings',
    zenSettingsSub: 'Changes apply instantly and persist with the session · no save needed',
    zenExit: 'Exit focus',
    zenSwitchDoc: 'Switch document',
    zenSavedPrefix: 'Saved',
    zenSavedJustNow: 'just now',
    zenSavedMinAgo: '{n} min ago',
    zenSavedHourAgo: '{n} h ago',
    /* ── Link check (batch three §3.7) ── */
    linkCheck: 'Link check',
    linkCheckScanning: 'Scanning vault…',
    linkCheckEmpty: 'No broken links ✓',
    linkCheckSummary: 'Scanned {n} docs, found {m} broken link(s)',
    linkCheckRerun: 'Rescan',
    linkCheckClose: 'Close',
    linkKindWiki: 'Wiki',
    linkKindLink: 'Link',
    linkKindImage: 'Image',
    linkCheckHint: 'Click any broken link to jump to its exact line in the editor',
    linkCheckNoVault: 'Open a vault first',
    linkCheckFilterAll: 'All',
    linkCheckFilterActive: 'Filter',
    linkCheckBreakdown: 'Wiki {w} · Link {l} · Image {i}',
    linkCheckLocate: 'Go to line {n}',
    linkCheckContext: 'Source line',
    zenAnchor: 'Anchor position',
    zenAnchorHint: 'Where the current line is pinned in the viewport',
    zenAnchorThird: 'Upper 1/3',
    zenAnchorGolden: 'Golden ratio',
    zenAnchorCenter: 'Center',
    zenFog: 'Fog falloff',
    zenFogHint: 'Fast drop nearby, converged afar',
    zenFogFast: 'Fast',
    zenFogMid: 'Mid',
    zenFogSlow: 'Slow',
    zenScroll: 'Scroll smoothness',
    zenScrollHint: 'Tension of the paper scroll',
    zenScrollSnappy: 'Snappy',
    zenScrollSmooth: 'Smooth',
    zenScrollSilky: 'Silky',
    zenFullscreen: 'Auto fullscreen on enter',
    zenFullscreenHint: 'Enter fullscreen with focus mode, restore on exit',
    zenRetreatBar: 'Retreat info bar',
    zenRetreatBarHint: 'Press Esc in focus to peek, press again to hide',
    zenDone: 'Done',
    /* ── Writing aids (batch three §3.6) ── */
    writingAids: {
      title: 'Writing Aids',
      tabProps: 'Properties',
      tabSnippets: 'Snippets',
      labelTitle: 'Title',
      labelAuthor: 'Author',
      labelDesc: 'Description',
      labelTags: 'Tags',
      labelDate: 'Date',
      placeTitle: 'Document title',
      placeAuthor: 'Author name',
      placeDesc: 'One-line summary',
      placeTags: 'tag1, tag2',
      tagsHint: 'Comma or space separated',
      apply: 'Apply',
      close: 'Close',
      noDoc: 'Open a document first',
      snipDoc: 'Doc template',
      snipCode: 'Code block',
      snipTable: 'Table',
      snipCallout: 'Callout',
      snipTask: 'Task list',
      snipFoot: 'Footnote',
      snipMermaid: 'Diagram',
      snipMath: 'Math block',
      toastApplied: 'Document properties updated'
    }
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
    scEdit: 'Edit',
    scFind: 'Focus search',
    scView: 'View',
    scSearch: 'Search',
    scSidebar: 'Show / hide sidebar',
    scOutline: 'Show / hide outline',
    scMode: 'Toggle WYSIWYG / Source',
    scFocus: 'Focus',
    scFocusEsc: 'In focus: collapse / reveal retreat bar',
    scGeneral: 'General',
    scHelp: 'Open help',
    guideTitle: 'Get Started with 玉笺',
    guideIntro:
      '玉笺 is a desktop Markdown editor for technical writers: WYSIWYG and source modes, multi-tabs, version snapshots and a zen focus mode, a jade-textured interface, local-first, with faithful Markdown round-tripping.',
    guideSections: [
      {
        h: '1 · Open a vault',
        p: 'Click "Choose Folder" in the sidebar or the folder icon in the title bar to pick a local folder as your vault. Its .md files and sibling .assets show up live in the left file tree.'
      },
      {
        h: '2 · Tabs & write',
        p: 'The "＋" in the title bar creates a document in the vault; open several docs at once from the tree and switch on the tab bar. The body is WYSIWYG by default; switch to precise editing via the "WYSIWYG / Source" segment or Ctrl+/.'
      },
      {
        h: '3 · Search & replace',
        p: 'The sidebar search box unifies retrieval: switch to “All” to full-text search the whole vault (one-click batch replace on hits); switch to “This doc” to find / replace within the current document only. Both scopes share the same search engine and differ only by scope; clicking a hit jumps to it. Both support “Match case / Whole word”. Ctrl+F focuses the search box.'
      },
      {
        h: '4 · Snapshots & stats',
        p: 'The "history" icon snapshots the current document with notes, line-level diff preview and rollback; the status bar counts hanzi / words / reading time live, and the popover shows a goal progress ring.'
      },
      {
        h: '5 · Focus mode',
        p: 'The "moon" icon enters zen writing: side panels recede into fog, other text blocks fade by distance, and the caret line is anchored by a gentle paper-scroll. Esc reveals a slim retreat bar; settings tune anchor / fog / smoothness.'
      },
      {
        h: '6 · Export & share',
        p: 'The title-bar "Export" produces a single HTML or PDF. Export reads the editor DOM directly, true WYSIWYG; assets can ship as a sibling .assets folder or inline base64.'
      },
      {
        h: '7 · Images & img host',
        p: 'Local images live in a same-named .assets folder with relative links. To publish externally, configure an img host under "More · Image Host" and replace links in one click.'
      },
      {
        h: '8 · Appearance & skins',
        p: 'The palette icon cycles five traditional Chinese kiln skins (Celadon / Sky / Moon / Dai / Amber) and dark / light / system — material and hue are decoupled, switching is instant.'
      }
    ],
    aboutBody:
      '玉笺 · Jade Markdown Editor\nVersion 1.1 · Electron + Vue 3 + Milkdown\nLocal-first · Faithful round-trip · No cloud tracking'
  }
}

export type Locale = typeof enUS
export default enUS
