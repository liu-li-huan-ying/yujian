export const IPC = {
  APP_VERSION: 'app:version',
  /** 外观：渲染层通知主进程同步原生控件（保存框 / 菜单）明暗，使其与 app 主题一致 */
  APP_SET_NATIVE_THEME: 'app:setNativeTheme',
  /** 渲染层请求用系统默认浏览器打开外部链接（Ctrl/⌘+点击编辑器内链接跳转） */
  APP_OPEN_EXTERNAL: 'app:openExternal',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  // 读二进制并按扩展名推断 mime，返回 data URL（导出时内联图片用）
  FILE_READ_BASE64: 'file:readBase64',
  /** 取文件元信息（mtime / 字节数），冲突检测用于展示「磁盘修改时间」 */
  FILE_STAT: 'file:stat',
  FILE_LIST_DIR: 'file:listDir',
  FILE_CREATE: 'file:create',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_OPEN_DIR: 'dialog:openDir',

  // 笔记库：扫描与监听（选目录复用上面的 DIALOG_OPEN_DIR）
  VAULT_LIST: 'vault:list',
  VAULT_WATCH: 'vault:watch',
  VAULT_UNWATCH: 'vault:unwatch',
  VAULT_CHANGE: 'vault:change',

  // 笔记库：文件树变更（新建文件夹 / 重命名 / 删除 / 移动）
  VAULT_CREATE_DIR: 'vault:createDir',
  VAULT_RENAME: 'vault:rename',
  VAULT_DELETE: 'vault:delete',
  VAULT_MOVE: 'vault:move',

  // 笔记库：全文搜索
  VAULT_SEARCH: 'vault:search',
  // 笔记库：全局替换（在搜索命中的文件范围内替换）
  VAULT_REPLACE: 'vault:replace',
  // 笔记库：断链健康检查（扫描 vault 内失效的 [[wikilink]] / 相对路径链接 / 图片）
  VAULT_CHECK_LINKS: 'vault:checkLinks',
  // 笔记库：统一索引层重建（批次零地基；丢失可静默自动重建，此通道供自检/手动重建）
  VAULT_INDEX_REBUILD: 'vault:indexRebuild',
  // 笔记库：完整性自检（批次一：索引/磁盘不一致、孤儿快照、缺失附件、断链）
  VAULT_INTEGRITY_CHECK: 'vault:integrityCheck',
  // 笔记库：一键修复（重建索引 / 删除孤儿快照，破坏性动作需前端二次确认）
  VAULT_INTEGRITY_REPAIR: 'vault:integrityRepair',
  // 笔记库：整库备份（打包为 zip）
  VAULT_BACKUP: 'vault:backup',
  // 笔记库：整库恢复（从 zip 解包）
  VAULT_RESTORE: 'vault:restore',
  // 笔记库：解析 [[wikilink]] 目标为绝对路径（编辑器点击跳转 / 一键创建目标笔记）
  VAULT_RESOLVE_WIKILINK: 'vault:resolveWikilink',
  // 笔记库：反链查询（哪些笔记链接到当前笔记，含引用行上下文）
  VAULT_GET_BACKLINKS: 'vault:getBacklinks',
  // 笔记库：列出全部笔记标题（供 [[ 自动补全浮层消费，纯索引元数据、不读正文）
  VAULT_LIST_NOTES: 'vault:listNotes',
  // 笔记库：未链接提及查询（纯文本提到当前笔记名但未加 [[ ]] 的片段）
  VAULT_UNLINKED_MENTIONS: 'vault:unlinkedMentions',
  // 笔记库：把未链接提及的片段包裹成 [[链接]] 并写回磁盘
  VAULT_WRAP_MENTION: 'vault:wrapMention',
  // 笔记库：标签聚合——列出全部标签（含计数 / 层级，由索引派生不存原始图）
  VAULT_LIST_TAGS: 'vault:listTags',
  // 笔记库：按标签列出旗下笔记（点击标签面板条目时拉取，纯索引元数据、不读正文）
  VAULT_GET_NOTES_BY_TAG: 'vault:getNotesByTag',
  // 笔记库：列出全库内容地图（frontmatter moc: true 的笔记）
  VAULT_LIST_MOCS: 'vault:listMocs',
  // 笔记库：某篇 MOC 的下级聚合（按标签 / 出链 / 反链分组，由索引派生）
  VAULT_GET_MOC_OUTLINE: 'vault:getMocOutline',

  // 会话持久化（崩溃恢复）
  SESSION_GET: 'session:get',
  SESSION_PATCH: 'session:patch',

  // 自定义标题栏的窗口控制
  WIN_MINIMIZE: 'win:minimize',
  WIN_TOGGLE_MAXIMIZE: 'win:toggleMaximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  WIN_STATE_CHANGE: 'win:stateChange',
  // 凝神 2.0：进入时自动全屏（开/关）
  WIN_SET_FULLSCREEN: 'win:setFullscreen',

  // 导出：EXPORT_FILE 写任意文本产物（HTML / LaTeX 等，filters 决定保存对话框类型），
  // EXPORT_PDF 走隐藏窗口打印管线。两者共用 ExportPayload，避免逐格式加通道的冗余。
  EXPORT_FILE: 'export:file',
  EXPORT_PDF: 'export:pdf',

  // 图片：粘贴/拖入落盘到文档同级 .assets
  ASSET_SAVE: 'asset:save',

  // 图床：配置读写（密钥只在主进程，safeStorage 加密）
  IMGHOST_GET: 'imghost:get',
  IMGHOST_SET: 'imghost:set',
  // 图床：上传文档内本地图片，返回远程 URL（密钥不离开主进程）
  IMGHOST_UPLOAD: 'imghost:upload',
  // 图床：上传文档内全部本地图片并把 Markdown 引用改写为远程 URL
  IMGHOST_PUBLISH: 'imghost:publish',

  // 版本快照（Phase 2 批次二）：写盘 / 列目录 / 读内容 / 删除（走回收站）
  // Phase A（git 化）：新增标签读写通道
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_CREATE: 'snapshot:create',
  SNAPSHOT_RESTORE: 'snapshot:restore',
  SNAPSHOT_DELETE: 'snapshot:delete',
  SNAPSHOT_SET_TAGS: 'snapshot:setTags',
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

/** 反链面板单条：某篇笔记链接到当前笔记的引用信息 */
export interface BacklinkItem {
  /** 来源文件绝对路径 */
  path: string
  /** 引用所在行号（从 1 开始） */
  line: number
  /** 引用所在行的上下文片段（已截断） */
  snippet: string
}

/** `[[` 自动补全候选：仅在弹出浮层时按需拉取，只含轻量元数据 */
export interface NoteTitleItem {
  /** 绝对路径 */
  path: string
  /** 显示名：frontmatter title > 文件名（不含扩展名） */
  title: string
  /** 文件名（不含扩展名），用于 `[[` 里最常见的按名匹配 */
  base: string
}

/** 标签聚合单条：完整标签名（含 / 嵌套）、命中文件数、父级完整名、层级深度 */
export interface TagItem {
  /** 完整标签名，如 `项目/进行中`（小写、去尾部 /） */
  name: string
  /** 出现在多少篇笔记中 */
  count: number
  /** 直接父级完整名；顶层标签为 null */
  parent: string | null
  /** 层级深度（顶层为 0，`父/子` 为 1） */
  depth: number
}

/** 某标签下的笔记单条（点击标签面板条目时展示，复用反链条目观感） */
export interface TagNoteItem {
  /** 笔记绝对路径 */
  path: string
  /** 显示名：frontmatter title > 文件名（不含扩展名） */
  title: string
  /** 文件名（不含扩展名） */
  base: string
}

/** MOC（内容地图）单条：全库 `moc: true` 的笔记，供面板列出主题入口 */
export interface MocItem {
  /** 笔记绝对路径 */
  path: string
  /** 显示名：frontmatter title > 文件名（不含扩展名） */
  title: string
  /** 文件名（不含扩展名） */
  base: string
  /** 该 MOC 自身携带的标签（面板上显示它聚合的是哪些主题） */
  tags: string[]
}

/** MOC 下级聚合的分组来源：按标签 / 出链 / 反链 */
export type MocGroupKind = 'tag' | 'outlinks' | 'backlinks'

/** MOC 下级聚合的一组 */
export interface MocGroup {
  kind: MocGroupKind
  /** kind='tag' 时为标签完整名；其余为空串（渲染层用 i18n 文案） */
  tag: string
  /** 该组下的笔记（已排除 MOC 自身，组内按标题排序） */
  notes: TagNoteItem[]
  /** 是否因触及软上限而截断（大库保护，与 searchVault 同源约定） */
  truncated: boolean
}

/** 未链接提及单条：某篇笔记以纯文本提到当前笔记名，但未加 `[[ ]]` */
export interface UnlinkedMention {
  /** 来源文件绝对路径 */
  path: string
  /** 命中所在行号（从 1 开始） */
  line: number
  /** 命中所在行的上下文片段（已截断） */
  snippet: string
  /** 命中片段在**该行内**的起始字符下标（用于精确包裹，避免同串重复替换） */
  start: number
  /** 命中片段在**该行内**的结束字符下标（不含） */
  end: number
  /** 被提及的笔记名（写回时即以此为链接目标） */
  name: string
}

export type EditorMode = 'wysiwyg' | 'source'

/** 启动偏好：恢复上次会话（默认）/ 每次启动显示全新页面 */
export type StartupMode = 'restore' | 'fresh'

/* ── 笔记库文件树 ───────────────────────────── */

export interface FileNode {
  /** 文件名（含扩展名）或目录名 */
  name: string
  /** 绝对路径 */
  path: string
  type: 'file' | 'dir'
  /** 仅目录有，已按「目录在前、名称升序」排好 */
  children?: FileNode[]
}

export type VaultChangeKind = 'add' | 'unlink' | 'addDir' | 'unlinkDir' | 'change'

export interface VaultChange {
  kind: VaultChangeKind
  /** 绝对路径 */
  path: string
}

/* ── 全文搜索结果 ─────────────────────────── */

export interface SearchLineHit {
  /** 行号（从 1 开始） */
  line: number
  /** 命中行文本（已截断，去除首尾空白） */
  text: string
}

/** 搜索 / 替换的匹配选项（左侧搜索框「区分大小写 / 全词匹配」贯穿 vault 与本文档两种范围） */
export interface SearchOptions {
  /** 区分大小写（默认 false，即不区分） */
  caseSensitive?: boolean
  /** 全词匹配（默认 false） */
  wholeWord?: boolean
  /** 正则模式：query 直接作为正则表达式（默认 false，即字面量匹配） */
  regex?: boolean
}

export interface SearchFileResult {
  /** 文档绝对路径 */
  path: string
  /** 文件名（含扩展名） */
  name: string
  hits: SearchLineHit[]
}

/**
 * 搜索整体结果。解除原 80 文件硬上限后改用软上限保护渲染进程：
 * 结果过多时 `truncated=true`，前端据此提示「结果过多，请收窄查询」。
 */
export interface SearchResult {
  /** 命中文件列表（按命中行组织） */
  results: SearchFileResult[]
  /** true 表示结果超过内部软上限被截断 */
  truncated: boolean
}

/** 全局替换结果：在搜索命中的文件范围内替换 */
export interface ReplaceResult {
  /** 替换发生的匹配总数 */
  replaced: number
  /** 被修改的文件数 */
  files: number
  /** 被改写的文件路径列表（供前端判断是否需要重载当前文档） */
  paths: string[]
}

/**
 * 凝神 2.0 偏好（docs/FOCUS-MODE-2.0-DESIGN.md §7）。
 * 光标闪烁频率被有意否决：原生 caret 不可定制，替换为当前块青瓷微光底衬（纯 CSS）。
 */
export interface ZenPrefs {
  /** 锚点：光标行中心钉在视口高度的比例（0.333 偏上1/3 / 0.382 黄金分割 / 0.5 正中） */
  anchor: number
  /** 雾化衰减档：快 / 中 / 慢 */
  fog: 'fast' | 'mid' | 'slow'
  /** 滚动平滑度：lerp 系数（0.16 跟手 / 0.10 平滑 / 0.06 极平滑） */
  scroll: number
  /** 进入凝神时自动全屏（默认关） */
  fullscreen: boolean
  /** 轻退信息栏（Esc 掀帘看一眼）开关（默认开） */
  retreatBar: boolean
  /** 凝神中放大当前段落（字号微放大 + 轻微缩放），营造视觉焦点（默认开） */
  blockZoom?: boolean
}

/** 凝神偏好默认值：与渲染侧 src/editor/zen.ts 的 DEFAULT_PREFS 保持一致 */
export const DEFAULT_ZEN_PREFS: ZenPrefs = {
  anchor: 1 / 3,
  fog: 'mid',
  scroll: 0.16,
  fullscreen: false,
  retreatBar: true,
}

/* ── 会话状态（崩溃恢复）────────────────────── */

export interface SessionState {
  /** 当前笔记库根目录，未打开则为 null */
  vaultPath: string | null
  /** 当前编辑的文档绝对路径 */
  activePath: string | null
  /** 多标签：当前打开的文档绝对路径列表（按打开顺序）。为空表示仅 activePath 一个文档 */
  openTabs?: string[]
  mode: EditorMode
  /** 侧边栏宽度（px） */
  sidebarWidth: number
  /** 启动偏好：恢复上次会话 / 每次启动显示全新页面 */
  startupMode: StartupMode
  /** 左侧笔记库面板是否可见（默认显示） */
  sidebarVisible: boolean
  /** 右侧大纲面板是否可见（默认显示） */
  outlineVisible: boolean
  /** 凝神模式（打字机居中 + 沉浸淡化）是否开启 */
  focusMode?: boolean
  /** 写作目标字数（0 表示未设目标），持久化于会话，跨文档共享 */
  writingGoal?: number
  /** 凝神 2.0 偏好：锚点 / 雾化 / 平滑度 / 自动全屏 / 轻退栏 */
  zenPrefs?: ZenPrefs
}

export const DEFAULT_SESSION: SessionState = {
  vaultPath: null,
  activePath: null,
  openTabs: [],
  mode: 'wysiwyg',
  sidebarWidth: 224,
  startupMode: 'restore',
  sidebarVisible: true,
  outlineVisible: true,
  focusMode: false,
  writingGoal: 0,
  zenPrefs: { ...DEFAULT_ZEN_PREFS },
}

/* ── 导出（HTML / PDF）────────────────────────── */

/** 渲染进程组装好的完整文档 + 建议文件名 */
export interface ExportPayload {
  /** 产物全文：HTML 为完整文档字符串（含 <!DOCTYPE> 与内联样式），LaTeX 为 .tex 全文。
   *  二进制格式（docx/epub/rtf/odt）此处放「预览用」的 HTML 文本，实际字节在 binaryBase64 */
  content: string
  /** 保存对话框的默认文件名（含扩展名） */
  defaultName: string
  /** 保存对话框的文件类型过滤（如 HTML / LaTeX）；不传则由主进程按扩展名兜底 */
  filters?: { name: string; extensions: string[] }[]
  /** 二进制格式的产物字节（base64）。存在时主进程写字节而非 content 文本 */
  binaryBase64?: string
  /** 二进制产物的 MIME（如 application/vnd.openxmlformats-officedocument.wordprocessingml.document） */
  mime?: string
}

/** 读取二进制为 data URL 的结果（导出内联图片用） */
export interface ReadBase64Result {
  ok: boolean
  /** 形如 data:image/png;base64,...；失败时为空 */
  dataUrl?: string
  error?: string
}

/** 文件元信息（冲突检测展示磁盘修改时间 / 大小用） */
export interface FileStat {
  /** 文件是否存在 */
  exists: boolean
  /** 修改时间（epoch ms），不存在时为 0 */
  mtimeMs: number
  /** 字节大小，不存在时为 0 */
  size: number
}

export interface ExportResult {
  ok: boolean
  /** 用户取消保存对话框 */
  canceled?: boolean
  /** 成功时的最终保存路径 */
  path?: string
  /** 失败时的错误信息 */
  error?: string
}

/* ── 图片落盘 ─────────────────────────────── */

export interface SaveAssetPayload {
  /** 当前文档路径（无则为 null，落到库根或临时目录） */
  docPath: string | null
  /** 当前笔记库根（无文档时用于决定落盘位置） */
  vaultPath: string | null
  /** 图片字节的 base64 */
  base64: string
  /** 扩展名（png/jpg/...，不含点） */
  ext: string
}

export interface SavedAsset {
  /** 磁盘绝对路径 */
  absPath: string
  /** 相对文档目录的路径（如 `笔记.assets/foo.png`） */
  relPath: string
}

/* ── 图床 ─────────────────────────────────── */

/** 图床配置（密钥不出现在此结构，由主进程单独加密存储） */
export interface ImgHostConfig {
  /** 提供方标识，如 smms */
  provider: string
  /** 展示用名称 */
  name: string
  /** 上传端点（SM.MS: https://sm.ms/api/v2/upload） */
  endpoint: string
  /** 自定义请求头（如 Authorization），值留空，真正密钥在主进程解密注入 */
  tokenHeader: string
}

export interface ImgHostUploadItem {
  /** 本地磁盘绝对路径 */
  path: string
  /** 用于回带对应关系的本地引用（相对或 file:// 绝对） */
  ref: string
}

export interface ImgHostUploadResult {
  ok: boolean
  /** 每个本地引用的上传结果 */
  items: Array<{ ref: string; url?: string; error?: string }>
}

/* ── 图床发布（上传 + 改写）────────────────────── */

/** 上传文档内本地图片并把引用改写为远程 URL 的结果 */
export interface PublishResult {
  ok: boolean
  /** 文档中没有可上传的本地图片 */
  noImages?: boolean
  /** 改写后的完整 Markdown（成功且有图片时返回） */
  markdown?: string
  /** 成功上传的张数 */
  uploaded: number
  /** 失败的张数 */
  failed: number
  /** 失败时的错误信息 */
  error?: string
}

/* ── 版本快照（Phase 2 批次二）────────────────────── */

export interface SnapshotInfo {
  /** 快照唯一标识（文件名去扩展名，含 ISO 时间戳，可排序） */
  id: string
  /** 创建时间（epoch ms） */
  createdAt: number
  /** 可选备注（如「发布前」） */
  note?: string
  /** 命名标签（git tag 思想）：如「终稿」「投稿版」「v1.0」；可多贴 */
  tags?: string[]
  /** 内容哈希（sha1），用于内容寻址去重与血缘展示 */
  contentHash?: string
  /** 所在分支（git 轻量分支思想）：主线为 'main'，草稿为用户命名分支 */
  branch?: string
  /** 父快照 id（血缘链，**同分支内**线性）：基于该分支上一份快照；分支首份为 null */
  parent?: string | null
  /** 快照字符数（用于与当前文档比较显示字数差） */
  charCount: number
  /** 磁盘字节数 */
  size: number
}

/* ── 链接健康检查（Phase 2 批次三 §3.7）─────────────────── */

export type BrokenLinkKind = 'wikilink' | 'mdlink' | 'image'

export interface BrokenLinkItem {
  /** 源 Markdown 文档绝对路径 */
  file: string
  /** 断链所在行号（从 1 开始） */
  line: number
  /** 原始链接文本（含 [[ ]] 或 ( ) 的完整原文，便于定位） */
  raw: string
  /** 归一化后的目标（wikilink 基名 / 解析后的相对路径 / 图片路径） */
  target: string
  /** 断链类型：Wiki 链接 / Markdown 链接 / 图片 */
  kind: BrokenLinkKind
  /** 断链所在行的原文（不含换行，便于在面板内预览「到底是哪一行出了问题」） */
  context: string
}

export interface BrokenLinkReport {
  /** 扫描的 Markdown 文档总数 */
  scanned: number
  /** 断链总数 */
  total: number
  items: BrokenLinkItem[]
}

/** 侧边栏可调宽度范围，与 --w-sidebar 默认值呼应 */
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 360

/* ── 完整性自检 / 修复（Phase 3 批次一）────────────────── */

export type IntegritySeverity = 'error' | 'warning' | 'info'
export type IntegrityCategory =
  | 'index' // 索引与磁盘不一致 / 空索引（可重建修复）
  | 'orphan-snapshot' // 源文档已删但快照残留（可删修复）
  | 'missing-attachment' // 图片等附件引用缺失（报告，不自动改）
  | 'broken-link' // [[wikilink]] / 相对链接断链（报告，不自动改）

export interface IntegrityIssue {
  severity: IntegritySeverity
  category: IntegrityCategory
  /** 关联文件路径（可空；孤儿快照指向快照目录，断链/缺失附件指向源文档） */
  file?: string
  /** 次级说明：断链目标 / 所在行文本等，供面板直接展示 */
  detail?: string
}

export interface IntegrityReport {
  issues: IntegrityIssue[]
  counts: Record<IntegrityCategory, number>
  total: number
  /** 至少含一项可修复条目（索引 / 孤儿快照）时为 true，决定「一键修复」按钮可用性 */
  repairable: boolean
}

/** 可执行的修复动作标识（前端「一键修复」二次确认后传入） */
export type IntegrityAction = 'rebuildIndex' | 'removeOrphanSnapshots'

export interface RepairResult {
  actions: { action: string; fixed: number }[]
  errors: string[]
}

/* ── 整库备份 / 恢复（Phase 3 批次一）────────────────── */

export interface BackupResult {
  files: number
  bytes: number
}

export interface RestoreResult {
  files: number
  bytes: number
  /** 因路径逃逸 / 写入失败被跳过的条目 */
  skipped: string[]
}
