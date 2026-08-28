<script setup lang="ts">
import { computed } from 'vue'
import type { FileNode } from '../../electron/shared/ipc-channels'
import RenameInput from './RenameInput.vue'

const props = defineProps<{
  nodes: FileNode[]
  activePath: string | null
  /** 已展开的目录绝对路径集合（由 Sidebar 持有，便于会话恢复时展开祖先链） */
  expanded: Set<string>
  /** 正在内联重命名的节点路径（null 表示无）；由 Sidebar 持有 */
  editingPath: string | null
  depth?: number
}>()

const emit = defineEmits<{
  (e: 'select', node: FileNode): void
  (e: 'toggle', path: string): void
  (e: 'context-menu', payload: { x: number; y: number; node: FileNode }): void
  (e: 'rename-confirm', path: string, value: string): void
  (e: 'rename-cancel'): void
}>()

const level = computed(() => props.depth ?? 0)

/** 文件不显示 md 扩展名，目录保持原样 */
function displayName(node: FileNode): string {
  if (node.type === 'dir') return node.name
  return node.name.replace(/\.(md|markdown)$/i, '')
}

function onContextMenu(node: FileNode, e: MouseEvent): void {
  emit('context-menu', { x: e.clientX, y: e.clientY, node })
}

function onRenameConfirm(node: FileNode, value: string): void {
  emit('rename-confirm', node.path, value)
}

function onRenameCancel(): void {
  emit('rename-cancel')
}

/** 递归子组件转发：直接 emit 会因 $event 只取首参而丢失第二个参数，故用显式函数 */
function fwdRenameConfirm(path: string, value: string): void {
  emit('rename-confirm', path, value)
}
</script>

<template>
  <ul class="tree">
    <li v-for="node in nodes" :key="node.path">
      <button
        class="row"
        :class="{
          'row--dir': node.type === 'dir',
          'row--active': node.type === 'file' && node.path === activePath
        }"
        :style="{ paddingLeft: `${8 + level * 14}px` }"
        :title="node.name"
        type="button"
        @click="node.type === 'dir' ? emit('toggle', node.path) : emit('select', node)"
        @contextmenu.prevent="onContextMenu(node, $event)"
      >
        <svg
          v-if="node.type === 'dir'"
          class="chev"
          :class="{ 'chev--open': expanded.has(node.path) }"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M3.5 2 L7 5 L3.5 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span v-else class="chev" aria-hidden="true" />

        <RenameInput
          v-if="props.editingPath === node.path"
          :initial="node.name"
          @confirm="(v: string) => onRenameConfirm(node, v)"
          @cancel="onRenameCancel"
        />
        <span v-else class="name">{{ displayName(node) }}</span>
      </button>

      <!-- 递归自身：Vue SFC 支持按文件名自引用 -->
      <FileTree
        v-if="node.type === 'dir' && expanded.has(node.path) && node.children?.length"
        :nodes="node.children"
        :active-path="activePath"
        :expanded="expanded"
        :editing-path="editingPath"
        :depth="level + 1"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
        @context-menu="emit('context-menu', $event)"
        @rename-confirm="fwdRenameConfirm"
        @rename-cancel="onRenameCancel"
      />
    </li>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: var(--h-row);
  padding-right: 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--hue-text-2);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.row:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.row--active {
  background: var(--hue-active);
  color: var(--hue-text-1);
}

.row:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

.chev {
  flex: 0 0 10px;
  color: var(--hue-text-3);
  transition: transform var(--dur-fast) var(--ease);
}

.chev--open {
  transform: rotate(90deg);
}

.name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
