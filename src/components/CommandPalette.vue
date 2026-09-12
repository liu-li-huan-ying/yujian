<script setup lang="ts">
/**
 * 命令面板 / 快速打开笔记 —— 批次四统一入口（UI-DESIGN §3.5）。
 *
 * 双模复用同一套玻璃外壳 + 模糊检索 + 键盘导航：
 *  - mode='commands'（Ctrl+Shift+P）：按分组展示全部命令（文件·视图·知识·工具·导出·设置）
 *  - mode='files'（Ctrl+K）：快速跳转到任意 .md（由索引 listNotes 喂数据）
 *
 * 纯展示 + 键盘：候选、高亮、分组全部本地算；执行交给父组件（emit run / pick），
 * 这样命令动作仍集中在 App.vue（不在这散落业务逻辑）。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { NoteTitleItem } from '../../electron/shared/ipc-channels'
import { useI18n } from '../i18n'
import {
  COMMANDS,
  GROUP_ORDER,
  type CommandGroup,
  type CommandId,
  type CommandSpec,
} from '../utils/commands'
import { fuzzyMatch, fuzzyRank, highlightSegments } from '../utils/fuzzy'

const props = defineProps<{
  mode: 'commands' | 'files'
  vaultPath: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'run', id: CommandId): void
  (e: 'pick', path: string): void
}>()

const { t } = useI18n()
const L = t.palette

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

/* ── 命令模式：分组 + 分组内模糊排序 ── */
function commandLabel(id: string): string {
  return (t.palette.cmd as Record<string, string>)[id] ?? id
}

const commandGroups = computed(() => {
  const q = query.value.trim()
  const blocks: { group: CommandGroup; rows: { id: CommandId; keys?: string; flat: number; positions: number[] }[] }[] = []
  // flat = 跨分组的全局序号。高亮 / 键盘索引 / aria-activedescendant 一律以它为准——
  // 若用分组内局部下标，则 `i === activeIndex` 会让**每个分组的第一项**同时命中（同一 bug 也导致
  // DOM id 在不同分组间重复）。故这里预先算出全局序号，模板只做一次相等比较。
  let flat = 0
  for (const group of GROUP_ORDER) {
    const specs = (COMMANDS as readonly CommandSpec[]).filter((s) => s.group === group)
    const ranked = fuzzyRank(q, specs, (s) => commandLabel(s.id), 50)
    if (ranked.length === 0) continue
    blocks.push({
      group,
      rows: ranked.map((r) => ({ id: r.item.id as CommandId, keys: r.item.keys, positions: r.positions, flat: flat++ })),
    })
  }
  return blocks
})

/** 命令模式下的扁平行（跨分组），供 activeIndex 索引与滚动跟随；顺序与 group.rows 的 flat 一致 */
const flatCommands = computed(() => commandGroups.value.flatMap((b) => b.rows))

/* ── 文件模式：从索引拉笔记，标题/文件名双字段模糊 ── */
const notes = ref<NoteTitleItem[]>([])
const notesLoaded = ref(false)

async function loadNotes(): Promise<void> {
  if (!props.vaultPath) return
  notes.value = await window.api.listNotes(props.vaultPath)
  notesLoaded.value = true
}

interface FileRow {
  path: string
  title: string
  dir: string
  baseHit: boolean
  positions: number[]
}

const fileRows = computed<FileRow[]>(() => {
  const q = query.value.trim()
  const items = notes.value
  if (q === '') return items.slice(0, 50).map((n) => ({ path: n.path, title: n.title, dir: dirOf(n.path), baseHit: false, positions: [] }))
  const out: (FileRow & { score: number })[] = []
  for (const n of items) {
    const a = fuzzyMatch(q, n.title)
    const b = n.base !== n.title ? fuzzyMatch(q, n.base) : null
    if (!a && !b) continue
    const useBase = !a || (b !== null && b.score > a.score)
    out.push({
      path: n.path,
      title: n.title,
      dir: dirOf(n.path),
      baseHit: useBase,
      positions: useBase && b ? b.positions : a ? a.positions : [],
      score: Math.max(a?.score ?? 0, b?.score ?? 0),
    })
  }
  out.sort((x, y) => y.score - x.score)
  return out.slice(0, 50)
})

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

/* ── 统一扁平行（供键盘索引）── */
const flatFiles = computed(() => fileRows.value)

function runActive(): void {
  if (props.mode === 'commands') {
    const row = flatCommands.value[activeIndex.value]
    if (row) emit('run', row.id)
  } else {
    const row = flatFiles.value[activeIndex.value]
    if (row) emit('pick', row.path)
  }
}

function onKeydown(e: KeyboardEvent): void {
  const len = props.mode === 'commands' ? flatCommands.value.length : flatFiles.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = len === 0 ? 0 : (activeIndex.value + 1) % len
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = len === 0 ? 0 : (activeIndex.value - 1 + len) % len
  } else if (e.key === 'Enter') {
    e.preventDefault()
    runActive()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

/** 输入变化：重置高亮到首项 */
watch(query, () => {
  activeIndex.value = 0
})

/** 高亮项滚动跟随 */
watch(activeIndex, () => {
  void nextTick(() => {
    const box = listEl.value
    const cur = box?.querySelector('.cp__row--on') as HTMLElement | null
    cur?.scrollIntoView({ block: 'nearest' })
  })
})

/** 文件模式挂载即拉取笔记列表（vaultPath 变化时失效重拉） */
watch(
  () => props.vaultPath,
  () => {
    notes.value = []
    notesLoaded.value = false
    if (props.mode === 'files') void loadNotes()
  },
  { immediate: true },
)

onMounted(() => {
  if (props.mode === 'files') void loadNotes()
  void nextTick(() => inputEl.value?.focus())
})

const emptyText = computed(() => (props.mode === 'commands' ? L.emptyCmd : L.emptyFile))
</script>

<template>
  <div class="cp-backdrop" @mousedown="emit('close')">
    <div
      class="cp glass"
      role="dialog"
      aria-modal="true"
      :aria-label="mode === 'commands' ? L.title : L.quickOpen"
      @mousedown.stop
    >
      <input
        ref="inputEl"
        v-model="query"
        class="cp__input"
        type="text"
        :placeholder="mode === 'commands' ? L.searchCmd : L.searchFile"
        role="combobox"
        aria-expanded="true"
        :aria-controls="'cp-list'"
        :aria-activedescendant="`cp-row-${activeIndex}`"
        autocomplete="off"
        spellcheck="false"
        @keydown="onKeydown"
      />

      <!-- 命令模式：分组渲染 -->
      <div v-if="mode === 'commands'" id="cp-list" ref="listEl" class="cp__list" role="listbox">
        <template v-for="block in commandGroups" :key="block.group">
          <p class="cp__group">{{ (t.palette.group as Record<string, string>)[block.group] }}</p>
          <button
            v-for="row in block.rows"
            :id="`cp-row-${row.flat}`"
            :key="row.id"
            type="button"
            class="cp__row"
            :class="{ 'cp__row--on': row.flat === activeIndex }"
            role="option"
            :aria-selected="row.flat === activeIndex"
            @mouseenter="activeIndex = row.flat"
            @mousedown.prevent="emit('run', row.id)"
          >
            <span class="cp__label">
              <template v-for="(seg, si) in highlightSegments(commandLabel(row.id), row.positions)" :key="si"
                ><mark v-if="seg.hit" class="cp__hit">{{ seg.text }}</mark
                ><template v-else>{{ seg.text }}</template></template
              >
            </span>
            <kbd v-if="row.keys" class="cp__kbd">{{ row.keys }}</kbd>
          </button>
        </template>
        <p v-if="flatCommands.length === 0" class="cp__empty">{{ emptyText }}</p>
      </div>

      <!-- 文件模式：扁平笔记列表 -->
      <div v-else id="cp-list" ref="listEl" class="cp__list" role="listbox">
        <button
          v-for="(row, i) in fileRows"
          :id="`cp-row-${i}`"
          :key="row.path"
          type="button"
          class="cp__row"
          :class="{ 'cp__row--on': i === activeIndex }"
          role="option"
          :aria-selected="i === activeIndex"
          :title="row.path"
          @mouseenter="activeIndex = i"
          @mousedown.prevent="emit('pick', row.path)"
        >
          <span class="cp__label">
            <template v-for="(seg, si) in highlightSegments(row.title, row.positions)" :key="si"
              ><mark v-if="seg.hit" class="cp__hit">{{ seg.text }}</mark
              ><template v-else>{{ seg.text }}</template></template
            >
          </span>
          <span class="cp__dir">{{ row.dir }}</span>
        </button>
        <p v-if="fileRows.length === 0 && notesLoaded" class="cp__empty">{{ emptyText }}</p>
        <p v-if="!notesLoaded" class="cp__empty">{{ emptyText }}</p>
      </div>

      <p class="cp__foot">{{ L.escHint }}</p>
    </div>
  </div>
</template>

<style scoped>
.cp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  /* 不挡全屏变暗，只做点击捕获；视觉重心在玻璃面板本身 */
}

.cp {
  position: relative;
  width: 560px;
  max-width: calc(100vw - 24px);
  margin-top: 15vh;
  padding: 8px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: cp-in 0.12s var(--ease, ease) both;
}

@keyframes cp-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.cp__input {
  height: 40px;
  font-size: 16px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--hue-highlight);
  color: var(--hue-text-1);
  outline: none;
  caret-color: var(--hue-accent);
}
.cp__input::placeholder {
  color: var(--hue-text-3);
}

.cp__list {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0;
}

.cp__group {
  margin: 6px 6px 2px;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--hue-text-3);
}

.cp__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast, 0.12s) var(--ease, ease);
}
.cp__row--on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
}

.cp__label {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp__hit {
  background: transparent;
  color: inherit;
  font-weight: 600;
  /* 命中字加粗即可，颜色随行（普通行=text-1 感、高亮行=on-accent）；避免另起底色与选中态打架 */
}

.cp__dir {
  flex: 0 0 auto;
  max-width: 42%;
  font-size: 10.5px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp__kbd {
  flex: 0 0 auto;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.4;
  border-radius: 4px;
  background: rgba(var(--hue-key), 0.16);
  color: var(--hue-text-2);
  white-space: nowrap;
}

.cp__empty {
  margin: 0;
  padding: 16px 10px;
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
}

.cp__foot {
  margin: 0;
  padding: 5px 10px 3px;
  border-top: 1px solid var(--hue-border-subtle);
  font-size: 10.5px;
  color: var(--hue-text-3);
}
</style>
