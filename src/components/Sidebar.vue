<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  type FileNode,
  type SearchFileResult
} from '../../electron/shared/ipc-channels'
import FileTree from './FileTree.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SearchResults from './SearchResults.vue'

const props = defineProps<{
  vaultPath: string | null
  nodes: FileNode[]
  activePath: string | null
  width: number
  /** 刷新文件树（App 持有真实实现，此处注入以便 await） */
  refreshTree: () => Promise<void>
  /** 在编辑器打开指定文档 */
  openDoc: (path: string) => Promise<void>
}>()

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

/* ── 全文搜索 ── */

const searchQuery = ref('')
const isSearching = ref(false)
const searchResults = ref<SearchFileResult[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(searchQuery, (q) => {
  const query = q.trim()
  if (!query) {
    searchResults.value = []
    isSearching.value = false
    return
  }
  isSearching.value = true
  if (searchTimer) clearTimeout(searchTimer)
  // 防抖：连续输入不每次重扫整个库
  searchTimer = setTimeout(async () => {
    if (!props.vaultPath) return
    try {
      searchResults.value = await window.api.searchVault(props.vaultPath, query)
    } catch (e) {
      showToast(errMsg(e))
      searchResults.value = []
    } finally {
      isSearching.value = false
    }
  }, 300)
})

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
}

function onOpenResult(path: string, line: number): void {
  emit('open-result', { path, line })
}

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
  <aside class="sidebar jade" :style="{ width: `${width}px` }">
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
      <!-- 全文搜索框（仅打开笔记库后可用） -->
      <div v-if="vaultPath" class="search">
        <svg class="search__icon" width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M9 9 L12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <input
          v-model="searchQuery"
          class="search__input"
          type="text"
          placeholder="搜索文档内容…"
          aria-label="全文搜索"
          @keydown.esc="clearSearch"
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

      <!-- 搜索态：结果列表 / 进行中 / 无结果 -->
      <template v-if="searchQuery.trim()">
        <div v-if="isSearching" class="searching">搜索中…</div>
        <SearchResults
          v-else-if="searchResults.length"
          :results="searchResults"
          :query="searchQuery"
          :active-path="activePath"
          @open="onOpenResult"
        />
        <p v-else class="empty">未找到「{{ searchQuery.trim() }}」相关内容</p>
      </template>

      <!-- 普通文件树态 -->
      <template v-else>
        <p v-if="!vaultPath" class="empty">
          还没有笔记库。<br />
          <button class="link" type="button" @click="emit('open-vault')">
            选择一个文件夹
          </button>
          即可开始写作。
        </p>

        <p v-else-if="nodes.length === 0" class="empty">
          这个文件夹里还没有 Markdown 文档。
        </p>

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

.empty {
  margin: 0;
  padding: 14px 8px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--hue-text-3);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--hue-accent);
  text-decoration: underline;
  cursor: pointer;
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

.searching {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--hue-text-3);
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
