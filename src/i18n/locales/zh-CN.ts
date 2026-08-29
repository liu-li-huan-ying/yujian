/**
 * 中文（简体）语言包
 * 覆盖：Crepe BlockEdit / Placeholder / ImageBlock 标签 + 应用 UI 文案
 */
const zhCN = {
  /* ── Crepe BlockEdit 工具栏 ── */
  blockEdit: {
    textGroup: {
      label: '文本',
      text: { label: '正文' },
      h1: { label: '标题 1' },
      h2: { label: '标题 2' },
      h3: { label: '标题 3' },
      h4: { label: '标题 4' },
      h5: { label: '标题 5' },
      h6: { label: '标题 6' },
      quote: { label: '引用' },
      divider: { label: '分隔线' }
    },
    listGroup: {
      label: '列表',
      bulletList: { label: '无序列表' },
      orderedList: { label: '有序列表' },
      taskList: { label: '任务列表' }
    },
    advancedGroup: {
      label: '高级',
      image: { label: '图片' },
      codeBlock: { label: '代码块' },
      table: { label: '表格' },
      math: { label: '公式' }
    }
  },

  /* ── Crepe Placeholder ── */
  placeholder: {
    text: '请输入内容…'
  },

  /* ── Crepe ImageBlock ── */
  imageBlock: {
    blockUploadButton: '上传文件',
    blockConfirmButton: '确认',
    blockCaptionPlaceholderText: '输入图片说明',
    blockUploadPlaceholderText: '或粘贴图片链接…',
    inlineUploadButton: '上传',
    inlineUploadPlaceholderText: '或粘贴链接…'
  },

  /* ── Crepe CodeMirror（源码模式）── */
  codeMirror: {
    previewLabel: '预览',
    previewLoading: '渲染中…',
    searchPlaceholder: '搜索语言',
    noResultText: '无匹配语言',
    copyText: '复制'
  },

  /* ── 应用 UI ── */
  ui: {
    open: '打开',
    save: '保存',
    exportHtml: 'HTML',
    exportPdf: 'PDF',
    imgHost: '图床',
    modeWysiwyg: '渲染模式',
    modeSource: '源码',
    statusSaved: '已保存',
    statusUnsaved: '未保存',
    statusNoFile: '未选择文件',
    willNormalize: '保存时将规范化排版',
    toastExportHtmlOk: '已导出：',
    toastExportPdfOk: '已导出：',
    toastExportCanceled: '已取消导出',
    toastExportErr: '导出失败：',
    toastNoDoc: '请先打开一个文档',
    toastNoContent: '当前文档暂无内容',
    toastImgHostPublishOk: '已上传 张图片到图床',
    toastImgHostPublishFail: '上传失败：',
    toastImgHostNoImages: '文档中没有本地图片',
    imgHostSettingsTitle: '图床设置',
    imgHostClose: '×',
    imgHostService: '图床服务',
    imgHostSmms: 'SM.MS',
    imgHostCustom: '自定义（兼容 PicGo）',
    imgHostName: '展示名称',
    imgHostEndpoint: '上传端点',
    imgHostTokenHeader: '密钥请求头',
    imgHostToken: '密钥 / Token',
    imgHostTokenHint: '留空 = 沿用已保存密钥',
    imgHostTokenSecure: '密钥仅在主进程经 safeStorage 加密保存，不会下发到渲染层。',
    imgHostSaveConfig: '保存配置',
    imgHostTestChannel: '检测通道',
    imgHostUploadDoc: '上传当前文档图片',
    imgHostChannelOk: '图床通道可用',
    imgHostChannelErr: '通道异常：',
    imgHostConfigSaved: '图床配置已保存（密钥已加密）',
    imgHostFillEndpoint: '请填写上传端点',
    imgHostTesting: '检测中…',
    imgHostNeedDoc: '请先保存文档后再上传图片',
    imgHostRewriteMissing: '改写结果缺失',
    appearance: '外观',
    skin: '皮肤',
    theme: '主题',
    modeDark: '深色',
    modeLight: '浅色',
    modeSystem: '跟随系统',
    skinCeladon: '青瓷',
    skinSky: '天青',
    skinMoon: '月白',
    skinDai: '黛',
    skinAmber: '琥珀',
    appearanceClose: '×',
    switchVault: '切换工作文件夹',
    preferences: '偏好设置',
    prefsClose: '×',
    outline: '大纲',
    outlineEmpty: '暂无标题',
    sidebar: '侧栏',
    toggleSidebarTitle: '显示或隐藏侧栏',
    toggleOutlineTitle: '显示或隐藏大纲',
    noVaultTitle: '还没有笔记库',
    noVaultHint: '选择一个文件夹，即可开始写作',
    chooseFolder: '选择文件夹',
    emptyFolderTitle: '这个文件夹是空的',
    emptyFolderHint: '把 Markdown 文档放进来，或点击右上角 + 新建',
    startupTitle: '启动时',
    startupRestore: '恢复上次会话',
    startupRestoreDesc: '重新打开上次使用的笔记库与文档',
    startupFresh: '每次启动显示全新页面',
    startupFreshDesc: '不恢复上次状态，打开后从空笔记库开始',
    newDoc: '新建文档',
    saveAs: '另存为',
    about: '关于',
    more: '更多',
    exportTitle: '导出文档',
    exportMenuHtml: 'HTML 文件',
    exportMenuPdf: 'PDF 文件',
    helpTitle: '帮助与快捷键',
    /* ── 多标签 / 查找（批次一）── */
    close: '关闭',
    closeOthers: '关闭其他',
    closeToRight: '关闭右侧',
    find: '查找',
    findPlaceholder: '查找…',
    replace: '替换',
    replacePlaceholder: '替换为…',
    hideReplace: '隐藏替换',
    caseSensitive: '区分大小写',
    wholeWord: '全词匹配',
    prev: '上一个',
    next: '下一个',
    replaceOne: '替换',
    replaceAll: '全部替换',
    noMatch: '无匹配',
    selection: '选区',
    tabPos: '当前 / 总数',
    moreTabs: '{n} 个标签',
    /* ── 版本快照（批次二）── */
    snapshots: '快照',
    snapshotSave: '保存快照',
    snapshotNote: '备注',
    snapshotNotePlaceholder: '备注（可选，如「发布前」）',
    snapshotEmpty: '暂无快照，保存或点击「保存快照」留档',
    snapshotRestore: '恢复',
    snapshotDelete: '删除',
    snapshotCount: '{n} 份',
    diffAdd: '新增',
    diffDel: '删除',
    /* ── 写作统计（批次二）── */
    stats: '统计',
    charCount: '汉字',
    wordCount: '词',
    totalChars: '字符',
    totalCharsNoSpace: '字符(不含空白)',
    readingTime: '阅读',
    selectionStats: '选区',
    writingGoal: '写作目标',
    writingGoalPlaceholder: '目标字数',
    goalProgress: '进度',
    /* ── 状态栏统计单位（中英一致）── */
    unitHan: '字',
    unitWord: '词',
    unitMin: '′',
    /* ── 左侧搜索全局替换（批次三）：复用上方 replace / replacePlaceholder / replaceAll ── */
    replaceConfirm: '将替换全部 {n} 处匹配（不可撤销），继续？',
    replaceDone: '已替换 {n} 处 / {files} 个文件',
    replaceFail: '替换失败',
    /* ── 凝神模式（打字机 + 禅 融合，批次二）── */
    focus: '凝神',
    focusTitle: '凝神模式：当前行居中 + 沉浸淡化',
    /* ── 凝神 2.0：轻退栏 + 设置面板 ── */
    zenSettings: '凝神设置',
    zenSettingsSub: '改动即时生效并随会话持久化 · 无需保存',
    zenExit: '退出凝神',
    zenSwitchDoc: '切换文档',
    zenSavedPrefix: '已保存',
    zenSavedJustNow: '刚刚',
    zenSavedMinAgo: '{n} 分钟前',
    zenSavedHourAgo: '{n} 小时前',
    zenAnchor: '锚点位置',
    zenAnchorHint: '当前行钉在视口的位置',
    zenAnchorThird: '偏上 1/3',
    zenAnchorGolden: '黄金分割',
    zenAnchorCenter: '正中',
    zenFog: '雾化衰减',
    zenFogHint: '前两跳掉得快，远处趋同',
    zenFogFast: '快',
    zenFogMid: '中',
    zenFogSlow: '慢',
    zenScroll: '滚动平滑度',
    zenScrollHint: '纸卷的松紧',
    zenScrollSnappy: '跟手',
    zenScrollSmooth: '平滑',
    zenScrollSilky: '极平滑',
    zenFullscreen: '进入时自动全屏',
    zenFullscreenHint: '进入凝神时窗口转全屏，退出时还原',
    zenRetreatBar: '轻退信息栏',
    zenRetreatBarHint: '凝神中按 Esc 掀帘看一眼，再按收起',
    zenDone: '完成'
  },

  /* ── 帮助面板：快捷键 + 使用指南 ── */
  help: {
    tabShortcuts: '快捷键',
    tabGuide: '使用指南',
    close: '×',
    aboutTitle: '关于 玉笺',
    scFile: '文件',
    scOpen: '打开文件',
    scSave: '保存文档',
    scView: '视图',
    scSidebar: '显示 / 隐藏 侧栏',
    scOutline: '显示 / 隐藏 大纲',
    scMode: '切换 渲染 / 源码',
    scGeneral: '通用',
    scHelp: '打开帮助',
    guideTitle: '快速上手 玉笺',
    guideIntro:
      '玉笺是一款为技术写作者打造的桌面 Markdown 编辑器：所见即所得与源码双模式、玉质美学界面、本地优先、Markdown 往返保真。',
    guideSections: [
      {
        h: '1 · 打开笔记库',
        p: '点击侧栏「选择文件夹」或标题栏文件夹图标，选定一个本地文件夹作为笔记库。库内的 .md 文档与同级 .assets 资源会实时显示在左侧文件树。'
      },
      {
        h: '2 · 新建与写作',
        p: '标题栏「＋」即可在库中新建文档。正文默认所见即所得；需要精确排版或插入原始语法时，用「渲染 / 源码」分段或 Ctrl+/ 切换。'
      },
      {
        h: '3 · 双栏联动',
        p: '左侧文件树管理文档，右侧大纲随滚动高亮当前章节、点击跳转。两栏均可独立显隐（Ctrl+\\ / Ctrl+Shift+\\），窗口过窄时自动软收起。'
      },
      {
        h: '4 · 导出与分享',
        p: '标题栏「导出」可生成单篇 HTML 或 PDF。导出直取编辑区 DOM，所见即所得；资源可选随附 .assets 或内联 base64。'
      },
      {
        h: '5 · 图片与图床',
        p: '本地图片默认存于文档同名 .assets 文件夹，链接保持相对路径。发布到外部平台时，在「更多 · 图床设置」配置图床并一键替换为远程链接。'
      },
      {
        h: '6 · 外观与皮肤',
        p: '标题栏调色板图标可在五套中国传统窑色皮肤（青瓷 / 天青 / 月白 / 黛 / 琥珀）与深 / 浅 / 跟随系统之间自由切换，材质与皮肤解耦，切换零卡顿。'
      }
    ],
    aboutBody:
      '玉笺 · 玉质 Markdown 编辑器\n版本 1.1 · Electron + Vue 3 + Milkdown\n本地优先 · 往返保真 · 无云端追踪'
  }
}

export type Locale = typeof zhCN
export default zhCN
