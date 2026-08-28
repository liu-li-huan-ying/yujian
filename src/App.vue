<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import EditorHost from './editor/EditorHost.vue'
import type { EditorMode } from './editor/EditorHost.vue'
import type { FileNode, VaultChange } from '../electron/shared/ipc-channels'

const filePath = ref<string | null>(null)
const requestedMode = ref<EditorMode>('wysiwyg')
const host = ref<InstanceType<typeof EditorHost> | null>(null)
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

const modeLabel = computed(() => (requestedMode.value === 'wysiwyg' ? '渲染模式' : '源码'))

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
  if (picked) await useVault(picked)
}

/** 打开指定文档。切换前先把脏数据落盘，绝不丢编辑 */
async function openPath(path: string): Promise<void> {
  if (path === filePath.value) return
  if (host.value?.dirty) await host.value.save()

  filePath.value = path
  lastSavedAt.value = Date.now()
  void window.api.patchSession({ activePath: path })

  if (host.value?.ready) await host.value.load(path)
  else pendingPath.value = path
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

function onSelect(node: FileNode): void {
  void openPath(node.path)
}

async function newDoc(): Promise<void> {
  if (!vaultPath.value) return void (await openVault())
  const created = await window.api.createDoc(vaultPath.value)
  await refreshTree()
  await openPath(created)
}

/** 文件树里重命名了当前正在编辑的文档 → 同步活动路径，避免继续往旧路径保存 */
function onRenamed(oldPath: string, newPath: string): void {
  if (oldPath === filePath.value) {
    filePath.value = newPath
    void window.api.patchSession({ activePath: newPath })
  }
}

/** 文件树里删除了当前正在编辑的文档 → 清空活动路径 */
function onDeleted(path: string): void {
  if (path === filePath.value) {
    filePath.value = null
    void window.api.patchSession({ activePath: null })
  }
}

/* ── 外部改动同步 ── */

let treeTimer: ReturnType<typeof setTimeout> | null = null

function onVaultChange(change: VaultChange): void {
  // 内容变化不改变树结构，忽略 —— 否则每次自动保存都会触发一次全量重扫
  if (change.kind === 'change') return

  // 当前文档被外部删除：清掉路径，避免继续往一个不存在的文件保存
  if (change.kind === 'unlink' && change.path === filePath.value) {
    filePath.value = null
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
  filePath.value = picked
  await host.value?.save()
  lastSavedAt.value = Date.now()
  void window.api.patchSession({ activePath: picked })
}

function onKeydown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 's') {
    e.preventDefault()
    void saveFile()
  } else if (k === 'o') {
    e.preventDefault()
    void openFile()
  } else if (e.key === '/') {
    e.preventDefault()
    requestedMode.value = requestedMode.value === 'wysiwyg' ? 'source' : 'wysiwyg'
  }
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
  window.api.onVaultChange(onVaultChange)
  window.addEventListener('keydown', onKeydown)

  const session = await window.api.getSession()
  sidebarWidth.value = session.sidebarWidth
  requestedMode.value = session.mode

  if (session.vaultPath) await useVault(session.vaultPath)
  if (session.activePath) await openPath(session.activePath)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (treeTimer) clearTimeout(treeTimer)
  if (widthTimer) clearTimeout(widthTimer)
  void window.api.unwatchVault()
})
</script>

<template>
  <div class="shell">
    <TitleBar
      :file-name="fileName"
      :mode="requestedMode"
      :dirty="host?.dirty ?? false"
      @open="openFile"
      @save="saveFile"
      @update:mode="requestedMode = $event"
    />

    <div class="body">
      <Sidebar
        :vault-path="vaultPath"
        :nodes="tree"
        :active-path="filePath"
        :width="sidebarWidth"
        :refresh-tree="refreshTree"
        :open-doc="openPath"
        @select="onSelect"
        @open-vault="openVault"
        @new-doc="newDoc"
        @update:width="sidebarWidth = $event"
        @renamed="onRenamed"
        @deleted="onDeleted"
      />

      <main class="editor">
        <EditorHost
          ref="host"
          :file-path="filePath"
          :requested-mode="requestedMode"
          @saved="lastSavedAt = Date.now()"
        />
      </main>
    </div>

    <footer class="statusbar jade">
      <div class="statusbar__inner">
        <div class="statusbar__grp">
          <span>{{ filePath ?? '未选择文件' }}</span>
        </div>
        <div class="statusbar__grp">
          <span v-if="host?.willNormalize" class="warn">保存时将规范化排版</span>
          <span>
            <i class="dot" :class="host?.dirty ? 'dot--dirty' : 'dot--saved'" />
            {{ host?.dirty ? '未保存' : '已保存' }}
          </span>
          <span>{{ modeLabel }}</span>
        </div>
      </div>
    </footer>
  </div>
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
</style>
