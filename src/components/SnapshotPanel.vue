<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import { useSnapshotsStore } from '../store/snapshots'
import { diffLines } from 'diff'
import { useI18n } from '../i18n'
import { formatDateTime, localTimeZone } from '../utils/time'
import type { SnapshotInfo } from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

/*
 * 版本快照：主进程 .yujian-history/ 存储 + snapshot:list/create/restore(只读)/delete/setTags 通道、
 * 行级 diff 预览、回滚标脏不覆盖磁盘。
 * Phase A（git 化）：命名标签 tags[]、任意两点对比（A↔B）、标签筛选、内容哈希去重。
 */

const props = defineProps<{
  filePath: string | null
  vaultPath: string | null
  /** 当前文档文本（用于计算字数差与 diff 预览） */
  currentText: string
}>()

const emit = defineEmits<{
  (e: 'restore', id: string): void
  (e: 'delete', id: string): void
  (e: 'close'): void
}>()

const snapshots = useSnapshotsStore()

/* ── 备注输入（保存快照时带上）── */
const note = ref('')

async function onCreate(): Promise<void> {
  if (!props.filePath) return
  await snapshots.create(props.vaultPath, props.filePath, props.currentText, note.value.trim() || undefined)
  note.value = ''
}

/* ── 标签筛选 ── */
const filterTag = ref('')
const allTags = computed<string[]>(() => {
  const set = new Set<string>()
  for (const s of snapshots.list) for (const tg of s.tags || []) set.add(tg)
  return [...set]
})
const filteredList = computed(() =>
  filterTag.value ? snapshots.list.filter((s) => (s.tags || []).includes(filterTag.value)) : snapshots.list
)

/* ── 选中 → 读取快照内容 → diff 预览 ── */
const previewContent = ref<string | null>(null)
watch(
  () => snapshots.selectedId,
  async (id) => {
    previewContent.value = null
    if (!id) return
    previewContent.value = await snapshots.read(props.vaultPath, props.filePath, id)
  }
)

/* ── A / B 任意两点对比 ── */
const compareA = ref<string | null>(null)
const compareB = ref<string | null>(null)
const contentA = ref<string | null>(null)
const contentB = ref<string | null>(null)
function toggleA(id: string): void {
  compareA.value = compareA.value === id ? null : id
}
function toggleB(id: string): void {
  compareB.value = compareB.value === id ? null : id
}
watch(compareA, async (id) => {
  contentA.value = id ? await snapshots.read(props.vaultPath, props.filePath, id) : null
})
watch(compareB, async (id) => {
  contentB.value = id ? await snapshots.read(props.vaultPath, props.filePath, id) : null
})

const diffMode = computed<'ab' | 'selected' | 'none'>(() => {
  if (compareA.value && compareB.value && contentA.value != null && contentB.value != null) return 'ab'
  if (snapshots.selectedId && previewContent.value != null) return 'selected'
  return 'none'
})
const diffLabel = computed(() =>
  diffMode.value === 'ab' ? L.snapshotCompareAB : diffMode.value === 'selected' ? L.snapshotCompareWithSelected : ''
)

/** 把 diff 结果摊平成「逐行」列表，便于模板渲染 */
const diffRows = computed<{ type: 'add' | 'del' | 'ctx'; prefix: string; text: string }[]>(() => {
  let a: string | null = null
  let b: string | null = null
  if (diffMode.value === 'ab') {
    a = contentA.value
    b = contentB.value
  } else if (diffMode.value === 'selected') {
    a = props.currentText
    b = previewContent.value
  }
  if (a == null || b == null) return []
  const parts = diffLines(a, b)
  const out: { type: 'add' | 'del' | 'ctx'; prefix: string; text: string }[] = []
  for (const p of parts) {
    const body = p.value.endsWith('\n') ? p.value.slice(0, -1) : p.value
    const type: 'add' | 'del' | 'ctx' = p.added ? 'add' : p.removed ? 'del' : 'ctx'
    const prefix = p.added ? '+' : p.removed ? '-' : ' '
    for (const line of body.split('\n')) out.push({ type, prefix, text: line })
  }
  return out
})
const hasDiff = computed(() => diffRows.value.some((r) => r.type !== 'ctx'))

/* ── 字数差（快照相对当前文档）── */
function deltaChars(charCount: number): string {
  const d = charCount - props.currentText.length
  if (d === 0) return '±0'
  return d > 0 ? `+${d}` : `${d}`
}

/* ── 标签编辑 ── */
const editingTagsId = ref<string | null>(null)
const tagDraft = ref('')
function startEditTags(item: SnapshotInfo): void {
  editingTagsId.value = item.id
  tagDraft.value = ''
}
async function commitTag(item: SnapshotInfo): Promise<void> {
  const v = tagDraft.value.trim()
  if (!v) {
    editingTagsId.value = null
    return
  }
  const next = [...(item.tags || []), v]
  await snapshots.setTags(props.vaultPath, props.filePath, item.id, next)
  editingTagsId.value = null
  tagDraft.value = ''
}
async function removeTag(item: SnapshotInfo, tag: string): Promise<void> {
  const next = (item.tags || []).filter((x) => x !== tag)
  await snapshots.setTags(props.vaultPath, props.filePath, item.id, next)
}

/* ── 右键菜单 ── */
const menu = ref<{ x: number; y: number; id: string } | null>(null)
function onContext(e: MouseEvent, id: string): void {
  e.preventDefault()
  menu.value = { x: e.clientX, y: e.clientY, id }
}
const menuItems = (): MenuItem[] => [
  { action: 'restore', label: L.snapshotRestore },
  { action: 'delete', label: L.snapshotDelete, danger: true }
]
function onMenuSelect(action: string): void {
  const id = menu.value?.id
  menu.value = null
  if (!id) return
  if (action === 'restore') emit('restore', id)
  else if (action === 'delete') emit('delete', id)
}

const tz = localTimeZone()
function fmtTime(ts: number): string {
  return formatDateTime(ts)
}
</script>

<template>
  <div class="snap glass" role="dialog" aria-label="版本快照">
    <div class="snap__head">
      <span class="snap__title">{{ L.snapshots }}</span>
      <span class="snap__count">{{ L.snapshotCount.replace('{n}', String(snapshots.list.length)) }}</span>
      <button class="snap__x" type="button" :title="L.close" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <!-- 保存快照：备注 + 按钮 -->
    <div class="snap__save">
      <input
        v-model="note"
        class="snap__note"
        type="text"
        :placeholder="L.snapshotNotePlaceholder"
        @keydown.enter="onCreate"
      />
      <button class="snap__savebtn" type="button" :disabled="!filePath" @click="onCreate">
        <Icon name="plus" :size="13" />
        {{ L.snapshotSave }}
      </button>
    </div>

    <!-- 标签筛选 -->
    <div v-if="allTags.length" class="snap__filters">
      <button
        v-for="tg in allTags"
        :key="tg"
        type="button"
        class="ftag"
        :class="{ 'ftag--on': filterTag === tg }"
        @click="filterTag = filterTag === tg ? '' : tg"
      >{{ tg }}</button>
      <button v-if="filterTag" type="button" class="ftag ftag--clear" @click="filterTag = ''">{{ L.snapshotClearFilter }}</button>
    </div>

    <!-- 列表 -->
    <div class="snap__list">
      <p v-if="!filePath" class="snap__empty">{{ L.snapshotEmpty }}</p>
      <p v-else-if="snapshots.list.length === 0" class="snap__empty">{{ L.snapshotEmpty }}</p>

      <template v-else>
        <div
          v-for="item in filteredList"
          :key="item.id"
          class="row"
          :class="{ 'row--on': snapshots.selectedId === item.id, 'row--a': compareA === item.id, 'row--b': compareB === item.id }"
          @click="snapshots.selectedId = item.id"
          @contextmenu="onContext($event, item.id)"
        >
          <span class="row__time" :title="tz ? L.snapshotTimezone.replace('{tz}', tz) : ''">{{ fmtTime(item.createdAt) }}</span>
          <span v-if="item.note" class="row__note">{{ item.note }}</span>
          <span class="row__delta">{{ deltaChars(item.charCount) }}</span>

          <span class="row__cmp">
            <button type="button" class="cmpbtn" :class="{ on: compareA === item.id }" :title="L.snapshotSetA" @click.stop="toggleA(item.id)">A</button>
            <button type="button" class="cmpbtn" :class="{ on: compareB === item.id }" :title="L.snapshotSetB" @click.stop="toggleB(item.id)">B</button>
          </span>

          <span class="row__tags">
            <template v-if="item.tags && item.tags.length">
              <span v-for="tg in item.tags" :key="tg" class="chip" @click.stop="removeTag(item, tg)">{{ tg }}<i class="chip__x">×</i></span>
            </template>
            <button v-if="editingTagsId !== item.id" type="button" class="chip chip--add" :title="L.snapshotAddTag" @click.stop="startEditTags(item)">+</button>
            <input
              v-else
              v-model="tagDraft"
              class="taginput"
              :placeholder="L.snapshotTagPlaceholder"
              @click.stop
              @keydown.enter.prevent="commitTag(item)"
              @keydown.esc="editingTagsId = null"
            />
          </span>
        </div>
      </template>
    </div>

    <!-- diff 预览 -->
    <div v-if="diffMode !== 'none'" class="snap__diff">
      <div class="diff__head">
        <span class="diff__mode">{{ diffLabel }}</span>
        <button v-if="diffMode === 'ab'" type="button" class="diff__clear" :title="L.snapshotClearCompare" @click="compareA = null; compareB = null">
          <Icon name="x" :size="12" />
        </button>
      </div>
      <div v-if="!hasDiff" class="diff__none">— 与对比对象一致 —</div>
      <pre v-else class="diff"><span
          v-for="(row, i) in diffRows"
          :key="i"
          :class="row.type === 'add' ? 'diff__add' : row.type === 'del' ? 'diff__del' : 'diff__ctx'"
        >{{ row.prefix }}{{ row.text }}
</span></pre>
    </div>

    <!-- 操作：恢复 / 删除 当前选中 -->
    <div v-if="snapshots.selectedId" class="snap__acts">
      <button class="act act--restore" type="button" @click="emit('restore', snapshots.selectedId)">
        <Icon name="history" :size="13" />
        {{ L.snapshotRestore }}
      </button>
      <button class="act act--del" type="button" @click="emit('delete', snapshots.selectedId!)">
        <Icon name="trash" :size="13" />
        {{ L.snapshotDelete }}
      </button>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems()"
      @select="onMenuSelect"
      @close="menu = null"
    />
  </div>
</template>

<style scoped>
.snap {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 30;
  width: 320px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.snap__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.snap__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.snap__count {
  font-size: 11px;
  color: var(--hue-text-3);
}
.snap__x {
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
}
.snap__x:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.snap__save {
  display: flex;
  gap: 6px;
}
.snap__note {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.snap__note:focus {
  border-color: var(--hue-accent);
}
.snap__savebtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.snap__savebtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.snap__savebtn:not(:disabled):hover {
  filter: brightness(1.06);
}

/* 标签筛选 */
.snap__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ftag {
  padding: 2px 9px;
  font-size: 11px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 999px;
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.ftag:hover {
  border-color: var(--hue-accent);
  color: var(--hue-text-1);
}
.ftag--on {
  background: var(--hue-active);
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.ftag--clear {
  color: var(--hue-text-3);
  border-style: dashed;
}

.snap__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.snap__empty {
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 18px 8px;
  line-height: 1.6;
}

.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.row:hover {
  background: var(--hue-surface-2);
}
.row--on {
  border-color: var(--hue-accent);
  background: var(--hue-active);
}
.row--a {
  box-shadow: inset 3px 0 0 var(--hue-accent);
}
.row--b {
  box-shadow: inset 3px 0 0 #d99a4e;
}
.row__time {
  font-size: 12px;
  color: var(--hue-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.row__note {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__delta {
  font-size: 11px;
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 对比 A / B 小按钮 */
.row__cmp {
  display: inline-flex;
  gap: 3px;
  margin-left: 2px;
}
.cmpbtn {
  width: 20px;
  height: 20px;
  font-size: 11px;
  line-height: 1;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 4px;
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.cmpbtn:hover {
  border-color: var(--hue-accent);
  color: var(--hue-text-1);
}
.cmpbtn.on {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
  color: var(--hue-on-accent);
}

/* 标签 chips */
.row__tags {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  font-size: 11px;
  border-radius: 999px;
  background: rgba(var(--hue-tint-1, 126, 196, 182), 0.18);
  color: var(--hue-text-1);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.chip:hover {
  background: rgba(var(--hue-tint-1, 126, 196, 182), 0.3);
}
.chip__x {
  font-style: normal;
  opacity: 0.55;
  font-size: 12px;
  line-height: 1;
}
.chip--add {
  padding: 1px 9px;
  background: transparent;
  border: 1px dashed var(--hue-border-subtle);
  color: var(--hue-text-3);
}
.chip--add:hover {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
  background: transparent;
}
.taginput {
  width: 92px;
  height: 22px;
  font-size: 11px;
  padding: 0 8px;
  border: 1px solid var(--hue-accent);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--hue-text-1);
  outline: none;
  font-family: inherit;
}

.snap__diff {
  max-height: 38%;
  overflow: auto;
  border-top: 1px solid var(--hue-border-subtle);
  border-bottom: 1px solid var(--hue-border-subtle);
  padding: 6px 0;
}
.diff__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  padding: 0 2px;
}
.diff__mode {
  font-size: 11px;
  font-weight: 500;
  color: var(--hue-text-2);
}
.diff__clear {
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
}
.diff__clear:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}
.diff__none {
  font-size: 11.5px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 6px;
}
.diff {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre;
  color: var(--hue-text-2);
}
.diff__add {
  color: #6fcf97;
  background: rgba(111, 207, 151, 0.1);
}
.diff__del {
  color: #f3a39d;
  background: rgba(243, 79, 69, 0.12);
}
.diff__ctx {
  color: var(--hue-text-3);
}

.snap__acts {
  display: flex;
  gap: 8px;
}
.act {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--hue-text-1);
  font-size: 12.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.act--restore:hover {
  background: var(--hue-active);
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.act--del:hover {
  background: rgba(243, 79, 69, 0.12);
  border-color: var(--hue-danger);
  color: var(--hue-danger);
}
</style>
