<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  type FileNode
} from '../../electron/shared/ipc-channels'
import FileTree from './FileTree.vue'

const props = defineProps<{
  vaultPath: string | null
  nodes: FileNode[]
  activePath: string | null
  width: number
}>()

const emit = defineEmits<{
  (e: 'select', node: FileNode): void
  (e: 'open-vault'): void
  (e: 'new-doc'): void
  (e: 'update:width', width: number): void
}>()

/** 目录默认折叠，展开状态提升到此处，方便会话恢复时自动展开祖先链 */
const expanded = ref<Set<string>>(new Set())

const vaultName = computed(() => {
  if (!props.vaultPath) return null
  return props.vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? props.vaultPath
})

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
  }
)

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

    <div class="sidebar__body">
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
        @select="emit('select', $event)"
        @toggle="toggle"
      />
    </div>

    <div
      class="sidebar__resizer"
      :class="{ 'sidebar__resizer--active': dragging }"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startDrag"
    />
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
</style>
