<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import EditorHost from './editor/EditorHost.vue'
import ImgHostSettings from './components/ImgHostSettings.vue'
import AppearanceSettings from './components/AppearanceSettings.vue'
import PreferencesSettings from './components/PreferencesSettings.vue'
import Outline from './components/Outline.vue'
import HelpPanel from './components/HelpPanel.vue'
import TabBar from './components/TabBar.vue'
import SnapshotPanel from './components/SnapshotPanel.vue'
import LinkCheckPanel from './components/LinkCheckPanel.vue'
import WritingAidsPanel from './components/WritingAidsPanel.vue'
import StatsPopover from './components/StatsPopover.vue'
import ZenRetreatBar from './components/ZenRetreatBar.vue'
import ZenSettings from './components/ZenSettings.vue'
import { setZenPrefs } from './editor/zen'
import { initAppearance } from './appearance'
import type { EditorMode } from './editor/EditorHost.vue'
import type { FileNode, VaultChange, StartupMode, ZenPrefs, BrokenLinkItem } from '../electron/shared/ipc-channels'
import { buildExportHtml } from './export/docTemplate'
import { useI18n, setLocale } from './i18n'
import type { LocaleKey } from './i18n'
import { useTabsStore } from './store/tabs'
import { useSnapshotsStore } from './store/snapshots'
import type { TextStats } from './utils/text-stats'

const { t: L, getLocale } = useI18n()
const U = L.ui

const tabs = useTabsStore()
/** 当前编辑文档 = 激活标签路径；多标签下由 tabs store 驱动（单实例换内容，守 Milkdown 红线） */
const filePath = computed(() => tabs.activePath)
const requestedMode = ref<EditorMode>('wysiwyg')
const host = ref<InstanceType<typeof EditorHost> | null>(null)
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null)
const lastSavedAt = ref<number | null>(null)

/* ── 笔记库 ── */

const vaultPath = ref<string | null>(null)
const tree = ref<FileNode[]>([])
const sidebarWidth = ref(224)

/** Crepe 初始化是异步的，就绪前要打开的文档先存在这里 */
const pendingPath = ref<string | null>(null)

const fileName = computed(() =>
  filePath.value ? filePath.value.split(/[\\/]/).pop() ?? '' : '未命名'
)

const modeLabel = computed(() =>
  requestedMode.value === 'wysiwyg' ? U.modeWysiwyg : U.modeSource
)

async function refreshTree(): Promise<void> {
  tree.value = vaultPath.value ? await window.api.listVault(vaultPath.value) : []
}

async function useVault(root: string): Promise<void> {
  vaultPath.value = root
  await refreshTree()
  await window.api.watchVault(root)
  void window.api.patchSession({ vaultPath: root })
}

async function openVault(): Promise<void> {
  const picked = await window.api.openDirDialog()
  if (!picked) return
  // 切换前保存当前文档的未保存改动，绝不丢失
  if (host.value?.dirty) await host.value.save()
  // 清空全部标签与编辑器状态：切到新库即回到空白，避免残留上一个库的文档
  tabs.restore([], null)
  pendingPath.value = null
  host.value?.clear()
  await useVault(picked)
}

/** 把当前激活标签对应的文档载入单实例编辑器；未就绪则缓存在 pendingPath */
async function syncEditorToActive(): Promise<void> {
  const path = tabs.activePath
  if (!path) {
    host.value?.clear()
    return
  }
  if (host.value?.ready) await host.value.load(path)
  else pendingPath.value = path
}

/** 打开指定文档为标签：先落盘脏数据，再激活标签并载入编辑器（永远单实例换内容） */
async function openPath(path: string): Promise<void> {
  if (path === tabs.activePath) return
  if (host.value?.dirty) await host.value.save()
  tabs.open(path)
  lastSavedAt.value = Date.now()
  void window.api.patchSession({ activePath: path, openTabs: tabs.paths })
  await syncEditorToActive()
}

// 编辑器就绪后补灌：会话恢复时往往 Crepe 还没初始化完
watch(
  () => host.value?.ready,
  (ready) => {
    if (!ready || !pendingPath.value) return
    const path = pendingPath.value
    pendingPath.value = null
    void host.value?.load(path)
  }
)

/** 编辑器就绪后若会话记录开启了凝神模式，则恢复（插件已注册，切开关即生效） */
watch(
  () => host.value?.ready,
  (ready) => {
    if (ready && focusMode.value) host.value?.setZen(true)
  }
)

function onSelect(node: FileNode): void {
  void openPath(node.path)
}

async function newDoc(): Promise<void> {
  if (!vaultPath.value) return void (await openVault())
  const created = await window.api.createDoc(vaultPath.value)
  await refreshTree()
  await openPath(created)
}

/** 文件树里重命名了某个已开标签 → 同步该标签路径，避免继续往旧路径保存 */
function onRenamed(oldPath: string, newPath: string): void {
  const idx = tabs.tabs.findIndex((t) => t.path === oldPath)
  if (idx === -1) return
  tabs.tabs[idx].path = newPath
  if (oldPath === tabs.activePath) {
    tabs.activePath = newPath
    void window.api.patchSession({ activePath: newPath, openTabs: tabs.paths })
  }
}

/** 文件树里删除了当前正在编辑的文档 → 关闭该标签并载入相邻文档 */
function onDeleted(path: string): void {
  if (path !== tabs.activePath) return
  const wasActive = true
  if (wasActive && host.value?.dirty) void host.value.save()
  tabs.close(path)
  void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
  void syncEditorToActive()
}

/** 全文搜索结果点击：打开文档并定位到命中行（源码模式可精确定位） */
async function onOpenResult(payload: { path: string; line: number }): Promise<void> {
  await openPath(payload.path)
  // 两种模式都支持行定位，不再强制切到源码，避免打断所见即所得写作
  host.value?.revealLine(payload.line)
}

/** 源码模式命中高亮：把侧栏搜索状态（query/选项/当前行）转交给编辑器，复用统一搜索逻辑 */
function onFindHighlight(payload: {
  query: string
  opts: { caseSensitive: boolean; wholeWord: boolean }
  currentLine?: number
} | null): void {
  if (payload) host.value?.setFindHighlight(payload.query, payload.opts, payload.currentLine)
  else host.value?.setFindHighlight()
}

/** 链接健康检查：点击断链 → 打开文档并定位到断链所在行（源码模式可精确定位，与全文搜索一致） */
async function onOpenBrokenLink(item: BrokenLinkItem): Promise<void> {
  // 已经是当前文档则跳过「打开」步骤（openPath 对同路径会提前返回，导致后续定位不执行）
  if (item.file !== tabs.activePath) await openPath(item.file)
  // 两种模式都支持行定位，不再强制切到源码；等一拍确保新文档载入、视图就绪再定位
  await nextTick()
  host.value?.revealLine(item.line)
}

/** 全局替换完成：若当前正在编辑的文档在改写范围内，从磁盘重载以反映新内容 */
function onSearchReplaced(paths: string[]): void {
  if (filePath.value && paths.includes(filePath.value)) {
    void host.value?.load(filePath.value)
  }
}

/* ── 多标签交互 ── */

function activateTab(path: string): void {
  void openPath(path)
}

async function closeTab(path: string): Promise<void> {
  const wasActive = path === tabs.activePath
  if (wasActive && host.value?.dirty) await host.value.save()
  tabs.close(path)
  void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
  if (wasActive) await syncEditorToActive()
}

function closeOthers(path: string): void {
  tabs.closeOthers(path)
  void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
}

function closeToRight(path: string): void {
  tabs.closeToRight(path)
  void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
}

/* ── 外部改动同步 ── */

let treeTimer: ReturnType<typeof setTimeout> | null = null

function onVaultChange(change: VaultChange): void {
  // 内容变化不改变树结构，忽略 —— 否则每次自动保存都会触发一次全量重扫
  if (change.kind === 'change') return

  // 当前文档被外部删除：关掉该标签并载入相邻文档
  if (change.kind === 'unlink' && change.path === filePath.value) {
    onDeleted(change.path)
  }

  if (treeTimer) clearTimeout(treeTimer)
  treeTimer = setTimeout(() => void refreshTree(), 200)
}

/* ── 打开 / 保存 ── */

async function openFile(): Promise<void> {
  const picked = await window.api.openFileDialog()
  if (picked) await openPath(picked)
}

async function saveFile(): Promise<void> {
  if (!filePath.value) return void (await saveFileAs())
  await host.value?.save()
  lastSavedAt.value = Date.now()
}

async function saveFileAs(): Promise<void> {
  const picked = await window.api.saveFileDialog(filePath.value ?? undefined)
  if (!picked) return
  // 以新路径作为激活标签，随后 save() 把当前内容写入新路径
  tabs.open(picked)
  await host.value?.save()
  lastSavedAt.value = Date.now()
  void window.api.patchSession({ activePath: picked, openTabs: tabs.paths })
}

function onKeydown(e: KeyboardEvent): void {
  // 无需修饰键的全局快捷键：F1 打开帮助/快捷键面板。
  // 必须放在修饰键守卫之前，否则 !(ctrlKey||metaKey) 会直接 return，F1 毫无反应。
  if (e.key === 'F1') {
    e.preventDefault()
    onHelp('shortcuts')
    return
  }
  // Ctrl/Cmd+F：聚焦左侧搜索框（顶栏搜索已移除，统一在侧栏搜索，支持全库 / 本文档双范围）
  if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    sidebarRef.value?.focusSearch()
    return
  }
  // Esc 状态机（凝神 2.0）：设置面板开着先关面板；否则凝神中 Esc = 掀帘/收帘（轻退栏可在设置中关闭）。
  if (e.key === 'Escape') {
    if (zenSettingsOpen.value) {
      zenSettingsOpen.value = false
      return
    }
    if (focusMode.value) {
      if (zenPrefs.value.retreatBar) {
        retreatOpen.value = !retreatOpen.value
        e.preventDefault()
      }
      return
    }
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 's') {
    e.preventDefault()
    void saveFile()
  } else if (k === 'o') {
    e.preventDefault()
    void openFile()
  } else if (k === '\\') {
    e.preventDefault()
    // Ctrl+\ 切左侧笔记库；Ctrl+Shift+\ 切右侧大纲
    if (e.shiftKey) onToggleOutline()
    else onToggleSidebar()
  } else if (e.key === '/') {
    e.preventDefault()
    requestedMode.value = requestedMode.value === 'wysiwyg' ? 'source' : 'wysiwyg'
  }
}

/* ── 导出（HTML / PDF）── */

const toast = ref<{ msg: string; type: 'ok' | 'err' | 'info' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, type: 'ok' | 'err' | 'info' = 'info'): void {
  toast.value = { msg, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2600)
}

/* ── 图床设置 / 上传 ── */

const showImgHost = ref(false)

function onImgHost(): void {
  showImgHost.value = true
}

/* ── 外观（皮肤 / 明暗）── */

const showAppearance = ref(false)

function onAppearance(): void {
  showAppearance.value = true
}

/* ── 偏好设置（启动行为）── */

const showPreferences = ref(false)
const startupMode = ref<StartupMode>('restore')

function onPreferences(): void {
  showPreferences.value = true
}

/* ── 帮助面板（快捷键 + 使用指南）── */

const showHelp = ref(false)
const helpTab = ref<'shortcuts' | 'guide'>('shortcuts')

function onHelp(tab: 'shortcuts' | 'guide' = 'shortcuts'): void {
  helpTab.value = tab
  showHelp.value = true
}

/** 切换启动偏好并持久化（下次启动生效） */
function onStartupMode(next: StartupMode): void {
  startupMode.value = next
  void window.api.patchSession({ startupMode: next })
}

/* ── 面板显隐（左右独立，持久化）── */

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
const sidebarVisible = ref(true)
const outlineVisible = ref(true)

/* ── 批次二：快照面板 / 凝神模式 / 写作统计 ── */

const snapshots = useSnapshotsStore()
const snapshotOpen = ref(false)
const linkCheckOpen = ref(false)
const writingAidsOpen = ref(false)
const statsOpen = ref(false)
const focusMode = ref(false)
/** 写作目标字数（会话级持久化；0 = 未设） */
const writingGoal = ref(0)
const stats = computed<TextStats>(
  () => host.value?.stats ?? { han: 0, words: 0, chars: 0, charsNoSpace: 0, readingMinutes: 0 }
)

/* ⚠️ 快照功能：实现但未测试（implemented but NOT yet tested）。
   以下恢复/删除/开关逻辑已落地但未做运行期人工验证，暂不体验，待后续专项审查补验收。 */
/** 打开/关闭快照面板：打开时刷新当前文档快照列表 */
function onToggleSnapshot(): void {
  snapshotOpen.value = !snapshotOpen.value
  if (snapshotOpen.value) void snapshots.refresh(vaultPath.value, filePath.value)
}

/** 切换凝神模式：同步编辑器 + 持久化；含「自动全屏」偏好（进入转全屏、退出还原） */
function onToggleFocus(): void {
  focusMode.value = !focusMode.value
  host.value?.setZen(focusMode.value)
  if (!focusMode.value) retreatOpen.value = false
  if (focusMode.value && zenPrefs.value.fullscreen) {
    zenAutoFullscreen = true
    window.api.setFullscreen(true)
  } else if (!focusMode.value && zenAutoFullscreen) {
    zenAutoFullscreen = false
    window.api.setFullscreen(false)
  }
  void window.api.patchSession({ focusMode: focusMode.value })
}

/* ── 凝神 2.0：轻退栏 + 设置面板 + 偏好（docs/FOCUS-MODE-2.0-DESIGN.md）── */

/** 轻退栏是否掀起（Esc 状态机：Esc 掀帘 / 再按或点编辑区收起） */
const retreatOpen = ref(false)
const zenSettingsOpen = ref(false)
/** 凝神偏好：锚点 / 雾化 / 平滑度 / 自动全屏 / 轻退栏（会话持久化） */
const zenPrefs = ref<ZenPrefs>({
  anchor: 1 / 3,
  fog: 'mid',
  scroll: 0.16,
  fullscreen: false,
  retreatBar: true
})
/** 本次凝神是否因偏好自动全屏（退出时只还原自己转的全屏，不碰用户手动 F11） */
let zenAutoFullscreen = false

/** 设置面板改即生效：合并 → 应用（雾化档位写 CSS 变量 / 其余进 zen 模块）→ 持久化 */
function onZenPrefsChange(patch: Partial<ZenPrefs>): void {
  zenPrefs.value = { ...zenPrefs.value, ...patch }
  setZenPrefs(zenPrefs.value)
  void window.api.patchSession({ zenPrefs: zenPrefs.value })
}

function onZenSettings(): void {
  retreatOpen.value = false
  zenSettingsOpen.value = true
}

/** 轻退栏「切换文档」：复用标签激活逻辑（先落盘脏数据，单实例换内容） */
function onZenActivateTab(path: string): void {
  retreatOpen.value = false
  activateTab(path)
}

/** 点编辑区收帘（capture 捕获编辑区内任意点击） */
function onEditorClick(): void {
  if (retreatOpen.value) retreatOpen.value = false
}

/** 打开/关闭统计弹层 */
function onToggleStats(): void {
  statsOpen.value = !statsOpen.value
}

/** 恢复快照：读取内容灌入编辑器并标脏（主进程只读返回，不写盘，守保真红线） */
async function onSnapshotRestore(id: string): Promise<void> {
  try {
    const content = await window.api.snapshotRestore(vaultPath.value!, filePath.value!, id)
    if (content == null) return
    host.value?.loadMarkdownExternal(content)
    showToast('已恢复到该快照', 'ok')
  } catch {
    showToast('快照读取失败', 'err')
  } finally {
    snapshotOpen.value = false
  }
}

/** 删除快照（主进程走系统回收站） */
async function onSnapshotDelete(id: string): Promise<void> {
  await snapshots.remove(vaultPath.value, filePath.value, id)
  showToast('已删除快照', 'ok')
}

/** 更新写作目标并持久化 */
function onGoalChange(value: number): void {
  writingGoal.value = value
  void window.api.patchSession({ writingGoal: value })
}

/** 切换文档时若面板开着则刷新列表 */
watch(filePath, () => {
  if (snapshotOpen.value) void snapshots.refresh(vaultPath.value, filePath.value)
})

/** 写作辅助·属性面板：应用 frontmatter 改动（正文逐字保留，仅改写顶部 YAML 块） */
function onApplyFrontmatter(text: string): void {
  host.value?.loadMarkdownExternal(text)
  showToast(U.writingAids.toastApplied, 'ok')
}

/** 写作辅助·片段面板：在光标处插入模板片段 */
function onInsertSnippet(text: string): void {
  host.value?.insertText(text)
}

/** 窄窗软收起：仅影响显示，不改持久偏好，加宽后恢复用户选择 */
const sidebarShown = computed(() => sidebarVisible.value && windowWidth.value >= 460)
const outlineShown = computed(() => outlineVisible.value && windowWidth.value >= 720)

function onResize(): void {
  windowWidth.value = window.innerWidth
}

function onToggleSidebar(): void {
  sidebarVisible.value = !sidebarVisible.value
  void window.api.patchSession({ sidebarVisible: sidebarVisible.value })
}

function onToggleOutline(): void {
  outlineVisible.value = !outlineVisible.value
  void window.api.patchSession({ outlineVisible: outlineVisible.value })
}

function onOutlineSelect(index: number): void {
  host.value?.gotoOutline(index)
}

/** 图床弹窗里的「上传当前文档图片」：交给编辑器执行发布+重渲染+保存 */
async function onPublishImages(): Promise<void> {
  showImgHost.value = false
  const res = await host.value?.publishImages()
  if (!res) return
  if (res.noImages) {
    showToast(U.toastImgHostNoImages, 'info')
  } else if (!res.ok) {
    showToast(`${U.toastImgHostPublishFail}${res.error ?? ''}`, 'err')
  } else {
    const failedText = res.failed > 0 ? `，${res.failed} ${U.statusUnsaved}` : ''
    showToast(`${U.toastImgHostPublishOk}${res.uploaded}${failedText}`, 'ok')
  }
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? 'document').replace(/\.(md|markdown)$/i, '')
}

async function doExport(kind: 'html' | 'pdf'): Promise<void> {
  if (!filePath.value) {
    showToast(U.toastNoDoc, 'err')
    return
  }
  showToast(kind === 'html' ? `正在生成 ${U.exportHtml}…` : `正在生成 ${U.exportPdf}…`, 'info')

  const body = await host.value?.getHTML()
  if (!body) {
    showToast(U.toastNoContent, 'err')
    return
  }

  const base = baseName(filePath.value)
  const doc = buildExportHtml(body, base, { math: true, mermaid: true })
  const payload = {
    html: doc,
    defaultName: base + (kind === 'html' ? '.html' : '.pdf')
  }

  const res = kind === 'html'
    ? await window.api.exportHtml(payload)
    : await window.api.exportPdf(payload)

  if (res.ok && res.path) {
    showToast(`${U.toastExportHtmlOk}${res.path}`, 'ok')
  } else if (res.canceled) {
    showToast(U.toastExportCanceled, 'info')
  } else {
    showToast(`${U.toastExportErr}${res.error ?? ''}`, 'err')
  }
}

/* ── 语言切换（key 驱动 Vue 重挂 Crepe）── */

const langVer = ref(0)

const localeLabel = computed(() => (getLocale() === 'zh-CN' ? '中' : 'EN'))

function toggleLocale(): void {
  const next: LocaleKey = getLocale() === 'zh-CN' ? 'en-US' : 'zh-CN'
  // 语言切换会重挂编辑器实例（:key），先保存当前滚动位置，重挂后由 onReady 恢复
  host.value?.captureScroll()
  setLocale(next)
  // 自增 key → Vue 销毁旧 MilkdownEditor / 挂载新实例，
  // 构造期固化的标签（BlockEdit 等）自动按新语言生成
  langVer.value++
}

/* ── 会话持久化（崩溃恢复）── */

let widthTimer: ReturnType<typeof setTimeout> | null = null

watch(requestedMode, (mode) => void window.api.patchSession({ mode }))

// 拖宽是高频事件，合并后再落盘
watch(sidebarWidth, (width) => {
  if (widthTimer) clearTimeout(widthTimer)
  widthTimer = setTimeout(() => void window.api.patchSession({ sidebarWidth: width }), 250)
})

onMounted(async () => {
  // 应用持久化的皮肤 / 明暗（index.html 已有青瓷+深默认值兜底）
  initAppearance()

  window.api.onVaultChange(onVaultChange)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)

  const session = await window.api.getSession()
  sidebarWidth.value = session.sidebarWidth
  requestedMode.value = session.mode
  startupMode.value = session.startupMode
  sidebarVisible.value = session.sidebarVisible
  outlineVisible.value = session.outlineVisible
  focusMode.value = session.focusMode === true
  writingGoal.value = session.writingGoal ?? 0
  // 凝神 2.0 偏好：合并默认值兜底旧 session（无 zenPrefs 字段），并立即应用（雾化档位写 CSS 变量）
  zenPrefs.value = { ...zenPrefs.value, ...(session.zenPrefs ?? {}) }
  setZenPrefs(zenPrefs.value)

  // 启动偏好为「全新页面」时不恢复上次笔记库/文档，打开即空白
  if (session.startupMode !== 'fresh') {
    if (session.vaultPath) await useVault(session.vaultPath)
    // 恢复全部已开标签 + 激活文档，并载入激活文档
    const restored = session.openTabs ?? []
    tabs.restore(restored, session.activePath ?? restored[0] ?? null)
    if (tabs.activePath) {
      if (host.value?.ready) await host.value.load(tabs.activePath)
      else pendingPath.value = tabs.activePath
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  if (treeTimer) clearTimeout(treeTimer)
  if (widthTimer) clearTimeout(widthTimer)
  if (toastTimer) clearTimeout(toastTimer)
  void window.api.unwatchVault()
})
</script>

<template>
  <div class="shell" :data-zen="focusMode ? 'on' : null">
    <TitleBar
      :file-name="fileName"
      :mode="requestedMode"
      :dirty="host?.dirty ?? false"
      :can-export="!!filePath"
      @new-doc="newDoc"
      @open="openFile"
      @switch-vault="openVault"
      @update:mode="requestedMode = $event"
      @export-html="doExport('html')"
      @export-pdf="doExport('pdf')"
      @appearance="onAppearance"
      @img-host="onImgHost"
      @preferences="onPreferences"
      @zen-settings="onZenSettings"
      @link-check="linkCheckOpen = true"
      @writing-aids="writingAidsOpen = true"
      @save="saveFile"
      @save-as="saveFileAs"
      @help="onHelp('shortcuts')"
      @about="onHelp('guide')"
      :sidebar-visible="sidebarVisible"
      :outline-visible="outlineVisible"
      :snapshot-active="snapshotOpen"
      :focus-active="focusMode"
      @toggle-sidebar="onToggleSidebar"
      @toggle-outline="onToggleOutline"
      @toggle-snapshot="onToggleSnapshot"
      @toggle-focus="onToggleFocus"
    />

    <TabBar
      :dirty="host?.dirty ?? false"
      @activate="activateTab"
      @close="closeTab"
      @close-others="closeOthers"
      @close-to-right="closeToRight"
    />

    <div class="body">
      <Sidebar
        ref="sidebarRef"
        :vault-path="vaultPath"
        :nodes="tree"
        :active-path="filePath"
        :width="sidebarWidth"
        :visible="sidebarShown && !focusMode"
        :refresh-tree="refreshTree"
        :open-doc="openPath"
        @select="onSelect"
        @open-vault="openVault"
        @new-doc="newDoc"
        @update:width="sidebarWidth = $event"
        @renamed="onRenamed"
        @deleted="onDeleted"
        @open-result="onOpenResult"
        @replaced="onSearchReplaced"
        @find-highlight="onFindHighlight"
      />

      <main class="editor" @click.capture="onEditorClick">
        <EditorHost
          ref="host"
          :file-path="filePath"
          :vault-path="vaultPath"
          :requested-mode="requestedMode"
          :lang-key="langVer"
          @saved="lastSavedAt = Date.now()"
        />

        <SnapshotPanel
          v-if="snapshotOpen"
          :file-path="filePath"
          :vault-path="vaultPath"
          :current-text="host?.getMarkdown() ?? ''"
          @restore="onSnapshotRestore"
          @delete="onSnapshotDelete"
          @close="snapshotOpen = false"
        />

        <LinkCheckPanel
          v-if="linkCheckOpen"
          :vault-path="vaultPath"
          @close="linkCheckOpen = false"
          @open="onOpenBrokenLink"
        />

        <WritingAidsPanel
          v-if="writingAidsOpen"
          :current-text="host?.getMarkdown() ?? ''"
          :can-edit="!!filePath"
          @apply="onApplyFrontmatter"
          @insert="onInsertSnippet"
          @close="writingAidsOpen = false"
        />

        <StatsPopover
          v-if="statsOpen"
          :stats="stats"
          :selection-count="host?.selectionCount ?? 0"
          :goal="writingGoal"
          @update:goal="onGoalChange"
          @close="statsOpen = false"
        />
      </main>

      <Outline
        :visible="outlineShown && !focusMode"
        :items="host?.outline ?? []"
        :active-index="host?.activeHeadingIndex ?? -1"
        @select="onOutlineSelect"
      />
    </div>

      <footer class="statusbar jade">
        <div class="statusbar__inner">
          <div class="statusbar__grp">
            <span>{{ filePath ?? U.statusNoFile }}</span>
          </div>
          <div class="statusbar__grp">
            <span v-if="host?.willNormalize" class="warn">{{ U.willNormalize }}</span>
            <span>
              <i class="dot" :class="host?.dirty ? 'dot--dirty' : 'dot--saved'" />
              {{ host?.dirty ? U.statusUnsaved : U.statusSaved }}
            </span>
          <span>{{ modeLabel }}</span>
          <span v-if="host?.selectionCount" class="sel">{{ U.selection }} {{ host.selectionCount }}</span>
          <button class="stat-chip" type="button" @click="onToggleStats" :title="U.stats">
            {{ stats.han }}<i class="u">{{ U.unitHan }}</i> · {{ stats.words }}<i class="u">{{ U.unitWord }}</i> ·
            {{ stats.readingMinutes }}<i class="u">{{ U.unitMin }}</i>
          </button>
          <button class="lang-btn" @click="toggleLocale" title="切换语言 / Switch language">
            {{ localeLabel }}
          </button>
          </div>
        </div>
      </footer>
    </div>

    <!-- 凝神 2.0：轻退栏（Esc 掀帘看一眼）+ 设置面板 -->
    <ZenRetreatBar
      v-if="focusMode"
      :file-name="fileName"
      :han="stats.han"
      :saved-at="lastSavedAt"
      :open="retreatOpen"
      :tabs="tabs.tabs"
      :active-path="filePath"
      @settings="onZenSettings"
      @exit="onToggleFocus"
      @activate="onZenActivateTab"
      @hide="retreatOpen = false"
    />

    <ZenSettings
      v-if="zenSettingsOpen"
      :prefs="zenPrefs"
      @change="onZenPrefsChange"
      @close="zenSettingsOpen = false"
    />

    <!-- 导出结果轻提示：玻璃质感浮层，自动消失 -->
    <Transition name="toast">
      <div v-if="toast" class="toast" :class="`toast--${toast.type}`">
        {{ toast.msg }}
      </div>
    </Transition>

    <!-- 图床设置 / 上传弹窗 -->
    <ImgHostSettings
      v-if="showImgHost"
      :has-doc="!!filePath"
      @close="showImgHost = false"
      @publish="onPublishImages"
    />

    <!-- 外观设置（皮肤 / 明暗）-->
    <AppearanceSettings v-if="showAppearance" @close="showAppearance = false" />

    <!-- 偏好设置（启动行为）-->
    <PreferencesSettings
      v-if="showPreferences"
      :value="startupMode"
      @close="showPreferences = false"
      @change="onStartupMode"
    />

    <!-- 帮助面板（快捷键 + 使用指南）-->
    <HelpPanel
      v-if="showHelp"
      :initial="helpTab"
      @close="showHelp = false"
    />
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hue-editor);
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.editor {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  background: var(--hue-editor);
}

.statusbar {
  height: var(--h-statusbar);
  flex-shrink: 0;
  border-top: 1px solid var(--hue-border-subtle);
}

.statusbar__inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 14px;
  font-size: 11px;
  color: var(--hue-text-3);
}

.statusbar__grp {
  display: flex;
  gap: 14px;
  align-items: center;
}

.warn {
  color: var(--hue-accent);
}

.sel {
  color: var(--hue-text-2);
}

.stat-chip {
  border: 1px solid var(--hue-border-subtle);
  background: rgba(var(--hue-tint-1), 0.1);
  color: var(--hue-text-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.3;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.stat-chip:hover {
  color: var(--hue-accent);
  border-color: var(--hue-accent);
  background: rgba(var(--hue-tint-1), 0.2);
}
.stat-chip .u {
  font-style: normal;
  font-size: 10px;
  opacity: 0.7;
  margin-left: 1px;
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: middle;
}

.dot--saved {
  background: var(--hue-success);
}

.dot--dirty {
  background: var(--hue-accent);
}

.lang-btn {
  border: 1px solid var(--hue-border-subtle);
  background: rgba(var(--hue-tint-1), 0.12);
  color: var(--hue-text-2);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.3;
  letter-spacing: 0.02em;
}

.lang-btn:hover {
  color: var(--hue-accent);
  border-color: var(--hue-accent);
  background: rgba(var(--hue-tint-1), 0.22);
}

/* ── 导出结果轻提示（玻璃浮层）── */
.toast {
  position: fixed;
  left: 50%;
  bottom: 56px;
  transform: translateX(-50%);
  z-index: 50;
  max-width: min(80vw, 560px);
  padding: 9px 16px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--hue-text-1);
  background: rgba(var(--hue-tint-1), 0.72);
  border: 1px solid var(--hue-border-strong, var(--hue-border-subtle));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(28px) saturate(170%);
  -webkit-backdrop-filter: blur(28px) saturate(170%);
  word-break: break-all;
  pointer-events: none;
}

.toast--ok {
  border-color: rgba(var(--hue-success-rgb, 60, 180, 140), 0.6);
}

.toast--err {
  border-color: rgba(224, 79, 69, 0.6);
  color: #f3b4af;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--dur-fast, 0.18s) var(--ease, ease),
    transform var(--dur-fast, 0.18s) var(--ease, ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
