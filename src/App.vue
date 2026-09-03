<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Icon from './components/Icon.vue'
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
import BacklinksPanel from './components/BacklinksPanel.vue'
import IntegrityPanel from './components/IntegrityPanel.vue'
import BackupPanel from './components/BackupPanel.vue'
import ConflictDialog from './components/ConflictDialog.vue'
import WritingAidsPanel from './components/WritingAidsPanel.vue'
import StatsPopover from './components/StatsPopover.vue'
import ZenRetreatBar from './components/ZenRetreatBar.vue'
import ZenSettings from './components/ZenSettings.vue'
import ExportPreview from './components/ExportPreview.vue'
import CompilePanel from './components/CompilePanel.vue'
import { setZenPrefs } from './editor/zen'
import { initAppearance } from './appearance'
import type { EditorMode } from './editor/EditorHost.vue'
import type {
  FileNode,
  VaultChange,
  StartupMode,
  ZenPrefs,
  BrokenLinkItem,
  ExportResult,
  ExportPayload,
  IntegrityReport,
} from '../electron/shared/ipc-channels'
import { inlineImages } from './export/imageInline'
import { parseFrontmatter } from './editor/frontmatter'
import { type ExportKind } from './export/types'
import {
  buildExportContent,
  kindLabel,
  bytesToBase64,
  type BuiltExport,
  type ExportContext,
} from './export/buildExport'
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
  filePath.value ? (filePath.value.split(/[\\/]/).pop() ?? '') : U.untitled,
)

const modeLabel = computed(() => (requestedMode.value === 'wysiwyg' ? U.modeWysiwyg : U.modeSource))

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
  },
)

/** 编辑器就绪后若会话记录开启了凝神模式，则恢复（插件已注册，切开关即生效） */
watch(
  () => host.value?.ready,
  (ready) => {
    if (ready && focusMode.value) host.value?.setZen(true)
  },
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

/**
 * 同步标签路径：就地 / 文件夹重命名或移动后，把命中 oldPath 的标签（及其内部所有后代文档）
 * 整体重映射到 newPath。文件夹的移动/重命名会让内部每篇文档的绝对路径都变化，必须前缀批量重映射，
 * 否则嵌套的活动文档标签仍指向旧路径，编辑器自动保存会把已迁走的文件「复活」回来。
 * 返回是否改动了当前激活标签路径（便于随后持久化），并收集需在 watcher 回声中免疫的路径集合。
 */
function remapTabPaths(
  oldPath: string,
  newPath: string,
): { activeChanged: boolean; immune: string[] } {
  const sep = oldPath.includes('\\') ? '\\' : '/'
  const prefix = oldPath + sep
  const immune = new Set<string>([oldPath, newPath, assetsPathOf(oldPath), assetsPathOf(newPath)])
  for (const t of tabs.tabs) {
    let np: string | null = null
    if (t.path === oldPath) np = newPath
    else if (t.path.startsWith(prefix)) np = newPath + t.path.slice(oldPath.length)
    if (np) {
      immune.add(t.path)
      immune.add(np)
      t.path = np
    }
  }
  let activeChanged = false
  const ap = tabs.activePath
  if (oldPath === ap) {
    tabs.activePath = newPath
    activeChanged = true
  } else if (ap && ap.startsWith(prefix)) {
    tabs.activePath = newPath + ap.slice(oldPath.length)
    activeChanged = true
  }
  return { activeChanged, immune: [...immune] }
}

/** 文件树里重命名了某个节点（文件或文件夹）→ 同步所有受影响标签路径，避免继续往旧路径保存 */
function onRenamed(oldPath: string, newPath: string): void {
  // 抑制此次重命名的 watcher 回声（unlink+add）：既去重刷新，又避免当前文档被误判删除
  const { activeChanged, immune } = remapTabPaths(oldPath, newPath)
  markProgrammatic(immune)
  if (activeChanged)
    void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
}

/** 双击标签标题重命名：复用 renameItem + 同步标签路径 + 刷新树 */
async function onTabRename(payload: { path: string; name: string }): Promise<void> {
  try {
    const newPath = await window.api.renameItem(payload.path, payload.name)
    onRenamed(payload.path, newPath)
    await refreshTree()
  } catch (e) {
    showToast(U.renameFail.replace('{m}', e instanceof Error ? e.message : String(e)), 'err')
  }
}

/** 外部删除（含文件夹被外部删除时其内部各文件的 unlink）：把命中 path 的标签（及其后代）一并关闭，
 *  且取消活动文档的待保存，避免自动保存把已删路径复活；同时抑制 watcher 回声，避免重复刷新。 */
function onDeleted(path: string): void {
  const sep = path.includes('\\') ? '\\' : '/'
  const inside = (p: string): boolean => p === path || p.startsWith(path + sep)
  const affected = tabs.tabs.filter((t) => inside(t.path))
  if (!affected.length) return
  const wasActive = affected.some((t) => t.path === tabs.activePath)
  if (wasActive) host.value?.cancelPendingSave()
  markProgrammatic([
    path,
    assetsPathOf(path),
    ...affected.flatMap((t) => [t.path, assetsPathOf(t.path)]),
  ])
  for (const t of affected) tabs.close(t.path)
  void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
  if (wasActive) void syncEditorToActive()
}

/**
 * 文件树里删除节点（文件或文件夹）：先把「节点本身及其内部」所有已开标签关掉（含活动文档，
 * 且取消其待保存以免自动保存重建已删文件/目录），再真正删除磁盘内容，最后单一刷新。
 * 历史目录的迁移/清理由主进程 deleteItem 统一负责（按文档绝对路径哈希定位）。
 */
async function onDeleteNode(node: FileNode): Promise<void> {
  const sep = node.path.includes('\\') ? '\\' : '/'
  const inside = (p: string): boolean => p === node.path || p.startsWith(node.path + sep)
  const affected = tabs.tabs.filter((t) => inside(t.path))
  const wasActive = affected.some((t) => t.path === tabs.activePath)
  if (wasActive) host.value?.cancelPendingSave()

  // 抑制删除的 watcher 回声（unlink/unlinkDir）：含文件夹内各文件，避免重复刷新与误判
  markProgrammatic([
    node.path,
    assetsPathOf(node.path),
    ...affected.map((t) => t.path),
    ...affected.map((t) => assetsPathOf(t.path)),
  ])

  // 先关标签，再删磁盘，避免编辑器自动保存把已删路径重建出来
  for (const t of affected) tabs.close(t.path)
  void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })

  try {
    await window.api.deleteItem(node.path)
  } catch (e) {
    showToast(U.deleteFail.replace('{m}', e instanceof Error ? e.message : String(e)), 'err')
    await refreshTree()
    return
  }
  if (wasActive) void syncEditorToActive()
  await refreshTree()
}

/** 文件树里移动了某节点（拖拽或菜单，文件或文件夹）：重映射标签路径、抑制 watcher 回声、刷新文件树 */
async function onMoved(oldPath: string, newPath: string): Promise<void> {
  const { activeChanged, immune } = remapTabPaths(oldPath, newPath)
  markProgrammatic(immune)
  if (activeChanged)
    void window.api.patchSession({ activePath: tabs.activePath, openTabs: tabs.paths })
  await refreshTree()
}

/** 全文搜索结果点击：打开文档并定位到命中行（源码模式可精确定位） */
async function onOpenResult(payload: { path: string; line: number }): Promise<void> {
  await openPath(payload.path)
  // 两种模式都支持行定位，不再强制切到源码，避免打断所见即所得写作
  host.value?.revealLine(payload.line)
}

/** 源码模式命中高亮：把侧栏搜索状态（query/选项/当前行）转交给编辑器，复用统一搜索逻辑 */
function onFindHighlight(
  payload: {
    query: string
    opts: { caseSensitive: boolean; wholeWord: boolean; regex?: boolean }
    currentLine?: number
  } | null,
): void {
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

/**
 * 断链一键创建：按目标写法的意图落位并打开新笔记。
 *  - 目标带路径（`folder/Note`）→ 视作库内相对路径，在库内对应目录建；
 *  - 目标为裸名（`Note`）→ 就地建在**来源笔记所在目录**，
 *    因为断链多半是同主题笔记互引，就地补齐能让目录保持内聚，而不是把库根堆成孤儿收容所。
 */
async function onCreateBrokenLink(item: BrokenLinkItem): Promise<void> {
  const root = vaultPath.value
  if (!root) return
  const parts = item.target.replace(/\\/g, '/').trim().split('/').filter(Boolean)
  const name = (parts.pop() ?? '').replace(/\.(md|markdown)$/i, '')
  if (!name) {
    showToast(U.linkCheckCreateFail, 'err')
    return
  }
  const dir = parts.length > 0 ? [root, ...parts].join('/') : item.file.replace(/[\\/][^\\/]+$/, '')
  try {
    const created = await window.api.createDoc(dir, name)
    await refreshTree()
    await openPath(created)
    showToast(U.wikilinkCreated.replace('{n}', name), 'ok')
    linkCheckRef.value?.refresh()
  } catch {
    showToast(U.linkCheckCreateFail, 'err')
  }
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

/**
 * 程序化改动的同源事件抑制（见 src/refreshGuard.ts）：我们在渲染层显式刷新后，主进程
 * watcher 还会把同一磁盘改动再推回来。以「路径集合 + 时间窗」标定我们刚亲手做过的改动，
 * 让同源事件直接忽略——既去重刷新，也避免当前文档被移动/重命名时误判为「外部删除」。
 */
import { isVaultEventSuppressed, markProgrammatic, assetsPathOf } from './refreshGuard'

/**
 * 外部修改冲突检测：当笔记库里「当前正在编辑」的文档被玉笺之外（别的编辑器 / Git 切分支 /
 * 资源管理器改名）改写时，若磁盘内容与编辑器内存内容不同，弹出三选一对话框，绝不静默覆盖。
 * - 自己的保存回声：磁盘 == 内存（我们刚写过的内容）→ 直接忽略，不误报。
 * - 任意有意重写磁盘的操作（保存 / 恢复备份）后，用 conflictSuppressUntil 抑制一段窗口，
 *   避免自身的 change 事件再次触发冲突误报。
 */
let conflictSuppressUntil = 0
function isConflictSuppressed(): boolean {
  return Date.now() < conflictSuppressUntil
}

async function detectConflict(path: string): Promise<void> {
  if (isConflictSuppressed() || conflictOpen.value) return
  try {
    const disk = await window.api.readFile(path)
    const mine = host.value?.getMarkdown() ?? ''
    // 归一化换行，避免 CRLF / LF 差异造成误报
    const norm = (s: string): string => s.replace(/\r\n/g, '\n')
    if (norm(disk) === norm(mine)) return // 这是自己的保存回声，忽略
    // 确有外部改动且与内存不同 → 取消待执行的自动保存，避免 800ms 后把外部改动覆盖掉
    host.value?.cancelPendingSave()
    const st = await window.api.statFile(path).catch(() => null)
    conflict.value = {
      path,
      mine,
      disk,
      diskMtime: st?.exists ? st.mtimeMs : null,
    }
    conflictOpen.value = true
  } catch {
    // 读不到磁盘内容：不处理
  }
}

function siblingMinePath(p: string): string {
  const dot = p.lastIndexOf('.')
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (dot > slash && dot >= 0) return p.slice(0, dot) + '.mine' + p.slice(dot)
  return p + '.mine'
}

function finishConflict(): void {
  conflictOpen.value = false
  conflict.value = null
}

function onConflictKeepMine(): void {
  if (!conflict.value) return
  conflictSuppressUntil = Date.now() + 5000
  // 覆盖外部改动：把内存中的「我的版本」写回磁盘（朗读保真、不丢字）
  void host.value?.save()
  finishConflict()
}

async function onConflictUseDisk(): Promise<void> {
  if (!conflict.value) return
  conflictSuppressUntil = Date.now() + 5000
  await host.value?.load(conflict.value.path).catch(() => {})
  finishConflict()
}

async function onConflictKeepBoth(): Promise<void> {
  if (!conflict.value) return
  const c = conflict.value
  conflictSuppressUntil = Date.now() + 5000
  const minePath = siblingMinePath(c.path)
  try {
    await window.api.writeFile(minePath, c.mine)
  } catch {
    /* 另存失败不阻断：仍载入磁盘版本 */
  }
  await host.value?.load(c.path).catch(() => {})
  const base = minePath.split(/[\\/]/).pop() ?? minePath
  showToast(U.backupConflictBothSaved.replace('{p}', base), 'ok')
  finishConflict()
}

/** 恢复备份：重载当前文档以反映磁盘最新内容，并抑制「外部修改」误报 */
function onBackupRestored(): void {
  conflictSuppressUntil = Date.now() + 5000
  if (filePath.value) void host.value?.load(filePath.value).catch(() => {})
}

function onVaultChange(change: VaultChange): void {
  // 程序化改动的回声（重命名 / 移动 / 删除 / 新建）：我们已在渲染层显式刷新并同步状态，
  // 这里的同源事件直接忽略，避免重复刷新与「当前文档被误判删除」的竞态
  if (isVaultEventSuppressed(change.path)) return

  // 内容变化：仅对「当前正在编辑」的文档做冲突检测；其他文件改动不影响当前编辑，忽略
  if (change.kind === 'change') {
    if (change.path === filePath.value && filePath.value) {
      void detectConflict(change.path)
    }
    return
  }

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
  // F3 / Shift+F3：上一处 / 下一处搜索命中（侧栏搜索循环导航）
  if (e.key === 'F3') {
    e.preventDefault()
    if (e.shiftKey) sidebarRef.value?.prevHit()
    else sidebarRef.value?.nextHit()
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

function showToast(msg: string, type: 'ok' | 'err' | 'info' = 'info', duration = 2600): void {
  toast.value = { msg, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), duration)
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
/** 应用版本号（来自主进程，动态显示，避免「关于」面板硬编码过时版本） */
const appVersion = ref('1.0.0')

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
/** 断链面板实例：一键创建成功后由 App 回调 refresh() 复检 */
const linkCheckRef = ref<InstanceType<typeof LinkCheckPanel> | null>(null)
const backlinksOpen = ref(false)
const integrityOpen = ref(false)
const backupOpen = ref(false)
const writingAidsOpen = ref(false)
const lastIntegrityReport = ref<IntegrityReport | null>(null)
const conflict = ref<{ path: string; mine: string; disk: string; diskMtime: number | null } | null>(
  null,
)
const conflictOpen = ref(false)
const statsOpen = ref(false)
const focusMode = ref(false)
/** 写作目标字数（会话级持久化；0 = 未设） */
const writingGoal = ref(0)
const stats = computed<TextStats>(
  () => host.value?.stats ?? { han: 0, words: 0, chars: 0, charsNoSpace: 0, readingMinutes: 0 },
)

/** 打开/关闭快照面板：打开时刷新当前文档快照列表（快照功能已于 2026-08-30 经用户运行期验证可用） */
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
  retreatBar: true,
  blockZoom: true,
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

/** 打开完整性自检浮层（标题栏「更多」入口） */
function onIntegrity(): void {
  integrityOpen.value = true
}

/** 打开整库备份 / 恢复浮层（标题栏「更多」入口） */
function onBackup(): void {
  backupOpen.value = true
}

/** 打开反链面板（标题栏「更多」入口）：展示有哪些笔记链接到当前文档 */
function onBacklinks(): void {
  backlinksOpen.value = true
}

/** 编辑器内点击 [[wikilink]] 芯片：解析目标 → 已存在则跳转，不存在则一键创建该笔记 */
async function onWikilink(payload: { target: string; anchor?: string | null }): Promise<void> {
  if (!vaultPath.value) {
    await openVault()
    return
  }
  const resolved = await window.api.resolveWikiTarget(vaultPath.value, payload.target)
  if (resolved) {
    await openPath(resolved)
    return
  }
  // 目标不存在：以目标文件名一键创建笔记并打开（批次二需求：missing → one-click create）
  const base = payload.target.split(/[\\/]/).pop()?.split('#')[0].trim()
  if (!base) {
    showToast(U.wikilinkOpenFail, 'err')
    return
  }
  try {
    const created = await window.api.createDoc(vaultPath.value, base)
    await refreshTree()
    await openPath(created)
    showToast(U.wikilinkCreated.replace('{n}', created.split(/[\\/]/).pop() ?? base), 'ok')
  } catch {
    showToast(U.wikilinkOpenFail, 'err')
  }
}

/** 自检浮层回报结果：状态栏据此展示告警标记（点击重开浮层） */
function onIntegrityReport(report: IntegrityReport | null): void {
  lastIntegrityReport.value = report
}

/** 恢复快照：读取内容灌入编辑器并标脏（主进程只读返回，不写盘，守保真红线） */
async function onSnapshotRestore(id: string): Promise<void> {
  try {
    const content = await window.api.snapshotRestore(vaultPath.value!, filePath.value!, id)
    if (content == null) return
    host.value?.loadMarkdownExternal(content)
    showToast(U.snapshotRestored, 'ok')
  } catch {
    showToast(U.snapshotReadFail, 'err')
  } finally {
    snapshotOpen.value = false
  }
}

/** 快照 cherry-pick：把 diff 中某变更段（旧版/B 侧内容）摘取到当前文档光标处 */
function onSnapshotPick(text: string): void {
  if (!text) return
  host.value?.insertText(text)
  showToast(U.snapshotPicked, 'ok')
}

/** 删除快照（主进程走系统回收站） */
async function onSnapshotDelete(id: string): Promise<void> {
  await snapshots.remove(vaultPath.value, filePath.value, id)
  showToast(U.snapshotDeleted, 'ok')
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

/** 标题栏「更多 · 插入双链」：唤起 [[ 自动补全浮层（或源码端插入字面 [[） */
function onInsertWikiLink(): void {
  host.value?.insertWikiLink()
}

/** 窄窗软收起：仅影响显示，不改持久偏好，加宽后恢复用户选择 */
const sidebarShown = computed(() => sidebarVisible.value && windowWidth.value >= 460)
const outlineShown = computed(() => outlineVisible.value && windowWidth.value >= 720)

/** 编辑器图片落盘失败（粘贴/拖入图片磁盘不可写等）：明确告知用户，而非静默吞掉 */
function onEditorError(): void {
  showToast(U.toastImageSaveFail, 'err')
}

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
    const failedText =
      res.failed > 0 ? U.toastImgHostPartialFail.replace('{n}', String(res.failed)) : ''
    showToast(U.toastImgHostPublishOk.replace('{n}', String(res.uploaded)) + failedText, 'ok')
  }
}

/**
 * 导出选项（导出菜单里逐项切换）：
 * - toc 自动目录（PDF 恒为是——纸质阅读需要导航）
 * - cover 封面页（标题 / 作者 / 日期，取自 frontmatter）
 * - inline 图片与图表内联为 data URL（自包含、离线可读；PDF 恒为内联，代价是体积变大）
 * - selection 仅导出选中内容（无选区时回退整篇）
 */
const exportPrefs = ref({
  toc: false,
  cover: false,
  inline: true,
  selection: false,
  preview: false,
})

/** 导出菜单切换一个选项 */
function toggleExportPref(key: 'toc' | 'cover' | 'inline' | 'selection' | 'preview'): void {
  exportPrefs.value = { ...exportPrefs.value, [key]: !exportPrefs.value[key] }
}

/**
 * 取导出元信息：优先用属性面板写入的 frontmatter，回退到文档名。
 * 日期既可能是字符串也可能是 YAML 解析出的 Date，统一取年月日。
 */
function readExportMeta(base: string): { title?: string; author?: string; date?: string } {
  const md = host.value?.getMarkdown?.() ?? ''
  const { data } = parseFrontmatter(md)
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = data[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (v instanceof Date) return v.toISOString().slice(0, 10)
    }
    return undefined
  }
  return {
    title: pick('title') ?? base,
    author: pick('author', 'authors'),
    date: pick('date', 'updated', 'created'),
  }
}

/** 读取绝对路径图片为 data URL（导出内联用）；失败返回 null，保留原 src 不破坏文档 */
async function readAsDataUrl(absPath: string): Promise<string | null> {
  const res = await window.api.readFileBase64(absPath)
  return res.ok && res.dataUrl ? res.dataUrl : null
}

/** 导出前预览状态 */
const showPreview = ref(false)
const previewState = ref<BuiltExport | null>(null)

/** 写盘 / 打印：与构建分离，预览确认后直接复用已构建的内容 */
async function writeExport(built: BuiltExport): Promise<void> {
  const payload: ExportPayload = {
    content: built.content,
    defaultName: built.defaultName,
    filters: built.filters,
    binaryBase64: built.binary ? bytesToBase64(built.binary) : undefined,
    mime: built.mime,
  }
  let res: ExportResult
  try {
    res =
      built.kind === 'pdf'
        ? await window.api.exportPdf(payload)
        : await window.api.exportFile(payload)
  } catch (e) {
    console.error('[export] 写盘 IPC 失败：', e)
    showToast(`${U.toastExportErr}${e instanceof Error ? e.message : String(e)}`, 'err', 5000)
    return
  }
  if (res.ok && res.path) {
    // 成功：保留路径较长时间，让用户明确看到「导出到了哪里」
    showToast(`${U.toastExportHtmlOk}${res.path}`, 'ok', 4500)
  } else if (res.canceled) {
    showToast(U.toastExportCanceled, 'info')
  } else {
    showToast(`${U.toastExportErr}${res.error ?? ''}`, 'err', 5000)
  }
}

/** 把 App 级导出环境打包成 ExportContext，注入给纯构建逻辑 */
function exportContext(): ExportContext {
  return {
    filePath: filePath.value,
    exportPrefs: exportPrefs.value,
    host: host.value,
    readExportMeta,
    readAsDataUrl,
    showToast,
    U,
  }
}

/**
 * 导出当前文档。三种产物共用一条管道：取正文 → 变换 → 预览（可选）→ 通用写盘 / 打印。
 * @param kind  html 网页 / pdf 文档 / latex 源文件
 * @param scope all 整篇 / selection 当前选中（无选区时回退整篇）
 */
async function doExport(kind: ExportKind, scope: 'all' | 'selection' = 'all'): Promise<void> {
  if (!filePath.value) {
    showToast(U.toastNoDoc, 'err')
    return
  }
  const label = kindLabel(kind, U)
  showToast(`${U.toastExporting}${label}…`, 'info')

  try {
    const built = await buildExportContent(kind, scope, undefined, exportContext())
    if (!built) return // buildExportContent 内部已给出原因提示（无内容 / 无选区等）

    // 开启「导出前预览」：先呈现产物，用户确认后再落盘（落盘时会弹出系统保存对话框）
    if (exportPrefs.value.preview) {
      previewState.value = built
      showPreview.value = true
      toast.value = null // 预览界面已接管，清掉「导出中」提示，避免其悬在浮层之后
      return
    }
    await writeExport(built)
  } catch (e) {
    // 任何一步（取正文 / 内联图片 / 渲染图表 / 序列化）抛错都不该静默——明确告诉用户
    console.error('[export] 生成导出内容失败：', e)
    showToast(`${U.toastExportErr}${e instanceof Error ? e.message : String(e)}`, 'err', 5000)
  }
}

/** 预览面板确认：把已构建的内容落盘 / 打印 */
async function confirmExport(): Promise<void> {
  const built = previewState.value
  showPreview.value = false
  previewState.value = null
  if (!built) return
  try {
    await writeExport(built)
  } catch (e) {
    console.error('[export] 写盘失败：', e)
    showToast(`${U.toastExportErr}${e instanceof Error ? e.message : String(e)}`, 'err', 5000)
  }
}

/** 预览面板取消：丢弃已构建内容 */
function cancelExport(): void {
  showPreview.value = false
  previewState.value = null
}

/* ── 多文件合订（CompilePanel → 共用 buildExportContent override）── */

const showCompile = ref(false)

/**
 * 多文件合订：逐文件读取 → markdownToHtml 渲染 → 按各自文档目录内联图片 → 拼接，
 * 再交给与单文档完全相同的导出管道（含预览 / 写盘 / 自包含内联）。
 * 图片必须在拼接前按文档所在目录分别内联，合订后无法再用单一基准路径解析。
 */
async function onCompile(payload: {
  files: string[]
  title: string
  newPagePerDoc: boolean
  kind: ExportKind
  preview: boolean
}): Promise<void> {
  if (!vaultPath.value) {
    showToast(U.toastNoDoc, 'err')
    return
  }
  if (!payload.files.length) {
    showToast(U.compileNoSelection, 'info')
    return
  }
  showCompile.value = false
  const label = kindLabel(payload.kind, U)
  showToast(`${U.toastExporting}${label}…`, 'info')

  try {
    let combinedHtml = ''
    let combinedMd = ''
    for (const file of payload.files) {
      const md = await window.api.readFile(file)
      if (!md.trim()) continue
      const html = host.value?.markdownToHtml(md) ?? ''
      // 按该文档所在目录把相对图片内联为 data URL（合订后无法用单一基准）
      const inlined = await inlineImages(html, file, readAsDataUrl)
      combinedHtml += payload.newPagePerDoc
        ? `<section class="yj-compile-page">${inlined}</section>`
        : inlined
      combinedMd += `\n\n${md}\n`
    }
    if (!combinedHtml && !combinedMd.trim()) {
      showToast(U.toastNoContent, 'err')
      return
    }

    const built = await buildExportContent(
      payload.kind,
      'all',
      {
        title: payload.title,
        bodyHtml: combinedHtml,
        markdown: combinedMd,
        forceInline: true,
      },
      exportContext(),
    )
    if (!built) return

    if (payload.preview) {
      previewState.value = built
      showPreview.value = true
      toast.value = null
      return
    }
    await writeExport(built)
  } catch (e) {
    console.error('[export] 合订导出失败：', e)
    showToast(`${U.toastExportErr}${e instanceof Error ? e.message : String(e)}`, 'err', 5000)
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

  // 动态获取真实应用版本（打包后取 package.json 的 version），展示在「关于」面板
  window.api
    .appVersion()
    .then((v) => {
      if (v) appVersion.value = v
    })
    .catch(() => {})

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
  <div
    class="shell"
    :data-zen="focusMode ? 'on' : null"
    :data-zen-block-zoom="zenPrefs.blockZoom ? 'on' : 'off'"
  >
    <TitleBar
      :file-name="fileName"
      :mode="requestedMode"
      :dirty="host?.dirty ?? false"
      :can-export="!!filePath"
      @new-doc="newDoc"
      @open="openFile"
      @switch-vault="openVault"
      @update:mode="requestedMode = $event"
      :export-prefs="exportPrefs"
      @export-md="doExport('md')"
      @export-txt="doExport('txt')"
      @export-html="doExport('html')"
      @export-pdf="doExport('pdf')"
      @export-latex="doExport('latex')"
      @export-docx="doExport('docx')"
      @export-epub="doExport('epub')"
      @export-rtf="doExport('rtf')"
      @export-odt="doExport('odt')"
      @export-compile="showCompile = true"
      @export-option="toggleExportPref"
      @appearance="onAppearance"
      @img-host="onImgHost"
      @preferences="onPreferences"
      @zen-settings="onZenSettings"
      @link-check="linkCheckOpen = true"
      @integrity="onIntegrity"
      @backup="onBackup"
      @backlinks="onBacklinks"
      @insert-wikilink="onInsertWikiLink"
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
      @rename="onTabRename"
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
        @delete-node="onDeleteNode"
        @moved="onMoved"
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
          @error="onEditorError"
          @wikilink="onWikilink"
        />

        <SnapshotPanel
          v-if="snapshotOpen"
          :file-path="filePath"
          :vault-path="vaultPath"
          :current-text="host?.getMarkdown() ?? ''"
          @restore="onSnapshotRestore"
          @delete="onSnapshotDelete"
          @pick="onSnapshotPick"
          @close="snapshotOpen = false"
        />

        <LinkCheckPanel
          v-if="linkCheckOpen"
          ref="linkCheckRef"
          :vault-path="vaultPath"
          @close="linkCheckOpen = false"
          @open="onOpenBrokenLink"
          @create="onCreateBrokenLink"
        />

        <BacklinksPanel
          v-if="backlinksOpen"
          :vault-path="vaultPath"
          :active-path="filePath"
          @close="backlinksOpen = false"
          @open="onOpenResult"
        />

        <IntegrityPanel
          v-if="integrityOpen"
          :vault-path="vaultPath"
          @close="integrityOpen = false"
          @report="onIntegrityReport"
        />

        <BackupPanel
          v-if="backupOpen"
          :vault-path="vaultPath"
          @close="backupOpen = false"
          @after-restore="onBackupRestored"
        />

        <ConflictDialog
          v-if="conflictOpen"
          :open="conflictOpen"
          :path="conflict?.path ?? null"
          :mine="conflict?.mine ?? ''"
          :disk="conflict?.disk ?? ''"
          :disk-mtime="conflict?.diskMtime ?? null"
          @keep-mine="onConflictKeepMine"
          @use-disk="onConflictUseDisk"
          @keep-both="onConflictKeepBoth"
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
          <span v-if="host?.selectionCount" class="sel"
            >{{ U.selection }} {{ host.selectionCount }}</span
          >
          <button class="stat-chip" type="button" @click="onToggleStats" :title="U.stats">
            {{ stats.han }}<i class="u">{{ U.unitHan }}</i> · {{ stats.words
            }}<i class="u">{{ U.unitWord }}</i> · {{ stats.readingMinutes
            }}<i class="u">{{ U.unitMin }}</i>
          </button>
          <button
            v-if="lastIntegrityReport && lastIntegrityReport.total > 0"
            class="warn-chip"
            type="button"
            :title="U.integrity"
            @click="integrityOpen = true"
          >
            <Icon name="alert" :size="12" />
            {{ lastIntegrityReport.total }}
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
  <HelpPanel v-if="showHelp" :initial="helpTab" :version="appVersion" @close="showHelp = false" />

  <!-- 导出前预览（玻璃浮层；HTML/PDF 渲染真实排版，LaTeX 显示源码）-->
  <ExportPreview
    v-if="showPreview && previewState"
    :content="previewState.content"
    :kind="previewState.kind"
    :default-name="previewState.defaultName"
    @confirm="confirmExport"
    @cancel="cancelExport"
  />

  <!-- 多文件合订面板 -->
  <CompilePanel
    v-if="showCompile"
    :tree="tree"
    :vault-path="vaultPath"
    :preview="exportPrefs.preview"
    @close="showCompile = false"
    @compile="onCompile"
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

.warn-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(var(--hue-mark), 0.6);
  background: rgba(var(--hue-mark), 0.14);
  color: rgb(var(--hue-mark));
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.3;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.warn-chip:hover {
  background: rgba(var(--hue-mark), 0.26);
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
  transition:
    opacity var(--dur-fast, 0.18s) var(--ease, ease),
    transform var(--dur-fast, 0.18s) var(--ease, ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
