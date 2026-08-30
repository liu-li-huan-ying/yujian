<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  type FileNode,
  type SearchFileResult
} from '../../electron/shared/ipc-channels'
import { useI18n } from '../i18n'
import FileTree from './FileTree.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SearchResults from './SearchResults.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  vaultPath: string | null
  nodes: FileNode[]
  activePath: string | null
  width: number
  /** 面板是否可见（收起时宽度归零并隐藏拖拽条） */
  visible?: boolean
  /** 刷新文件树（App 持有真实实现，此处注入以便 await） */
  refreshTree: () => Promise<void>
  /** 在编辑器打开指定文档 */
  openDoc: (path: string) => Promise<void>
}>()

const { t } = useI18n()
const L = t.ui

const emit = defineEmits<{
  (e: 'select', node: FileNode): void
  (e: 'open-vault'): void
  (e: 'new-doc'): void
  (e: 'update:width', width: number): void
  /** 重命名了当前正在编辑的文档：让 App 同步活动路径 */
  (e: 'renamed', oldPath: string, newPath: string): void
  /** 删除了当前正在编辑的文档：让 App 清空活动路径 */
  (e: 'deleted', path: string): void
  /** 全文搜索结果点击：让 App 打开文档并定位到命中行 */
  (e: 'open-result', payload: { path: string; line: number }): void
  /** 全局替换完成：把被改写的文件列表抛给 App，便于重载正在编辑的文档 */
  (e: 'replaced', paths: string[]): void
  /** 双范围命中高亮状态：有查询且已打开文档时把 query/选项/当前行交给编辑器（源码 + 所见即所得两端高亮） */
  (e: 'find-highlight', payload: {
    query: string
    opts: { caseSensitive: boolean; wholeWord: boolean }
    currentLine?: number
  } | null): void
}>()

/** 目录默认折叠，展开状态提升到此处，方便会话恢复时自动展开祖先链 */
const expanded = ref<Set<string>>(new Set())

/** 正在内联重命名的节点路径（null 表示无） */
const editingPath = ref<string | null>(null)

/** 右键上下文菜单状态 */
const menu = ref<{ x: number; y: number; node: FileNode } | null>(null)

/** 删除二次确认状态 */
const confirmState = ref<{ open: boolean; node: FileNode } | null>(null)

/** 轻量错误提示 */
const toast = ref<{ msg: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

/* ── 搜索：双范围（全部 / 本文档）共用同一套逻辑 ──
   两种范围共用一个搜索框与「区分大小写 / 全词匹配」选项，且复用主进程同一套
   searchVault / replaceInVault：区别只在范围——「本文档」把当前文档路径作为
   file 参数传入（只搜该单文件、不递归），「全部」则递归全库。结果统一用
   SearchResults 渲染、点击跳转定位行，无需为两种范围各写一套 UI。 */

const searchScope = ref<'vault' | 'doc'>('vault')
const searchQuery = ref('')
const isSearching = ref(false)
const searchResults = ref<SearchFileResult[]>([])
const caseSensitive = ref(false)
const wholeWord = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null

/** 当前结果高亮所在行（点结果时更新，用于源码模式强化当前命中）；undefined 表示无 */
const currentFindLine = ref<number | undefined>(undefined)

/** 当前范围对应的检索文件：本文档范围传 activePath，全库范围不传（递归全库） */
function scopeFile(): string | undefined {
  return searchScope.value === 'doc' ? props.activePath ?? undefined : undefined
}

/**
 * 驱动两端命中高亮：只要有查询且已打开文档，就把 query/选项/当前行抛给编辑器
 * （EditorHost 同时转发给源码模式 CodeMirror 装饰 + 所见即所得 ProseMirror 装饰，
 * 两种范围都高亮——全库范围也会高亮当前打开文档内的全部命中）；
 * 其余情况（无查询 / 无文档）抛 null 清空高亮。本地计算无需等 IPC 结果，即时生效。
 */
function syncFindHighlight(): void {
  if (searchQuery.value.trim() && props.activePath) {
    emit('find-highlight', {
      query: searchQuery.value.trim(),
      opts: { caseSensitive: caseSensitive.value, wholeWord: wholeWord.value },
      currentLine: currentFindLine.value
    })
  } else {
    emit('find-highlight', null)
  }
}

/** 执行真正的 IPC 搜索（无防抖，供输入防抖与替换后即时刷新复用） */
async function executeSearch(): Promise<void> {
  const query = searchQuery.value.trim()
  if (!query || (searchScope.value === 'doc' && !props.activePath) || !props.vaultPath) {
    searchResults.value = []
    isSearching.value = false
    return
  }
  isSearching.value = true
  try {
    searchResults.value = await window.api.searchVault(
      props.vaultPath,
      query,
      { caseSensitive: caseSensitive.value, wholeWord: wholeWord.value },
      scopeFile()
    )
  } catch (e) {
    showToast(errMsg(e))
    searchResults.value = []
  } finally {
    isSearching.value = false
  }
}

/** 输入防抖搜索：连续输入不每次重扫整个库 */
function runSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  // 防抖：连续输入不每次重扫整个库
  searchTimer = setTimeout(() => void executeSearch(), 300)
}

/** 搜索输入 / 选项 / 范围 / 当前文档 任一变化 → 重跑搜索并同步源码高亮 */
watch(
  [searchQuery, caseSensitive, wholeWord, searchScope, () => props.activePath, () => props.vaultPath],
  () => {
    runSearch()
    syncFindHighlight()
  }
)

/* ── 替换（双范围共用一套：file 参数决定范围）── */
const showReplace = ref(false)
const replaceQuery = ref('')
const confirming = ref<number | null>(null)
const replacing = ref(false)

const totalHits = computed(() => searchResults.value.reduce((n, f) => n + f.hits.length, 0))

/** 点击「替换全部」：先确认（展示将影响的匹配数），避免误伤 */
function askReplace(): void {
  if (!replaceQuery.value || replacing.value) return
  confirming.value = totalHits.value
}

/** 确认执行：在搜索命中文件范围内做字面量替换（选项与搜索一致），写回磁盘；
    file 参数随范围走——本文档只改当前文档，全库改全部命中文件 */
async function doReplace(): Promise<void> {
  const n = confirming.value
  confirming.value = null
  if (n == null || !props.vaultPath || !replaceQuery.value) return
  replacing.value = true
  try {
    const res = await window.api.replaceInVault(
      props.vaultPath,
      searchQuery.value,
      replaceQuery.value,
      { caseSensitive: caseSensitive.value, wholeWord: wholeWord.value },
      scopeFile()
    )
    showToast(L.replaceDone.replace('{n}', String(res.replaced)).replace('{files}', String(res.files)))
    emit('replaced', res.paths)
    // 立即刷新结果（不走输入防抖），反映替换后状态
    await executeSearch()
    // 替换可能引发行号偏移 → 让 currentLine 跟随到替换后仍有效的命中，避免残留过期行号
    rederiveCurrentLine()
    replaceQuery.value = ''
    showReplace.value = false
  } catch {
    showToast(L.replaceFail)
  } finally {
    replacing.value = false
  }
}

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  isSearching.value = false
  showReplace.value = false
  replaceQuery.value = ''
  confirming.value = null
  currentFindLine.value = undefined
  syncFindHighlight()
}

/**
 * 替换后重新推导当前命中行：替换可能引发行号整体偏移，旧的 currentLine 已不可靠。
 * 优先取当前活动文档的首个命中行；否则取首个文件的首个命中行；都没有则清空。
 * 确保 currentLine 指向替换后仍有效的命中，高亮 current 标记不残留过期位置。
 */
function rederiveCurrentLine(): void {
  const path = props.activePath
  const fileRes = path ? searchResults.value.find((r) => r.path === path) : undefined
  const target = fileRes ?? searchResults.value[0]
  currentFindLine.value = target && target.hits.length ? target.hits[0].line : undefined
  syncFindHighlight()
}

function onOpenResult(path: string, line: number): void {
  // 双范围都记录当前结果行，供源码模式 + 所见即所得对称高亮强化该命中
  currentFindLine.value = line
  syncFindHighlight()
  emit('open-result', { path, line })
}

/** 聚焦搜索框（Ctrl+F 等快捷键调用）：有打开的文档则默认切到「本文档」范围，
    契合 Ctrl+F = 在当前文档查找的通用语义；否则落到「全部」 */
function focusSearch(): void {
  searchScope.value = props.activePath ? 'doc' : 'vault'
  void nextTick(() => searchInput.value?.focus())
}

/* ── 本文件内回车：有结果则跳到首个命中行 ── */
function onSearchEnter(): void {
  const first = searchResults.value[0]
  if (first?.hits.length) onOpenResult(first.path, first.hits[0].line)
}

const searchInput = ref<HTMLInputElement | null>(null)

defineExpose({ focusSearch })

const vaultName = computed(() => {
  if (!props.vaultPath) return null
  return props.vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? props.vaultPath
})

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 取一个节点的父目录绝对路径 */
function parentDir(p: string): string {
  const norm = p.replace(/[\\/]$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i < 0 ? p : norm.slice(0, i)
}

function expand(path: string): void {
  const next = new Set(expanded.value)
  next.add(path)
  expanded.value = next
}

function toggle(path: string): void {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

/** 找到目标文件并展开它上面的整条目录链 —— 恢复会话后要能直接看见当前文档 */
function expandAncestors(nodes: FileNode[], target: string, chain: string[] = []): boolean {
  for (const node of nodes) {
    if (node.path === target) {
      const next = new Set(expanded.value)
      chain.forEach((p) => next.add(p))
      expanded.value = next
      return true
    }
    if (
      node.type === 'dir' &&
      node.children &&
      expandAncestors(node.children, target, [...chain, node.path])
    ) {
      return true
    }
  }
  return false
}

watch(
  () => [props.activePath, props.nodes] as const,
  ([path, nodes]) => {
    if (path && nodes.length) expandAncestors(nodes, path)
  },
  { immediate: true }
)

// 换库时清空展开状态，避免残留上一个库的路径
watch(
  () => props.vaultPath,
  () => {
    expanded.value = new Set()
    searchQuery.value = ''
    searchResults.value = []
  }
)

/* ── 右键菜单 ── */

function onContextMenu(payload: { x: number; y: number; node: FileNode }): void {
  menu.value = payload
}

function buildMenuItems(node: FileNode): MenuItem[] {
  const items: MenuItem[] = [
    { action: 'new-file', label: '新建文件' },
    { action: 'new-folder', label: '新建文件夹' },
    { action: 'sep', label: '', separator: true },
    { action: 'rename', label: node.type === 'dir' ? '重命名' : '重命名' },
    { action: 'delete', label: '删除', danger: true }
  ]
  return items
}

function onMenuSelect(action: string): void {
  const node = menu.value?.node
  menu.value = null
  if (!node) return

  // 右键文件：新建项落在它的父目录；右键文件夹：新建项落在文件夹内部
  const parent = node.type === 'dir' ? node.path : parentDir(node.path)

  switch (action) {
    case 'new-file':
      void createNewFile(parent)
      break
    case 'new-folder':
      void createNewFolder(parent)
      break
    case 'rename':
      editingPath.value = node.path
      break
    case 'delete':
      confirmState.value = { open: true, node }
      break
  }
}

/* ── 新建 ── */

async function createNewFile(parent: string): Promise<void> {
  try {
    const path = await window.api.createDoc(parent)
    expand(parent)
    await props.refreshTree()
    editingPath.value = path
    await props.openDoc(path)
  } catch (e) {
    showToast(errMsg(e))
  }
}

async function createNewFolder(parent: string): Promise<void> {
  try {
    const path = await window.api.createFolder(parent)
    expand(parent)
    await props.refreshTree()
    editingPath.value = path
  } catch (e) {
    showToast(errMsg(e))
  }
}

/* ── 重命名 ── */

async function doRename(path: string, value: string): Promise<void> {
  const node = findNode(props.nodes, path)
  const wasActive = path === props.activePath
  let newPath = path
  try {
    newPath = await window.api.renameItem(path, value)
    // 重命名目录后，把展开状态迁移到新路径，避免折叠
    if (node?.type === 'dir' && expanded.value.has(path)) {
      const next = new Set(expanded.value)
      next.delete(path)
      next.add(newPath)
      expanded.value = next
    }
    if (wasActive) emit('renamed', path, newPath)
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    editingPath.value = null
    await props.refreshTree()
  }
}

function onRenameCancel(): void {
  editingPath.value = null
}

/* ── 删除 ── */

async function doDelete(): Promise<void> {
  const node = confirmState.value?.node
  if (!node) return
  try {
    await window.api.deleteItem(node.path)
    if (node.path === props.activePath) emit('deleted', node.path)
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    confirmState.value = null
    await props.refreshTree()
  }
}

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const hit = findNode(n.children, path)
      if (hit) return hit
    }
  }
  return null
}

/* ── 轻量错误提示 ── */

function showToast(msg: string): void {
  toast.value = { msg }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 3200)
}

/* ── 拖拽调宽 ── */

const dragging = ref(false)

function startDrag(e: PointerEvent): void {
  dragging.value = true

  const startX = e.clientX
  const startWidth = props.width

  const onMove = (ev: PointerEvent): void => {
    const next = Math.min(
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX)
    )
    emit('update:width', next)
  }

  const onUp = (): void => {
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <aside class="sidebar jade" :class="{ 'is-collapsed': !visible }" :style="{ width: `${(visible ?? true) ? width : 0}px` }">
    <header class="sidebar__head">
      <span class="sidebar__title" :title="vaultPath ?? ''">
        {{ vaultName ?? '未打开笔记库' }}
      </span>

      <div class="sidebar__acts">
        <button
          class="icon-btn"
          type="button"
          title="新建文档"
          aria-label="新建文档"
          @click="emit('new-doc')"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M7 3v8M3 7h8"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>

        <button
          class="icon-btn"
          type="button"
          title="打开笔记库"
          aria-label="打开笔记库"
          @click="emit('open-vault')"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M1.6 4a1 1 0 0 1 1-1h2.5l1.2 1.5h5.1a1 1 0 0 1 1 1v5.9a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </header>

    <div class="sidebar__body" @contextmenu.prevent>
      <!-- 搜索框（仅打开笔记库后可用） -->
      <div v-if="vaultPath" class="search">
        <Icon class="search__icon" name="search" :size="13" />
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="search__input"
          type="text"
          :placeholder="L.findPlaceholder"
          aria-label="搜索"
          @keydown.esc="clearSearch"
          @keydown.enter="onSearchEnter"
        />
        <button
          v-if="searchQuery"
          class="search__clear"
          type="button"
          title="清除"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          ×
        </button>
      </div>

      <!-- 范围切换：全部（文件夹内）/ 本文档 -->
      <div v-if="vaultPath" class="scope" role="tablist" aria-label="搜索范围">
        <button
          class="scope__opt"
          :class="{ on: searchScope === 'vault' }"
          role="tab"
          :aria-selected="searchScope === 'vault'"
          @click="searchScope = 'vault'"
        >
          <Icon name="search" :size="13" /> {{ L.scopeVault }}
        </button>
        <button
          class="scope__opt"
          :class="{ on: searchScope === 'doc' }"
          role="tab"
          :aria-selected="searchScope === 'doc'"
          :disabled="!activePath"
          :title="activePath ? '' : L.scopeDocHint"
          @click="searchScope = 'doc'"
        >
          <Icon name="file" :size="13" /> {{ L.scopeDoc }}
        </button>
      </div>

      <!-- 选项行：区分大小写 / 全词匹配（双范围共用） -->
      <div v-if="vaultPath && searchQuery.trim()" class="opts">
        <button
          class="chip"
          type="button"
          :class="{ on: caseSensitive }"
          :title="L.caseSensitive"
          :aria-pressed="caseSensitive"
          @click="caseSensitive = !caseSensitive"
        >
          <span class="chip__aa">Aa</span>
        </button>
        <button
          class="chip"
          type="button"
          :class="{ on: wholeWord }"
          :title="L.wholeWord"
          :aria-pressed="wholeWord"
          @click="wholeWord = !wholeWord"
        >
          <span class="chip__ww">⌗</span>
        </button>
      </div>

      <!-- 替换区：双范围共用一套（file 参数决定范围） -->
      <template v-if="vaultPath && searchQuery.trim() && !(searchScope === 'doc' && !activePath)">
        <div class="repl">
          <button
            class="repl__toggle"
            type="button"
            :class="{ 'repl__toggle--on': showReplace }"
            :disabled="!searchResults.length"
            @click="showReplace = !showReplace"
          >
            {{ L.replace }}
          </button>
          <div v-if="showReplace" class="repl__panel">
            <input
              v-model="replaceQuery"
              class="repl__input"
              type="text"
              :placeholder="L.replacePlaceholder"
              :disabled="replacing"
              @keydown.enter="askReplace"
            />
            <button
              class="repl__go"
              type="button"
              :disabled="replacing || !replaceQuery"
              @click="askReplace"
            >
              {{ replacing ? '…' : L.replaceAll }}
            </button>
          </div>
          <div v-if="confirming !== null" class="repl__confirm">
            <span class="repl__confirm-text">{{ L.replaceConfirm.replace('{n}', String(confirming)) }}</span>
            <button type="button" class="repl__ok" :disabled="replacing" @click="doReplace">确认</button>
            <button type="button" class="repl__cancel" :disabled="replacing" @click="confirming = null">
              取消
            </button>
          </div>
        </div>
      </template>

      <!-- 结果区：双范围统一渲染（本文档范围隐藏文件名分组头） -->
      <template v-if="searchQuery.trim()">
        <div v-if="searchScope === 'doc' && !activePath" class="hint">{{ L.scopeDocHint }}</div>
        <template v-else>
          <div v-if="isSearching" class="searching">{{ L.searching }}</div>
          <SearchResults
            v-else-if="searchResults.length"
            :results="searchResults"
            :query="searchQuery"
            :case-sensitive="caseSensitive"
            :active-path="activePath"
            :single-file="searchScope === 'doc'"
            @open="onOpenResult"
          />
          <p v-else class="empty">{{ L.noResult.replace('{q}', searchQuery.trim()) }}</p>
        </template>
      </template>

      <!-- 普通文件树态 -->
      <template v-else>
        <!-- 未打开笔记库：居中优雅空状态 -->
        <div v-if="!vaultPath" class="empty-state">
          <div class="empty-state__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 7a2 2 0 0 1 2-2h3.6l1.8 2.2h7.6a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <p class="empty-state__title">{{ L.noVaultTitle }}</p>
          <p class="empty-state__hint">{{ L.noVaultHint }}</p>
          <button class="empty-state__btn" type="button" @click="emit('open-vault')">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M1.6 4a1 1 0 0 1 1-1h2.5l1.2 1.5h5.1a1 1 0 0 1 1 1v5.9a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1z"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linejoin="round"
              />
            </svg>
            {{ L.chooseFolder }}
          </button>
        </div>

        <!-- 已开库但无文档 -->
        <div v-else-if="nodes.length === 0" class="empty-state">
          <div class="empty-state__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
              <path d="M13 3v5h5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
            </svg>
          </div>
          <p class="empty-state__title">{{ L.emptyFolderTitle }}</p>
          <p class="empty-state__hint">{{ L.emptyFolderHint }}</p>
        </div>

        <FileTree
          v-else
          :nodes="nodes"
          :active-path="activePath"
          :expanded="expanded"
          :editing-path="editingPath"
          @select="emit('select', $event)"
          @toggle="toggle"
          @context-menu="onContextMenu"
          @rename-confirm="(p, v) => void doRename(p, v)"
          @rename-cancel="onRenameCancel"
        />
      </template>
    </div>

    <div
      v-show="visible"
      class="sidebar__resizer"
      :class="{ 'sidebar__resizer--active': dragging }"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startDrag"
    />

    <!-- 右键上下文菜单 -->
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="buildMenuItems(menu.node)"
      @select="onMenuSelect"
      @close="menu = null"
    />

    <!-- 删除二次确认 -->
    <ConfirmDialog
      v-if="confirmState"
      :open="confirmState.open"
      title="删除确认"
      :message="`确定要删除「${confirmState.node.name}」吗？此操作不可撤销。`"
      confirm-label="删除"
      danger
      @confirm="void doDelete()"
      @cancel="confirmState = null"
    />

    <!-- 操作失败提示 -->
    <div v-if="toast" class="toast glass" role="alert">{{ toast.msg }}</div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--hue-border-subtle);
  /* 收起/展开用宽度过渡，与整体动效一致 */
  transition:
    width var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease),
    border-color var(--dur-base) var(--ease);
}

/* 收起态：宽度归零、去右边框、淡出，内容不可交互 */
.sidebar.is-collapsed {
  width: 0 !important;
  opacity: 0;
  border-right-color: transparent;
  pointer-events: none;
  overflow: hidden;
}

.sidebar__head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  height: var(--h-crumb);
  padding: 0 6px 0 12px;
}

.sidebar__title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  color: var(--hue-text-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sidebar__acts {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

.sidebar__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  padding: 2px 6px 10px;
  overflow-y: auto;
}

/* 优雅空状态：居中、图标徽章 + 标题 + 提示 + 强调色按钮 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 24px 20px;
  text-align: center;
}

.empty-state__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 6px;
  border-radius: var(--radius-lg);
  background: var(--hue-active);
  color: var(--hue-accent);
  box-shadow: inset 0 1px 0 var(--hue-highlight);
}

.empty-state__title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--hue-text-2);
}

.empty-state__hint {
  margin: 0;
  max-width: 168px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--hue-text-3);
}

.empty-state__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--hue-shadow-1);
  transition:
    transform var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease),
    filter var(--dur-fast) var(--ease);
}

.empty-state__btn:hover {
  filter: brightness(1.06);
  box-shadow: var(--hue-shadow-2);
  transform: translateY(-1px);
}

.empty-state__btn:active {
  transform: translateY(0);
  filter: brightness(0.98);
}

.empty-state__btn:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: 2px;
}

.sidebar__resizer {
  position: absolute;
  top: 0;
  right: -2px;
  bottom: 0;
  z-index: 2;
  width: 4px;
  cursor: col-resize;
}

.sidebar__resizer:hover,
.sidebar__resizer--active {
  background: var(--hue-accent);
  opacity: 0.5;
}

/* 全文搜索框：玉质输入框 */
.search {
  position: sticky;
  top: -2px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 8px;
  padding: 0 8px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--bg-input, var(--bg-hover));
  border: 1px solid var(--hue-border-subtle);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: var(--hue-text-3);
}

.search__icon {
  flex-shrink: 0;
}

.search__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--hue-text-1);
}

.search__input::placeholder {
  color: var(--hue-text-3);
}

.search__clear {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--hue-text-3);
  font-size: 15px;
  line-height: 1;
  padding: 0 2px 2px;
  border-radius: var(--radius-sm);
}

.search__clear:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

/* 全局替换：与搜索框同源玉质风格，作为搜索框下方的次级操作区 */
.repl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 8px;
  padding: 0 2px;
}

.repl__toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.repl__toggle:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.repl__toggle--on {
  color: var(--hue-accent);
  border-color: var(--hue-accent);
  background: var(--hue-active);
}

.repl__panel {
  display: flex;
  gap: 6px;
}

.repl__input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.repl__input:focus {
  border-color: var(--hue-accent);
}

.repl__go {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.repl__go:disabled {
  opacity: 0.5;
  cursor: default;
}

.repl__confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: var(--hue-surmount, rgba(var(--hue-tint-2, 120, 180, 170), 0.12));
  border: 1px solid var(--hue-border-subtle);
}

.repl__confirm-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--hue-text-2);
}

.repl__ok,
.repl__cancel {
  flex-shrink: 0;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.repl__ok {
  color: #fff;
  background: var(--hue-accent);
  border-color: var(--hue-accent);
}

.repl__cancel:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.searching {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--hue-text-3);
}

/* 无结果 / 状态提示 */
.empty {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--hue-text-3);
}

.hint {
  padding: 8px;
  font-size: 11.5px;
  color: var(--hue-text-3);
}

/* 范围分段控件：玉质胶囊，两选项平分 */
.scope {
  display: flex;
  gap: 3px;
  margin: 0 0 8px;
  padding: 3px;
  border-radius: var(--radius-md);
  background: var(--hue-highlight, var(--bg-input));
  border: 1px solid var(--hue-border-subtle);
}

.scope__opt {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  padding: 5px 4px;
  color: var(--hue-text-3);
  border-radius: calc(var(--radius-md) - 3px);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.scope__opt:hover:not(:disabled) {
  color: var(--hue-text-1);
}

.scope__opt.on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-weight: 500;
}

.scope__opt:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 选项行：大小写 / 全词 芯片 + 命中导航 */
.opts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  padding: 0 2px;
}

.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.chip:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.chip.on {
  color: var(--hue-accent);
  border-color: var(--hue-accent);
  background: var(--hue-active);
}

.chip__aa {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.chip__ww {
  font-size: 13px;
  line-height: 1;
}

/* 操作失败提示：固定在侧栏底部，自动消失 */
.toast {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  z-index: 70;
  padding: 9px 11px;
  border-radius: var(--radius-md);
  font-size: 12px;
  line-height: 1.5;
  color: var(--hue-text-1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 12px 32px rgba(0, 0, 0, 0.34);
  animation: toast-in var(--dur-base) var(--ease);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
