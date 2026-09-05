<script setup lang="ts">
/**
 * 标签面板（Phase 3 批次三：#标签 内联语法 + frontmatter tags 双轨聚合）。
 *
 * 与反链面板同源的玻璃浮层模式：标题栏「更多」→ 打开本面板（App 级 v-if 浮层）。
 *
 * 两视图：
 *  - browse：标签树（按 / 嵌套，可展开/折叠、可过滤），点击标签名进入该标签的笔记视图；
 *  - notes：面包屑（全部标签 / 父 / 子）+ 该标签（含全部子标签）旗下的笔记列表，点击打开。
 *
 * 设计令牌（见 docs/PHASE3-UI-DESIGN.md §4.2）：
 *  - 标签项 28px 高；# 用 --hue-text-3、标签名用 --hue-text-1；
 *  - 嵌套缩进每级 14px；选中态 --hue-active 底 + 左侧 2px accent 竖条；
 *  - 计数徽标 min-width:20px 钉死居中（位数变化不抖动）；
 *  - role=tree / treeitem + aria-expanded，键盘可达。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import TagChip from './TagChip.vue'
import { useI18n } from '../i18n'
import type { TagItem, TagNoteItem } from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  vaultPath: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open', payload: { path: string; line: number }): void
  /** 索引重建完成（App 据此弹 toast） */
  (e: 'rebuilt'): void
}>()

interface TagNode extends TagItem {
  children: TagNode[]
  leaf: boolean
}

const all = ref<TagItem[]>([])
const loading = ref(false)
const rebuilding = ref(false)
const error = ref<string | null>(null)
const filterQuery = ref('')
const expanded = ref<Set<string>>(new Set())
const selectedTag = ref<string | null>(null)
const notes = ref<TagNoteItem[]>([])
const notesLoading = ref(false)

const totalCount = computed(() => all.value.length)

/** 构建嵌套树（按 name 的 / 切分派生子节点），并标记叶子 */
const rootNodes = computed<TagNode[]>(() => {
  const byName = new Map<string, TagNode>()
  for (const it of all.value) {
    byName.set(it.name, { ...it, children: [], leaf: true })
  }
  const roots: TagNode[] = []
  for (const node of byName.values()) {
    if (node.parent && byName.has(node.parent)) {
      const parent = byName.get(node.parent)!
      parent.children.push(node)
      parent.leaf = false
    } else {
      roots.push(node)
    }
  }
  return roots
})

/** 过滤：保留名字命中 query 的节点及其祖先链（让命中项始终可见）；空 query 返回全部 */
function visibleRoots(): TagNode[] {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return rootNodes.value
  const keep = new Set<string>()
  for (const it of all.value) {
    if (it.name.toLowerCase().includes(q)) {
      const parts = it.name.split('/')
      let acc = ''
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p
        keep.add(acc)
      }
    }
  }
  const filterTree = (nodes: TagNode[]): TagNode[] =>
    nodes
      .filter((n) => keep.has(n.name))
      .map((n) => ({ ...n, children: filterTree(n.children) }))
  return filterTree(rootNodes.value)
}

/** 展平为带 depth 的线性列表（依据展开状态），模板据此按 depth 缩进渲染，支持任意嵌套深度 */
const flatTree = computed<{ node: TagNode; depth: number }[]>(() => {
  const out: { node: TagNode; depth: number }[] = []
  const walk = (nodes: TagNode[], depth: number): void => {
    for (const n of nodes) {
      out.push({ node: n, depth })
      if (!n.leaf && expanded.value.has(n.name)) walk(n.children, depth + 1)
    }
  }
  walk(visibleRoots(), 0)
  return out
})

/** 面包屑：进入 notes 视图后展示「全部标签 / 父 / ... / 当前」 */
const breadcrumb = computed<string[]>(() =>
  selectedTag.value ? selectedTag.value.split('/') : []
)

function isExpanded(name: string): boolean {
  return expanded.value.has(name)
}
function toggleExpand(name: string): void {
  const set = new Set(expanded.value)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  expanded.value = set
}

async function loadTags(): Promise<void> {
  if (!props.vaultPath) return
  loading.value = true
  error.value = null
  try {
    all.value = await window.api.listTags(props.vaultPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function openTag(tag: string): Promise<void> {
  if (!props.vaultPath) return
  selectedTag.value = tag
  notesLoading.value = true
  notes.value = []
  try {
    notes.value = await window.api.getNotesByTag(props.vaultPath, tag)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    notesLoading.value = false
  }
}

/** 面包屑点击：idx=0 回到全部标签；其余钻到对应层级的父标签 */
function onBreadcrumb(idx: number): void {
  if (idx === 0) {
    selectedTag.value = null
    return
  }
  void openTag(breadcrumb.value.slice(0, idx).join('/'))
}

function openNote(n: TagNoteItem): void {
  emit('open', { path: n.path, line: 1 })
}

function fileDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

/** 重建统一索引（兜底陈旧缓存），完成后自刷新并通知 App 弹 toast */
async function onRebuild(): Promise<void> {
  if (!props.vaultPath || rebuilding.value) return
  rebuilding.value = true
  try {
    await window.api.rebuildIndex(props.vaultPath)
    await loadTags()
    emit('rebuilt')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    rebuilding.value = false
  }
}

// 实时刷新：库内任意改动（正文加 #标签）都让标签树重算，避免「明明加了标签但面板没动」。
let changeTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeVaultChange: (() => void) | null = null
function onVaultChange(): void {
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void loadTags(), 250)
}

onMounted(() => {
  void loadTags()
  window.addEventListener('keydown', onKey)
  unsubscribeVaultChange = window.api.onVaultChange(onVaultChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  unsubscribeVaultChange?.()
  if (changeTimer) clearTimeout(changeTimer)
})
</script>

<template>
  <div class="tags glass" role="dialog" :aria-label="L.tagsTitle">
    <div class="tags__head">
      <Icon name="tag" :size="15" class="tags__icon" />
      <span class="tags__title">{{ L.tagsTitle }}</span>
      <span v-if="totalCount > 0" class="tags__count">{{ totalCount }}</span>
      <button class="tags__x" type="button" :title="L.tagsClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <div class="tags__filter">
      <Icon name="search" :size="13" class="tags__filter-ico" />
      <input
        v-model="filterQuery"
        class="tags__filter-input"
        type="text"
        :placeholder="L.tagsFilterPlaceholder"
      />
    </div>

    <!-- browse 视图：标签树 -->
    <div v-if="!selectedTag" class="tags__body">
      <p v-if="loading" class="tags__empty">
        <Icon name="loader" :size="16" class="tags__spin" /> {{ L.tagsLoading }}
      </p>
      <p v-else-if="error" class="tags__empty tags__empty--err">
        <Icon name="alert" :size="16" /> {{ error }}
      </p>
      <p v-else-if="flatTree.length === 0" class="tags__empty">
        <Icon name="tag" :size="16" /> {{ L.tagsEmpty }}
      </p>
      <ul v-else class="tags__tree" role="tree" :aria-label="L.tagsTitle">
        <li
          v-for="item in flatTree"
          :key="item.node.name"
          role="treeitem"
          :aria-expanded="item.node.leaf ? undefined : isExpanded(item.node.name)"
          class="tags__li"
          :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
        >
          <div class="tags__row" @click="openTag(item.node.name)">
            <button
              v-if="!item.node.leaf"
              type="button"
              class="tags__twist"
              :class="{ 'tags__twist--open': isExpanded(item.node.name) }"
              :aria-label="isExpanded(item.node.name) ? L.ariaCollapse : L.ariaExpand"
              @click.stop="toggleExpand(item.node.name)"
            >
              <Icon name="chevron-right" :size="13" />
            </button>
            <span v-else class="tags__twist tags__twist--spacer" aria-hidden="true" />
            <TagChip class="tags__chip" :name="item.node.name" />
            <span class="tags__badge">{{ item.node.count }}</span>
          </div>
        </li>
      </ul>
      <p v-if="!loading && !error && flatTree.length" class="tags__hint">{{ L.tagsHint }}</p>
    </div>

    <!-- notes 视图：面包屑 + 该标签旗下笔记 -->
    <div v-else class="tags__body">
      <nav class="tags__crumb" :aria-label="L.ariaBreadcrumb">
        <button type="button" class="tags__crumb-item" @click="onBreadcrumb(0)">
          {{ L.tagsAll }}
        </button>
        <template v-for="(seg, i) in breadcrumb" :key="i">
          <Icon name="chevron-right" :size="12" class="tags__crumb-sep" />
          <button
            type="button"
            class="tags__crumb-item"
            :class="{ 'tags__crumb-item--cur': i === breadcrumb.length - 1 }"
            @click="onBreadcrumb(i + 1)"
          >
            {{ seg }}
          </button>
        </template>
      </nav>

      <p v-if="notesLoading" class="tags__empty">
        <Icon name="loader" :size="16" class="tags__spin" /> {{ L.tagsNotesLoading }}
      </p>
      <p v-else-if="error" class="tags__empty tags__empty--err">
        <Icon name="alert" :size="16" /> {{ error }}
      </p>
      <p v-else-if="notes.length === 0" class="tags__empty">
        <Icon name="file" :size="16" /> {{ L.tagsNotesEmpty }}
      </p>
      <ul v-else class="tags__notes">
        <li v-for="n in notes" :key="n.path" class="row">
          <button type="button" class="row__main" :title="`${n.base}\n${fileDir(n.path)}`" @click="openNote(n)">
            <span class="row__top">
              <span class="row__file">{{ n.title || n.base }}</span>
            </span>
            <span class="row__dir">{{ fileDir(n.path) }}</span>
          </button>
        </li>
      </ul>
      <div class="tags__foot">
        <button
          class="tags__rebuild"
          type="button"
          :disabled="rebuilding || !props.vaultPath"
          :title="L.tagsRebuild"
          @click="onRebuild"
        >
          <Icon name="loader" :size="13" :class="{ 'tags__spin': rebuilding }" />
          <span>{{ rebuilding ? L.tagsRebuilding : L.tagsRebuild }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 库级面板：锚编辑区左上，紧邻左缘活动栏的触发按钮与其同组的文件树，
   避免「点最左、弹最右」。文档级面板（反链 / 快照）仍锚右上，贴近大纲。 */
.tags {
  position: absolute;
  top: 10px;
  left: 16px;
  z-index: 30;
  width: 320px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: tags-in 0.18s var(--ease, ease) both;
}
@keyframes tags-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tags__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tags__icon {
  color: var(--hue-accent);
}
.tags__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.tags__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-on-accent);
  background: var(--hue-accent);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 18px;
  text-align: center;
}
.tags__x {
  margin-left: auto;
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
  transition: background var(--dur-fast) var(--ease);
}
.tags__x:hover {
  background: var(--hue-active);
  color: var(--hue-text-1);
}

/* 过滤框 28px */
.tags__filter {
  position: relative;
  display: flex;
  align-items: center;
}
.tags__filter-ico {
  position: absolute;
  left: 8px;
  color: var(--hue-text-3);
  pointer-events: none;
}
.tags__filter-input {
  width: 100%;
  height: 28px;
  padding: 0 8px 0 28px;
  font-size: 13px;
  color: var(--hue-text-1);
  background: var(--hue-input-bg, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease);
}
.tags__filter-input:focus {
  border-color: var(--hue-accent);
}
.tags__filter-input::placeholder {
  color: var(--hue-text-3);
}

.tags__body {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}

.tags__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 4px;
  font-size: 12.5px;
  color: var(--hue-text-3);
  text-align: center;
}
.tags__empty--err {
  color: var(--hue-mark, #d97757);
}

.tags__tree,
.tags__notes {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tags__li {
  list-style: none;
}

/* 标签行 28px */
.tags__row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding-right: 8px;
  border-radius: var(--radius-sm);
  border-left: 2px solid transparent;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.tags__row:hover {
  background: var(--hue-active);
}
/* 计数徽标：min-width 钉死居中，位数变化不抖动（动态布局铁律 #2）；
   左侧 auto 把徽标推到右缘，使所有行计数对齐、长标签名在芯片内截断 */
.tags__badge {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-text-3);
  background: var(--hue-active);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 20px;
  text-align: center;
}

/* 展开箭头 */
.tags__twist {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.tags__twist--open {
  transform: rotate(90deg);
}
.tags__twist:hover {
  background: var(--hue-active);
}
.tags__twist--spacer {
  cursor: default;
}

.tags__hint {
  margin: 8px 2px 0;
  font-size: 11.5px;
  color: var(--hue-text-3);
  line-height: 1.5;
}

/* 面包屑 */
.tags__crumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  font-size: 12px;
  color: var(--hue-text-3);
}
.tags__crumb-item {
  border: 0;
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.tags__crumb-item:hover {
  color: var(--hue-text-1);
  background: var(--hue-active);
}
.tags__crumb-item--cur {
  color: var(--hue-text-1);
  font-weight: 600;
  cursor: default;
}
.tags__crumb-sep {
  color: var(--hue-text-3);
  flex-shrink: 0;
}

/* 笔记条目：与反链面板 .row 同观感（BacklinksPanel 的 .row 是 scoped，此处独立定义，避免跨组件失效） */
.tags__notes {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-fast, 0.12s) var(--ease, ease),
    border-color var(--dur-fast, 0.12s) var(--ease, ease);
}
.row:hover {
  background: var(--hue-surface-2);
  border-color: var(--hue-accent);
}
.row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.row__top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.row__file {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__dir {
  font-size: 11px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags__spin {
  animation: tags-spin 0.9s linear infinite;
}
@keyframes tags-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 底部重建索引导航 */
.tags__foot {
  display: flex;
  padding-top: 8px;
  border-top: 1px solid var(--hue-border-subtle);
}
.tags__rebuild {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.tags__rebuild:hover:not(:disabled) {
  background: var(--hue-active);
  color: var(--hue-text-1);
  border-color: var(--hue-accent);
}
.tags__rebuild:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
