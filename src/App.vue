<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import EditorHost from './editor/EditorHost.vue'
import ImgHostSettings from './components/ImgHostSettings.vue'
import type { EditorMode } from './editor/EditorHost.vue'
import type { FileNode, VaultChange } from '../electron/shared/ipc-channels'
import { buildExportHtml } from './export/docTemplate'
import { useI18n, setLocale } from './i18n'
import type { LocaleKey } from './i18n'

const { t: L, getLocale } = useI18n()
const U = L.ui

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

/** 全文搜索结果点击：打开文档并定位到命中行（源码模式可精确定位） */
async function onOpenResult(payload: { path: string; line: number }): Promise<void> {
  await openPath(payload.path)
  // 渲染模式无法精确定位行，切换到源码模式以便跳转
  if (requestedMode.value !== 'source') {
    requestedMode.value = 'source'
    await nextTick()
  }
  host.value?.revealLine(payload.line)
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

/* ── 语言切换 ── */

const localeLabel = computed(() => (getLocale() === 'zh-CN' ? '中' : 'EN'))

async function toggleLocale(): Promise<void> {
  const next: LocaleKey = getLocale() === 'zh-CN' ? 'en-US' : 'zh-CN'
  setLocale(next)
  // Crepe 标签在构造时固化，重建实例使中文/英文双向切换生效（await 保证顺序）
  await host.value?.reload()
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
  if (toastTimer) clearTimeout(toastTimer)
  void window.api.unwatchVault()
})
</script>

<template>
  <div class="shell">
    <TitleBar
      :file-name="fileName"
      :mode="requestedMode"
      :dirty="host?.dirty ?? false"
      :can-export="!!filePath"
      @open="openFile"
      @save="saveFile"
      @update:mode="requestedMode = $event"
      @export-html="doExport('html')"
      @export-pdf="doExport('pdf')"
      @img-host="onImgHost"
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
        @open-result="onOpenResult"
      />

      <main class="editor">
        <EditorHost
          ref="host"
          :file-path="filePath"
          :vault-path="vaultPath"
          :requested-mode="requestedMode"
          @saved="lastSavedAt = Date.now()"
        />
      </main>
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
            <button class="lang-btn" @click="toggleLocale" title="切换语言 / Switch language">
              {{ localeLabel }}
            </button>
          </div>
        </div>
      </footer>
    </div>

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
