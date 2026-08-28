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
    startupFreshDesc: '不恢复上次状态，打开后从空笔记库开始'
  }
}

export type Locale = typeof zhCN
export default zhCN
