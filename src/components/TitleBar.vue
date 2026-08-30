<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { EditorMode } from '../editor/EditorHost.vue'
import { i18n } from '../i18n'
import Icon from './Icon.vue'
import TitleMenu, { type MenuEntry } from './TitleMenu.vue'

const props = defineProps<{
  fileName: string
  mode: EditorMode
  dirty: boolean
  /** 是否已有打开的文档，决定是否允许导出 */
  canExport: boolean
  /** 左侧笔记库面板是否可见（控制开关按钮激活态） */
  sidebarVisible: boolean
  /** 右侧大纲面板是否可见（控制开关按钮激活态） */
  outlineVisible: boolean
  /** 快照面板是否打开（控制开关按钮激活态） */
  snapshotActive: boolean
  /** 凝神模式是否开启（控制开关按钮激活态） */
  focusActive: boolean
}>()

const emit = defineEmits<{
  (e: 'new-doc'): void
  (e: 'open'): void
  (e: 'switch-vault'): void
  (e: 'update:mode', value: EditorMode): void
  (e: 'export-html'): void
  (e: 'export-pdf'): void
  (e: 'appearance'): void
  (e: 'img-host'): void
  (e: 'preferences'): void
  (e: 'zen-settings'): void
  (e: 'link-check'): void
  (e: 'writing-aids'): void
  (e: 'save'): void
  (e: 'save-as'): void
  (e: 'help'): void
  (e: 'about'): void
  (e: 'toggle-sidebar'): void
  (e: 'toggle-outline'): void
  (e: 'find'): void
  (e: 'toggle-snapshot'): void
  (e: 'toggle-focus'): void
}>()

const L = i18n.ui
const maximized = ref(false)
const isMac = window.api.platform === 'darwin'

function sync(): void {
  void window.api.isMaximized().then((v) => (maximized.value = v))
}

const minimize = (): void => window.api.minimize()
const toggleMaximize = (): void => window.api.toggleMaximize()
const close = (): void => window.api.close()

/* ── 导出下拉 ── */
const exportItems = (): MenuEntry[] => [
  { action: 'export-html', label: L.exportMenuHtml, icon: 'file', disabled: !props.canExport },
  { action: 'export-pdf', label: L.exportMenuPdf, icon: 'file', disabled: !props.canExport }
]

function onExportSelect(action: string): void {
  if (action === 'export-html') emit('export-html')
  else if (action === 'export-pdf') emit('export-pdf')
}

/* ── 更多下拉（设置 / 文件）── */
const moreItems = (): MenuEntry[] => [
  { action: 'img-host', label: L.imgHost, icon: 'image' },
  { action: 'preferences', label: L.preferences, icon: 'sliders' },
  { action: 'zen-settings', label: L.zenSettings, icon: 'moon' },
  { action: 'link-check', label: L.linkCheck, icon: 'link' },
  { action: 'writing-aids', label: L.writingAids.title, icon: 'writing' },
  { separator: true },
  { action: 'save', label: L.save, icon: 'file', hint: 'Ctrl S' },
  { action: 'save-as', label: L.saveAs, icon: 'file' },
  { separator: true },
  { action: 'about', label: L.about, icon: 'book' }
]

function onMoreSelect(action: string): void {
  switch (action) {
    case 'img-host':
      emit('img-host')
      break
    case 'preferences':
      emit('preferences')
      break
    case 'zen-settings':
      emit('zen-settings')
      break
    case 'link-check':
      emit('link-check')
      break
    case 'writing-aids':
      emit('writing-aids')
      break
    case 'save':
      emit('save')
      break
    case 'save-as':
      emit('save-as')
      break
    case 'about':
      emit('about')
      break
  }
}

onMounted(() => {
  sync()
  window.api.onWindowStateChange((state) => (maximized.value = state.maximized))
})
</script>

<template>
  <header class="bar jade" :class="{ 'bar--mac': isMac }">
    <!-- 拖拽区：整条标题栏可拖动窗口 -->
    <div class="bar__drag">
      <span class="bar__name">{{ fileName }}</span>
      <span v-if="dirty" class="bar__dot" :title="L.statusUnsaved" />
    </div>

    <div class="bar__actions">
      <!-- 文件 / 库 -->
      <div class="grp">
        <button class="tbtn" type="button" :title="L.newDoc" @click="emit('new-doc')">
          <Icon name="plus" />
        </button>
        <button class="tbtn" type="button" :title="L.switchVault" @click="emit('switch-vault')">
          <Icon name="folder" />
        </button>
        <button class="tbtn" type="button" :title="L.open" @click="emit('open')">
          <Icon name="file" />
        </button>
      </div>

      <span class="sep" />

      <!-- 视图 / 布局 -->
      <div class="grp">
        <div class="seg">
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'wysiwyg' }"
            type="button"
            @click="emit('update:mode', 'wysiwyg')"
          >
            {{ L.modeWysiwyg }}
          </button>
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'source' }"
            type="button"
            @click="emit('update:mode', 'source')"
          >
            {{ L.modeSource }}
          </button>
        </div>
        <button
          class="tbtn"
          type="button"
          :class="{ 'tbtn--on': sidebarVisible }"
          :title="L.toggleSidebarTitle"
          @click="emit('toggle-sidebar')"
        >
          <Icon name="panel-left" />
        </button>
    <button
      class="tbtn"
      type="button"
      :class="{ 'tbtn--on': outlineVisible }"
      :title="L.toggleOutlineTitle"
      @click="emit('toggle-outline')"
    >
      <Icon name="panel-right" />
    </button>

    <button class="tbtn" type="button" :title="L.find" @click="emit('find')">
      <Icon name="search" />
    </button>

    <!-- 批次二：快照 / 凝神（融合打字机+禅的沉浸模式） -->
    <button
      class="tbtn"
      type="button"
      :class="{ 'tbtn--on': snapshotActive }"
      :title="L.snapshots"
      @click="emit('toggle-snapshot')"
    >
      <Icon name="history" />
    </button>
    <button
      class="tbtn"
      type="button"
      :class="{ 'tbtn--on': focusActive }"
      :title="L.focusTitle"
      @click="emit('toggle-focus')"
    >
      <Icon name="moon" />
    </button>
  </div>

      <span class="sep" />

      <!-- 分享 / 工具 -->
      <div class="grp">
        <TitleMenu :items="exportItems()" align="right" @select="onExportSelect">
          <template #default="{ open, toggle }">
            <button
              class="tbtn tbtn--menu"
              type="button"
              :class="{ 'tbtn--active': open }"
              :title="L.exportTitle"
              @click="toggle"
            >
              <Icon name="download" />
              <Icon name="chevron-down" :size="12" />
            </button>
          </template>
        </TitleMenu>

        <button class="tbtn" type="button" :title="L.appearance" @click="emit('appearance')">
          <Icon name="palette" />
        </button>

        <TitleMenu :items="moreItems()" align="right" @select="onMoreSelect">
          <template #default="{ open, toggle }">
            <button
              class="tbtn"
              type="button"
              :class="{ 'tbtn--active': open }"
              :title="L.more"
              @click="toggle"
            >
              <Icon name="more" />
            </button>
          </template>
        </TitleMenu>

        <button class="tbtn" type="button" :title="L.helpTitle" @click="emit('help')">
          <Icon name="help" />
        </button>
      </div>
    </div>

    <!-- macOS 用原生红绿灯，不渲染自绘按钮 -->
    <div v-if="!isMac" class="win">
      <button class="win__btn" type="button" title="最小化" @click="minimize()">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button
        class="win__btn"
        type="button"
        :title="maximized ? '向下还原' : '最大化'"
        @click="toggleMaximize()"
      >
        <svg v-if="maximized" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3.2 1.4h5.4v5.4" stroke="currentColor" stroke-width="1" />
          <rect x="1.4" y="3.2" width="5.4" height="5.4" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="1.4" y="1.4" width="7.2" height="7.2" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button class="win__btn win__btn--close" type="button" title="关闭" @click="close()">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.4 1.4l7.2 7.2M8.6 1.4l-7.2 7.2"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.bar {
  height: var(--h-titlebar);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--hue-border-subtle);
  user-select: none;
}

/* macOS 原生红绿灯在左上角，内容需让位 */
.bar--mac {
  padding-left: 78px;
}

/* 可拖拽区域：撑满剩余空间，把操作按钮挤到右侧 */
.bar__drag {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding-left: 14px;
  -webkit-app-region: drag;
}

.bar__name {
  font-size: 13px;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hue-accent);
  flex-shrink: 0;
}

.bar__actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
  -webkit-app-region: no-drag;
}

/* 功能分组：以更宽的间距 + 细分隔线表达「文件 / 视图 / 工具」三段语义 */
.grp {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--hue-border-subtle);
}

/* 图标按钮：28×28（≥28px 触控目标），默认低位文字色，悬停抬到一级并玉质高亮 */
.tbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.tbtn:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.tbtn:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

/* 面板开关激活态：accent 文字 + 玉质高亮底，呼应分段控件的「开」语义 */
.tbtn--on {
  color: var(--hue-accent);
  background: var(--hue-active);
}

.tbtn--on:hover {
  color: var(--hue-accent);
  background: var(--hue-active);
  filter: brightness(1.06);
}

/* 下拉触发按钮展开时：与菜单呼应，给一层克制高亮 */
.tbtn--active {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.tbtn--menu :deep(.icon:last-child) {
  color: var(--hue-text-3);
}

/* 模式分段控件 */
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--hue-highlight);
}

.seg__item {
  border: none;
  background: transparent;
  font-size: 11.5px;
  padding: 3px 10px;
  color: var(--hue-text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.seg__item:hover {
  color: var(--hue-text-1);
}

.seg__item--on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-weight: 500;
}

/* ── 自绘窗口控制按钮 ── */
.win {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.win__btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--hue-text-2);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.win__btn:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.win__btn--close:hover {
  background: #e04f45;
  color: #ffffff;
}

.win__btn:focus-visible {
  outline-offset: -2px;
}
</style>
