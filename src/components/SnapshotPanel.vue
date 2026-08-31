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
  (e: 'pick', text: string): void
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

/* ── diff 视图：统一（unified）/ 并排（split，GitHub 风格）── */
const diffView = ref<'unified' | 'split'>('unified')

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
const diffStats = computed(() => {
  let add = 0
  let del = 0
  for (const r of diffRows.value) {
    if (r.type === 'add') add++
    else if (r.type === 'del') del++
  }
  return { add, del }
})

/**
 * 把扁平 diff 按「变更段」聚合成 hunks（相邻变更合并、±1 行上下文、边界不重叠）。
 * 每个 hunk 的 pickText = B 侧（快照 / 对比中的 B）新增或修改的内容——
 * 即「从旧版/对比方摘一段回来」要插入当前文档的原文。纯删除段（仅当前稿有、旧版无）
 * 没有可摘取的来源，pickText 为空、不显示摘取按钮。
 */
interface DiffHunk {
  rows: { type: 'add' | 'del' | 'ctx'; prefix: string; text: string }[]
  pickText: string
  kind: 'add' | 'del' | 'mod'
  end: number
  oldStart: number
  newStart: number
  oldSpan: number
  newSpan: number
}
const diffHunks = computed<DiffHunk[]>(() => {
  const rows = diffRows.value
  const hunks: DiffHunk[] = []
  let i = 0
  // 计算 hunk 之前的累计行号（GitHub 风格 @@ -old +new @@）
  let baseOld = 0
  let baseNew = 0
  while (i < rows.length) {
    if (rows[i].type === 'ctx') {
      i++
      baseOld++
      baseNew++
      continue
    }
    let j = i
    while (j < rows.length && rows[j].type !== 'ctx') j++
    let start = Math.max(0, i - 1)
    const end = Math.min(rows.length, j + 1)
    if (hunks.length && start < hunks[hunks.length - 1].end) start = hunks[hunks.length - 1].end
    const slice = rows.slice(start, end)
    const pickLines = slice.filter((r) => r.type === 'add').map((r) => r.text)
    const pickText = pickLines.length ? `${pickLines.join('\n')}\n` : ''
    const hasAdd = slice.some((r) => r.type === 'add')
    const hasDel = slice.some((r) => r.type === 'del')
    const kind: DiffHunk['kind'] = hasAdd && hasDel ? 'mod' : hasAdd ? 'add' : 'del'
    // 行号累计：ctx 之前已计入 baseOld/baseNew；这里从该 hunk 起点位置推导
    let o = baseOld
    let n = baseNew
    for (let k = start; k < end; k++) {
      const t = rows[k].type
      if (t === 'del') o++
      else if (t === 'add') n++
      else {
        o++
        n++
      }
    }
    const oldSpan = slice.filter((r) => r.type !== 'add').length
    const newSpan = slice.filter((r) => r.type !== 'del').length
    hunks.push({ rows: slice, pickText, kind, end, oldStart: o, newStart: n, oldSpan, newSpan })
    // 推进 base：跳过本 hunk 内部，到下一段 ctx 前
    for (let k = i; k < j; k++) {
      const t = rows[k].type
      if (t === 'del') baseOld++
      else if (t === 'add') baseNew++
      else {
        baseOld++
        baseNew++
      }
    }
    i = j
  }
  return hunks
})

/** 并排视图（GitHub split）：把连续 del/add 配对，ctx 两侧对齐 */
interface SplitRow {
  left: { type: 'del' | 'ctx'; text: string } | null
  right: { type: 'add' | 'ctx'; text: string } | null
}
function splitPairs(rows: DiffHunk['rows']): SplitRow[] {
  const out: SplitRow[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.type === 'ctx') {
      out.push({ left: { type: 'ctx', text: r.text }, right: { type: 'ctx', text: r.text } })
      i++
    } else if (r.type === 'del') {
      let j = i
      while (j < rows.length && rows[j].type === 'del') j++
      let k = j
      while (k < rows.length && rows[k].type === 'add') k++
      const dels = rows.slice(i, j)
      const adds = rows.slice(j, k)
      const n = Math.max(dels.length, adds.length)
      for (let m = 0; m < n; m++) {
        out.push({
          left: dels[m] ? { type: 'del', text: dels[m].text } : null,
          right: adds[m] ? { type: 'add', text: adds[m].text } : null
        })
      }
      i = k
    } else {
      out.push({ left: null, right: { type: 'add', text: r.text } })
      i++
    }
  }
  return out
}

/* ── 摘取来源标注（让用户清楚「摘的是哪一侧」）── */
const diffSource = computed<string>(() => {
  if (diffMode.value === 'ab') {
    const b = snapshots.branchList.find((s) => s.id === compareB.value)
    return b ? (b.note || fmtTime(b.createdAt)) : L.snapshotSetB
  }
  const cur = snapshots.branchList.find((s) => s.id === snapshots.selectedId)
  return cur ? (cur.note || fmtTime(cur.createdAt)) : ''
})

/* ── 摘取成功微态（短暂高亮，给即时反馈）── */
const pickedHi = ref<number | null>(null)
let pickedTimer: ReturnType<typeof setTimeout> | null = null
/** cherry-pick：把选中变更段（B/快照侧内容）摘取到当前文档光标处 */
function onPick(text: string, hi: number): void {
  emit('pick', text)
  pickedHi.value = hi
  if (pickedTimer) clearTimeout(pickedTimer)
  pickedTimer = setTimeout(() => {
    pickedHi.value = null
  }, 1400)
}

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
  <div class="snap glass" :class="{ 'snap--tl': view === 'timeline', 'snap--split': diffView === 'split' }" role="dialog" aria-label="版本快照">
    <header class="snap__head">
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
    </header>

    <!-- 分支：主线 + 草稿分支；「另起草稿」基于当前正文 Fork 一条独立时间轴 -->
    <div v-if="filePath" class="snap__branches">
      <button
        v-for="b in snapshots.branches"
        :key="b.name"
        type="button"
        class="bchip"
        :class="{ on: snapshots.activeBranch === b.name }"
        :title="b.name === MAIN_BRANCH ? L.snapshotMainBranch : b.name"
        @click="snapshots.activeBranch = b.name"
      >
        <i class="bchip__dot" />
        <span class="bchip__name">{{ branchLabel(b.name) }}</span>
        <span class="bchip__n">{{ b.count }}</span>
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
        :class="{ on: filterTag === tg }"
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
        <!-- 时间轴：当前工作区锚点，向纵深收束到各快照 -->
        <div v-if="view === 'timeline'" class="tl-now">
          <span class="row__rail"><i class="row__dot row__dot--now" :title="L.snapshotCurrentWorkspace" /></span>
          <div class="row__body">
            <div class="row__main">
              <span class="row__time row__time--now">{{ L.snapshotCurrentWorkspace }}</span>
              <span class="row__note row__note--muted">{{ isDraft ? L.snapshotAdopt : L.snapshots }}</span>
            </div>
          </div>
        </div>

        <div
          v-for="item in filteredList"
          :key="item.id"
          class="row"
          :class="{ on: snapshots.selectedId === item.id, a: compareA === item.id, b: compareB === item.id }"
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

          <div class="row__body">
            <div class="row__main">
              <span class="row__time" :title="tz ? L.snapshotTimezone.replace('{tz}', tz) : ''">{{ fmtTime(item.createdAt) }}</span>
              <span v-if="item.note" class="row__note">{{ item.note }}</span>
              <span class="row__spacer" />
              <span class="row__delta" :title="L.snapshotCharDelta">{{ deltaChars(item.charCount) }}</span>
              <span class="row__cmp">
                <button type="button" class="cmpbtn" :class="{ on: compareA === item.id }" :title="L.snapshotSetA" @click.stop="toggleA(item.id)">A</button>
                <button type="button" class="cmpbtn" :class="{ on: compareB === item.id }" :title="L.snapshotSetB" @click.stop="toggleB(item.id)">B</button>
              </span>
            </div>

            <div v-if="(item.tags && item.tags.length) || editingTagsId === item.id" class="row__tags">
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
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- diff 预览（cherry-pick 单位 = 每个变更段 hunk） -->
    <div v-if="diffMode !== 'none'" class="snap__diff">
      <div class="diff__head">
        <span class="diff__mode">{{ diffLabel }}</span>
        <span v-if="hasDiff" class="diff__stat">
          <b class="stat--add">+{{ diffStats.add }}</b>
          <b class="stat--del">−{{ diffStats.del }}</b>
        </span>
        <span v-if="hasDiff" class="diff__src" :title="L.snapshotPickTip">{{ L.snapshotDiffSource.replace('{src}', diffSource) }}</span>
        <span class="diff__views" v-if="hasDiff">
          <button type="button" class="vbtn vbtn--mini" :class="{ on: diffView === 'unified' }" @click="diffView = 'unified'">{{ L.snapshotViewUnified }}</button>
          <button type="button" class="vbtn vbtn--mini" :class="{ on: diffView === 'split' }" @click="diffView = 'split'">{{ L.snapshotViewSplit }}</button>
        </span>
        <button v-if="diffMode === 'ab'" type="button" class="diff__clear" :title="L.snapshotClearCompare" @click="compareA = null; compareB = null">
          <Icon name="x" :size="12" />
        </button>
      </div>

      <div v-if="!hasDiff" class="diff__none">— {{ L.snapshotNoDiff }} —</div>
      <div v-else class="diff">
        <div
          v-for="(hunk, hi) in diffHunks"
          :key="hi"
          class="hunk"
          :class="[`hunk--${hunk.kind}`, { 'hunk--picked': pickedHi === hi }]"
        >
          <div class="hunk__bar">
            <span class="hunk__kind" :class="`hunk__kind--${hunk.kind}`">
              <Icon :name="hunk.kind === 'add' ? 'plus' : hunk.kind === 'del' ? 'minus' : 'writing'" :size="11" />
              {{ hunk.kind === 'add' ? L.snapshotHunkAdd : hunk.kind === 'del' ? L.snapshotHunkDel : L.snapshotHunkMod }}
            </span>
            <span class="hunk__range">@@ -{{ hunk.oldStart }}{{ hunk.oldSpan > 1 ? ',' + hunk.oldSpan : '' }} +{{ hunk.newStart }}{{ hunk.newSpan > 1 ? ',' + hunk.newSpan : '' }} @@</span>
            <span class="hunk__spacer" />
            <button
              v-if="hunk.pickText && pickedHi !== hi"
              type="button"
              class="hunk__pick"
              :title="L.snapshotPickTip"
              @click="onPick(hunk.pickText, hi)"
            >
              <Icon name="scissors" :size="12" />
              {{ L.snapshotPick }}
            </button>
            <span v-else-if="pickedHi === hi" class="hunk__picked">
              <Icon name="check" :size="12" />
              {{ L.snapshotPickedShort }}
            </span>
          </div>

          <!-- 统一视图：内联着色变更（Google Docs 风格） -->
          <pre v-if="diffView === 'unified'" class="hunk__code"><span
              v-for="(row, ri) in hunk.rows"
              :key="ri"
              class="ln"
              :class="row.type === 'add' ? 'ln--add' : row.type === 'del' ? 'ln--del' : 'ln--ctx'"
            ><i class="ln__g">{{ row.type === 'add' ? '+' : row.type === 'del' ? '−' : '·' }}</i><span class="ln__t">{{ row.text }}</span>
</span></pre>

          <!-- 并排视图（GitHub split）：左旧 / 右新，del+add 配对、ctx 两侧对齐 -->
          <div v-else class="hunk__split">
            <div class="split__cols">
              <div class="split__col split__col--old">
                <div
                  v-for="(p, pi) in splitPairs(hunk.rows)"
                  :key="pi"
                  class="ln"
                  :class="[p.left ? (p.left.type === 'del' ? 'ln--del' : 'ln--ctx') : 'ln--empty']"
                ><i class="ln__g">{{ p.left ? (p.left.type === 'del' ? '−' : '·') : '' }}</i><span class="ln__t">{{ p.left ? p.left.text : '' }}</span></div>
              </div>
              <div class="split__col split__col--new">
                <div
                  v-for="(p, pi) in splitPairs(hunk.rows)"
                  :key="pi"
                  class="ln"
                  :class="[p.right ? (p.right.type === 'add' ? 'ln--add' : 'ln--ctx') : 'ln--empty']"
                ><i class="ln__g">{{ p.right ? (p.right.type === 'add' ? '+' : '·') : '' }}</i><span class="ln__t">{{ p.right ? p.right.text : '' }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
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
  width: 340px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 14px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: width var(--dur-fast) var(--ease);
}
/* 时间轴视图需要横向空间放血缘导轨与更长的备注，面板相应加宽 */
.snap--tl {
  width: 460px;
}
/* 并排对比（split）需要更宽的空间容纳左右两栏 */
.snap--split {
  width: 580px;
}

/* ── 头部 ── */
.snap__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.snap__title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--hue-text-1);
}
.snap__count {
  font-size: 11px;
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
}

/* 视图切换：列表 / 时间轴（分段控件，与标题栏同语言） */
.snap__views {
  margin-left: auto;
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--hue-highlight);
  border: 1px solid var(--hue-border-subtle);
  border-radius: 999px;
}
.vbtn {
  padding: 3px 10px;
  font-size: 11px;
  border: 0;
  background: transparent;
  color: var(--hue-text-3);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.vbtn:hover {
  color: var(--hue-text-1);
}
.vbtn.on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
}

.snap__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.snap__x:hover {
  background: var(--hue-surface-2);
  color: var(--hue-text-1);
}

/* ── 分支 chips ── */
.snap__branches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.bchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
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
.bchip__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hue-text-3);
  flex: 0 0 auto;
}
.bchip__name {
  font-weight: 500;
}
.bchip__n {
  font-size: 10px;
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
}
.bchip:hover {
  border-color: var(--hue-accent);
  color: var(--hue-text-1);
}
.bchip.on {
  background: var(--hue-active);
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.bchip.on .bchip__dot {
  background: var(--hue-accent);
}
.bchip.on .bchip__n {
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
  width: 160px;
  height: 24px;
  font-size: 11px;
  padding: 0 10px;
  border: 1px solid var(--hue-accent);
  border-radius: 999px;
  background: var(--hue-surface);
  color: var(--hue-text-1);
  outline: none;
  font-family: inherit;
}

/* ── 保存条 ── */
.snap__save {
  display: flex;
  gap: 6px;
}
.snap__note {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  outline: none;
  transition: border-color var(--dur-fast) var(--ease);
}
.snap__note::placeholder {
  color: var(--hue-text-3);
}
.snap__note:focus {
  border-color: var(--hue-accent);
}
.snap__savebtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    filter var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.snap__savebtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.snap__savebtn:not(:disabled):hover {
  filter: brightness(1.06);
}

/* ── 标签筛选 ── */
.snap__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ftag {
  padding: 3px 10px;
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
.ftag.on {
  background: var(--hue-active);
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.ftag--clear {
  color: var(--hue-text-3);
  border-style: dashed;
}

/* ── 列表 ── */
.snap__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.snap__empty {
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 20px 8px;
  line-height: 1.6;
}

/* 每条快照 = 卡片（列表模式） */
.row {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.row:hover {
  background: var(--hue-surface-2);
  border-color: var(--hue-border-default);
  box-shadow: var(--hue-shadow-1);
}
.row.on {
  border-color: var(--hue-accent);
  background: var(--hue-active);
}
.row.a {
  box-shadow: inset 3px 0 0 var(--hue-accent);
}
.row.b {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--hue-accent) 50%, var(--hue-text-3));
}
.row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row__main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.row__time {
  font-size: 12px;
  color: var(--hue-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.row__time--now {
  color: var(--hue-accent);
  font-weight: 600;
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
.row__note--muted {
  color: var(--hue-text-3);
  font-weight: 400;
}
.row__spacer {
  flex: 1;
}
.row__delta {
  font-size: 11px;
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 对比 A / B 小按钮：默认降噪半透明，hover / 选中才点亮 */
.row__cmp {
  display: inline-flex;
  gap: 3px;
  opacity: 0.5;
  transition: opacity var(--dur-fast) var(--ease);
}
.row:hover .row__cmp,
.row.on .row__cmp,
.row.a .row__cmp,
.row.b .row__cmp {
  opacity: 1;
}
.cmpbtn {
  width: 20px;
  height: 20px;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
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

/* ── 标签 chips ── */
.row__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 9px;
  font-size: 11px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hue-accent) 16%, transparent);
  color: var(--hue-text-1);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.chip:hover {
  background: color-mix(in srgb, var(--hue-accent) 28%, transparent);
}
.chip__x {
  font-style: normal;
  opacity: 0.5;
  font-size: 12px;
  line-height: 1;
}
.chip--add {
  padding: 1px 10px;
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
  width: 96px;
  height: 22px;
  font-size: 11px;
  padding: 0 9px;
  border: 1px solid var(--hue-accent);
  border-radius: 999px;
  background: var(--hue-surface);
  color: var(--hue-text-1);
  outline: none;
  font-family: inherit;
}

/* ── 时间轴：血缘导轨（竖线 + 节点圆点）── */
.snap__list--tl {
  gap: 0;
  padding: 2px 0;
}
.snap__list--tl .row {
  background: transparent;
  border-color: transparent;
  padding: 10px 4px 10px 0;
  border-radius: 0;
}
.snap__list--tl .row:hover {
  background: color-mix(in srgb, var(--hue-surface-2) 55%, transparent);
}
.snap__list--tl .row.on {
  background: var(--hue-active);
  border-color: transparent;
  border-radius: var(--radius-md);
}
.row__rail {
  position: relative;
  flex: 0 0 16px;
  align-self: stretch;
}
.row__rail::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--hue-border-subtle);
}
/* 首行（当前工作区锚点）竖线从节点开始向下，末行（最旧）到节点为止 —— 时间轴两端不冒头 */
.snap__list--tl .tl-now .row__rail::before {
  top: 18px;
}
.snap__list--tl .row:last-child .row__rail::before {
  bottom: auto;
  height: 18px;
}
.row__dot {
  position: absolute;
  left: 3.5px;
  top: 16px;
  width: 9px;
  height: 9px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--hue-surface-2);
  border: 1.5px solid var(--hue-border-default);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hue-accent) 24%, transparent);
}
/* 当前工作区锚点：accent 实心 + 光环 */
.row__dot--now {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hue-accent) 26%, transparent);
}

/* 时间轴「当前工作区」锚点行 */
.tl-now {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 6px 4px 12px 0;
}
.tl-now .row__time--now {
  font-size: 12px;
}

/* ── diff 预览 ── */
.snap__diff {
  max-height: 38%;
  overflow: auto;
  border-top: 1px solid var(--hue-border-subtle);
  border-bottom: 1px solid var(--hue-border-subtle);
  padding: 8px 0;
}
.diff__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-bottom: 6px;
  padding: 0 2px;
}
.diff__mode {
  font-size: 11px;
  font-weight: 500;
  color: var(--hue-text-2);
}
.diff__stat {
  display: inline-flex;
  gap: 8px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.stat--add {
  color: var(--hue-success);
  font-weight: 600;
}
.stat--del {
  color: var(--hue-danger);
  font-weight: 600;
}
/* 摘取来源：让用户清楚「摘的是哪一侧」 */
.diff__src {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 统一 / 并排 切换 */
.diff__views {
  display: inline-flex;
  padding: 1px;
  gap: 1px;
  background: var(--hue-highlight);
  border: 1px solid var(--hue-border-subtle);
  border-radius: 999px;
}
.vbtn--mini {
  padding: 2px 8px;
  font-size: 10px;
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
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.diff__clear:hover {
  background: var(--hue-surface-2);
  color: var(--hue-text-1);
}
.diff__none {
  font-size: 11.5px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 8px;
}

/* 变更行（统一视图）：行号槽 + 内联着色（Google Docs 风格） */
.diff {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.65;
  color: var(--hue-text-2);
}
.ln {
  display: flex;
  align-items: baseline;
  padding: 0 10px 0 0;
  border-radius: 3px;
  transition: background var(--dur-fast) var(--ease);
}
.ln:hover {
  background: var(--hue-surface-2);
}
.ln__g {
  flex: 0 0 18px;
  text-align: center;
  font-style: normal;
  opacity: 0.55;
  user-select: none;
  color: var(--hue-text-3);
}
.ln__t {
  flex: 1;
  min-width: 0;
  white-space: pre;
  overflow: hidden;
}
.ln--add {
  background: color-mix(in srgb, var(--hue-success) 9%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--hue-success) 65%, transparent);
}
.ln--add .ln__g {
  color: var(--hue-success);
  opacity: 0.9;
}
.ln--del {
  background: color-mix(in srgb, var(--hue-danger) 9%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--hue-danger) 65%, transparent);
}
.ln--del .ln__g {
  color: var(--hue-danger);
  opacity: 0.9;
}
.ln--del .ln__t {
  color: color-mix(in srgb, var(--hue-danger) 70%, var(--hue-text-2));
}
.ln--ctx .ln__t {
  color: var(--hue-text-3);
}
.ln--empty {
  background: transparent;
}

/* ── diff 按变更段聚合成 hunk（cherry-pick 单位）── */
.hunk {
  margin: 6px 0;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  overflow: hidden;
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.hunk:hover {
  border-color: var(--hue-border-default);
  box-shadow: var(--hue-shadow-1);
}
.hunk--add {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--hue-success) 70%, transparent);
}
.hunk--del {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--hue-danger) 70%, transparent);
}
.hunk--mod {
  box-shadow: inset 3px 0 0 var(--hue-accent);
}
.hunk__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 11px;
  background: var(--hue-surface-2);
  border-bottom: 1px solid var(--hue-border-subtle);
}
.hunk__tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--hue-text-3);
  text-transform: none;
}
.hunk--add .hunk__tag {
  color: var(--hue-success);
}
.hunk--del .hunk__tag {
  color: var(--hue-danger);
}
.hunk--mod .hunk__tag {
  color: var(--hue-accent);
}
.hunk__spacer {
  flex: 1;
}
.hunk__pick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  cursor: pointer;
  transition:
    filter var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.hunk__pick:hover {
  filter: brightness(1.06);
}
.hunk__pick:active {
  filter: brightness(0.94);
}
.hunk__code {
  margin: 0;
  padding: 4px 0 6px;
  white-space: normal;
}
/* 并排视图（GitHub split）：左旧 / 右新 */
.hunk__split {
  padding: 4px 0 6px;
}
.split__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.split__col {
  min-width: 0;
}
.split__col--old {
  border-right: 1px solid var(--hue-border-subtle);
}
.split__col .ln {
  border-radius: 0;
}
.split__col .ln__t {
  padding-right: 8px;
}

/* hunk 头：kind 标签 + 行号范围 + 摘取 */
.hunk__kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--hue-text-3);
}
.hunk__kind--add {
  color: var(--hue-success);
}
.hunk__kind--del {
  color: var(--hue-danger);
}
.hunk__kind--mod {
  color: var(--hue-accent);
}
.hunk__range {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--hue-text-3);
  opacity: 0.8;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hunk__picked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hue-success) 16%, transparent);
  color: var(--hue-success);
}
/* 摘取成功后整块轻微高亮，给即时反馈 */
.hunk--picked {
  border-color: color-mix(in srgb, var(--hue-success) 50%, var(--hue-border-subtle));
  box-shadow:
    inset 3px 0 0 var(--hue-success),
    0 0 0 1px color-mix(in srgb, var(--hue-success) 22%, transparent);
  animation: hunkPicked 1.4s var(--ease);
}
@keyframes hunkPicked {
  0% {
    background: color-mix(in srgb, var(--hue-success) 12%, transparent);
  }
  100% {
    background: var(--hue-surface);
  }
}

/* ── 操作按钮 ── */
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
  height: 34px;
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
  background: color-mix(in srgb, var(--hue-danger) 12%, transparent);
  border-color: var(--hue-danger);
  color: var(--hue-danger);
}

/* ── 无障碍：焦点可见 ── */
.snap button:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: 2px;
}
</style>
