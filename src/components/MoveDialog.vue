<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FileNode } from '../../electron/shared/ipc-channels'
import { useI18n } from '../i18n'
import Icon from './Icon.vue'

const props = defineProps<{
  open: boolean
  /** 完整文件树（仅目录参与选择） */
  nodes: FileNode[]
  /** 笔记库根目录绝对路径（作为「库根目录」选项） */
  vaultPath: string | null
  /** 库名（「库根目录」选项的展示名） */
  rootName: string
  /** 正在移动的源节点路径（用于禁用自身 / 子孙 / 原父目录） */
  sourcePath: string | null
  /** 源节点名（标题展示） */
  sourceName: string
}>()

const emit = defineEmits<{
  (e: 'confirm', destDir: string): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const L = t.ui

const selected = ref<string | null>(null)

/** 打开时默认选中库根（最常用目标之一） */
watch(
  () => props.open,
  (open) => {
    if (open) selected.value = props.vaultPath
  },
)

interface FlatDir {
  path: string
  name: string
  depth: number
  disabled: boolean
}

const sepOf = (p: string): string => (p.includes('\\') ? '\\' : '/')

/** 把整棵目录树压平为带层级的目录列表，并标记不可选（自身 / 子孙 / 原父目录） */
const flatDirs = computed<FlatDir[]>(() => {
  const out: FlatDir[] = []
  if (props.vaultPath) {
    out.push({
      path: props.vaultPath,
      name: props.rootName || L.moveToRoot,
      depth: 0,
      disabled: false,
    })
  }
  const src = props.sourcePath?.replace(/[\\/]$/, '') ?? null
  const parent = src ? src.slice(0, Math.max(src.lastIndexOf('/'), src.lastIndexOf('\\'))) : null

  const walk = (nodes: FileNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.type !== 'dir') continue
      const norm = node.path.replace(/[\\/]$/, '')
      let disabled = false
      if (src) {
        if (norm === src)
          disabled = true // 自身
        else if (norm.startsWith(src + sepOf(src)))
          disabled = true // 子孙
        else if (parent && norm === parent) disabled = true // 原父目录 = 没移动
      }
      out.push({ path: node.path, name: node.name, depth, disabled })
      if (node.children?.length) walk(node.children, depth + 1)
    }
  }
  walk(props.nodes, 1)
  return out
})

function pick(path: string): void {
  const item = flatDirs.value.find((d) => d.path === path)
  if (!item || item.disabled) return
  selected.value = path
}

function confirm(): void {
  if (!selected.value) return
  emit('confirm', selected.value)
}
</script>

<template>
  <div v-if="open" class="move-mask" @click.self="emit('cancel')">
    <div class="move glass" role="dialog" aria-modal="true" :aria-label="L.moveTitle">
      <header class="move__head">
        <Icon name="folder" :size="14" />
        <span class="move__title">{{ L.moveTitle }}</span>
      </header>
      <p class="move__sub">{{ L.ctxMove }}：「{{ sourceName }}」</p>

      <div class="move__list" role="listbox">
        <button
          v-for="d in flatDirs"
          :key="d.path"
          type="button"
          class="move__item"
          :class="{
            'move__item--on': d.path === selected,
            'move__item--disabled': d.disabled,
          }"
          role="option"
          :aria-selected="d.path === selected"
          :disabled="d.disabled"
          :style="{ paddingLeft: `${10 + d.depth * 16}px` }"
          @click="pick(d.path)"
        >
          <Icon
            :name="d.path === vaultPath ? 'home' : d.path === selected ? 'folder-open' : 'folder'"
            :size="14"
            class="move__ico"
          />
          <span class="move__name">{{ d.name }}</span>
        </button>
      </div>

      <footer class="move__foot">
        <button type="button" class="btn-ghost" @click="emit('cancel')">{{ L.moveCancel }}</button>
        <button type="button" class="btn-accent" :disabled="!selected" @click="confirm">
          {{ L.moveConfirm }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.move-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(2px);
  animation: mask-in var(--dur-base) var(--ease);
}

.move {
  width: min(360px, calc(100vw - 40px));
  max-height: min(520px, calc(100vh - 60px));
  display: flex;
  flex-direction: column;
  padding: 14px;
  border-radius: var(--radius-lg);
  box-shadow:
    var(--hue-shadow-2),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.move__head {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--hue-text-1);
  font-size: 13.5px;
  font-weight: 600;
}

.move__title {
  letter-spacing: 0.02em;
}

.move__sub {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -4px;
  padding: 2px 4px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle, rgba(127, 127, 127, 0.05));
}

.move__item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.move__item:hover:not(.move__item--disabled) {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.move__item--on {
  background: var(--hue-active);
  color: var(--hue-accent);
  font-weight: 500;
}

.move__item--disabled {
  color: var(--hue-text-3);
  opacity: 0.5;
  cursor: default;
}

.move__ico {
  flex: 0 0 14px;
  color: inherit;
  opacity: 0.85;
}

.move__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.btn-ghost,
.btn-accent {
  height: 30px;
  padding: 0 16px;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  border: 1px solid var(--hue-border-subtle);
}

.btn-ghost {
  background: transparent;
  color: var(--hue-text-2);
}

.btn-ghost:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.btn-accent {
  border-color: var(--hue-accent);
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-weight: 500;
}

.btn-accent:disabled {
  opacity: 0.5;
  cursor: default;
}

@keyframes mask-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
