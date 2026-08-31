<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import { MAIN_BRANCH, useSnapshotsStore } from '../store/snapshots'
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
 * Phase B（git 化）：时间轴 / 血缘视图 + 轻量草稿分支（branch 字段，不合并不解决冲突）。
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

/* ── 视图：列表 / 时间轴 ── */
type ViewMode = 'list' | 'timeline'
const view = ref<ViewMode>('list')

/* ── 备注输入（保存快照时带上）── */
const note = ref('')

async function onCreate(): Promise<void> {
  if (!props.filePath) return
  // 保存到「当前分支」：主线即主线，草稿分支则续写该草稿时间轴
  await snapshots.create(
    props.vaultPath,
    props.filePath,
    props.currentText,
    note.value.trim() || undefined,
    undefined,
    snapshots.activeBranch
  )
  note.value = ''
}

/* ── 分支（轻量草稿分支）── */
const isDraft = computed(() => snapshots.activeBranch !== MAIN_BRANCH)
function branchLabel(name: string): string {
  return name === MAIN_BRANCH ? L.snapshotMainBranch : name
}

const drafting = ref(false)
const draftName = ref('')
function startDraft(): void {
  drafting.value = true
  draftName.value = ''
}
async function commitDraft(): Promise<void> {
  const name = draftName.value.trim()
  drafting.value = false
  draftName.value = ''
  if (!name) return
  // 同名分支已存在 → 只切换过去，不重复建（避免误造重复时间轴）
  if (snapshots.branches.some((b) => b.name === name)) {
    snapshots.activeBranch = name
    return
  }
  // 以「当前正文」为该草稿分支的第一份快照
  await snapshots.create(props.vaultPath, props.filePath, props.currentText, name, undefined, name)
  snapshots.activeBranch = name
}

/* 切分支后清掉不在该分支的选中项（避免高亮一个看不见的行） */
watch(
  () => snapshots.activeBranch,
  () => {
    const id = snapshots.selectedId
    if (id && !snapshots.branchList.some((s) => s.id === id)) snapshots.selectedId = null
  }
)

/* ── 标签筛选（作用域=当前分支）── */
const filterTag = ref('')
const allTags = computed<string[]>(() => {
  const set = new Set<string>()
  for (const s of snapshots.branchList) for (const tg of s.tags || []) set.add(tg)
  return [...set]
})
const filteredList = computed(() =>
  filterTag.value
    ? snapshots.branchList.filter((s) => (s.tags || []).includes(filterTag.value))
    : snapshots.branchList
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

/* ── A / B 任意两点对比（可跨分支）── */
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

/**
 * 恢复 / 采纳：
 * - 主线 →「恢复」（回到这一版）
 * - 草稿分支 →「采纳到主稿」：内容载入编辑器即成为正文，并把视图切回主线
 */
function onRestore(id: string): void {
  emit('restore', id)
  if (isDraft.value) snapshots.activeBranch = MAIN_BRANCH
}

/* ── 右键菜单 ── */
const menu = ref<{ x: number; y: number; id: string } | null>(null)
function onContext(e: MouseEvent, id: string): void {
  e.preventDefault()
  menu.value = { x: e.clientX, y: e.clientY, id }
}
const menuItems = (): MenuItem[] => [
  { action: 'restore', label: isDraft.value ? L.snapshotAdopt : L.snapshotRestore },
  { action: 'delete', label: L.snapshotDelete, danger: true }
]
function onMenuSelect(action: string): void {
  const id = menu.value?.id
  menu.value = null
  if (!id) return
  if (action === 'restore') onRestore(id)
  else if (action === 'delete') emit('delete', id)
}

const tz = localTimeZone()
function fmtTime(ts: number): string {
  return formatDateTime(ts)
}
</script>

<template>
  <div class="snap glass" :class="{ 'snap--tl': view === 'timeline' }" role="dialog" aria-label="版本快照">
    <div class="snap__head">
      <span class="snap__title">{{ L.snapshots }}</span>
      <span class="snap__count">{{ L.snapshotCount.replace('{n}', String(snapshots.branchList.length)) }}</span>
      <span class="snap__views">
        <button type="button" class="vbtn" :class="{ on: view === 'list' }" @click="view = 'list'">
          {{ L.snapshotViewList }}
        </button>
        <button type="button" class="vbtn" :class="{ on: view === 'timeline' }" @click="view = 'timeline'">
          {{ L.snapshotViewTimeline }}
        </button>
      </span>
      <button class="snap__x" type="button" :title="L.close" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <!-- 分支：主线 + 草稿分支；「另起草稿」基于当前正文 Fork 一条独立时间轴 -->
    <div v-if="filePath" class="snap__branches">
      <button
        v-for="b in snapshots.branches"
        :key="b.name"
        type="button"
        class="bchip"
        :class="{ 'bchip--on': snapshots.activeBranch === b.name }"
        @click="snapshots.activeBranch = b.name"
      >
        {{ branchLabel(b.name) }}<span class="bchip__n">{{ b.count }}</span>
      </button>
      <button
        v-if="!drafting"
        type="button"
        class="bchip bchip--add"
        :title="L.snapshotDraftTip"
        @click="startDraft"
      >+ {{ L.snapshotNewDraft }}</button>
      <input
        v-else
        v-model="draftName"
        class="draftinput"
        :placeholder="L.snapshotDraftNamePlaceholder"
        @keydown.enter.prevent="commitDraft"
        @keydown.esc="drafting = false"
      />
    </div>

    <!-- 保存快照：备注 + 按钮（存到当前分支） -->
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

    <!-- 列表 / 时间轴（同一份数据两种呈现：时间轴多一列血缘导轨） -->
    <div class="snap__list" :class="{ 'snap__list--tl': view === 'timeline' }">
      <p v-if="!filePath" class="snap__empty">{{ L.snapshotEmpty }}</p>
      <p v-else-if="snapshots.branchList.length === 0" class="snap__empty">
        {{ isDraft ? L.snapshotBranchEmpty : L.snapshotEmpty }}
      </p>

      <template v-else>
        <div
          v-for="item in filteredList"
          :key="item.id"
          class="row"
          :class="{ 'row--on': snapshots.selectedId === item.id, 'row--a': compareA === item.id, 'row--b': compareB === item.id }"
          @click="snapshots.selectedId = item.id"
          @contextmenu="onContext($event, item.id)"
        >
          <!-- 血缘导轨：竖线串联，节点为圆点；打了标签的快照视为里程碑（实心强调） -->
          <span v-if="view === 'timeline'" class="row__rail">
            <i
              class="row__dot"
              :class="{ 'row__dot--tag': (item.tags || []).length > 0, 'row__dot--on': snapshots.selectedId === item.id }"
              :title="(item.tags || []).length ? L.snapshotMilestone : ''"
            />
          </span>

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

    <!-- 操作：恢复（草稿分支=采纳到主稿） / 删除 当前选中 -->
    <div v-if="snapshots.selectedId" class="snap__acts">
      <button
        class="act act--restore"
        type="button"
        :title="isDraft ? L.snapshotAdoptTip : ''"
        @click="onRestore(snapshots.selectedId!)"
      >
        <Icon name="history" :size="13" />
        {{ isDraft ? L.snapshotAdopt : L.snapshotRestore }}
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
  transition: width var(--dur-fast) var(--ease);
}
/* 时间轴视图需要横向空间放血缘导轨与更长的备注，面板相应加宽 */
.snap--tl {
  width: 440px;
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

/* 视图切换：列表 / 时间轴 */
.snap__views {
  margin-left: auto;
  display: inline-flex;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 999px;
  overflow: hidden;
}
.vbtn {
  padding: 2px 9px;
  font-size: 11px;
  border: 0;
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.vbtn:hover {
  color: var(--hue-text-1);
}
.vbtn.on {
  background: var(--hue-active);
  color: var(--hue-accent);
}

.snap__x {
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

/* 分支 chips */
.snap__branches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.bchip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.bchip:hover {
  border-color: var(--hue-accent);
  color: var(--hue-text-1);
}
.bchip--on {
  background: var(--hue-active);
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.bchip__n {
  font-size: 10px;
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
}
.bchip--on .bchip__n {
  color: inherit;
  opacity: 0.7;
}
.bchip--add {
  border-style: dashed;
  color: var(--hue-text-3);
}
.bchip--add:hover {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.draftinput {
  width: 150px;
  height: 22px;
  font-size: 11px;
  padding: 0 9px;
  border: 1px solid var(--hue-accent);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--hue-text-1);
  outline: none;
  font-family: inherit;
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

/* ── 时间轴：血缘导轨（竖线 + 节点圆点）── */
.row__rail {
  position: relative;
  flex: 0 0 14px;
  align-self: stretch;
}
.row__rail::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--hue-border-subtle);
}
/* 首行（最新）竖线从节点开始向下，末行（最旧）到节点为止 —— 时间轴两端不冒头 */
.snap__list--tl .row:first-child .row__rail::before {
  top: 16px;
}
.snap__list--tl .row:last-child .row__rail::before {
  bottom: auto;
  height: 16px;
}
.row__dot {
  position: absolute;
  left: 3px;
  top: 16px;
  width: 8px;
  height: 8px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--hue-surface-2);
  border: 1.5px solid var(--hue-border-subtle);
  z-index: 1;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
/* 里程碑（打了标签）→ 实心强调色 */
.row__dot--tag {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
}
.row__dot--on {
  box-shadow: 0 0 0 3px rgba(var(--hue-tint-1, 126, 196, 182), 0.22);
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
