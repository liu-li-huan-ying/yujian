<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  open: boolean
  /** 冲突文件路径 */
  path: string | null
  /** 编辑器内当前内容（我的版本） */
  mine: string
  /** 磁盘上被外部改写的内容 */
  disk: string
  /** 磁盘文件修改时间（epoch ms），可能为 null */
  diskMtime: number | null
}>()

const emit = defineEmits<{
  (e: 'keep-mine'): void
  (e: 'use-disk'): void
  (e: 'keep-both'): void
}>()

type SegType = 'eq' | 'del' | 'add' | 'empty'
interface Row {
  text: string
  kind: SegType
}

/** 基于 LCS 的逐行差异分段 */
function diffSegments(a: string[], b: string[]): { type: 'eq' | 'del' | 'add'; lines: string[] }[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const segs: { type: 'eq' | 'del' | 'add'; lines: string[] }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      segs.push({ type: 'eq', lines: [a[i]] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      segs.push({ type: 'del', lines: [a[i]] })
      i++
    } else {
      segs.push({ type: 'add', lines: [b[j]] })
      j++
    }
  }
  while (i < n) {
    segs.push({ type: 'del', lines: [a[i]] })
    i++
  }
  while (j < m) {
    segs.push({ type: 'add', lines: [b[j]] })
    j++
  }
  // 合并相邻同类型段，减少渲染碎片
  const merged: { type: 'eq' | 'del' | 'add'; lines: string[] }[] = []
  for (const s of segs) {
    const last = merged[merged.length - 1]
    if (last && last.type === s.type) last.lines.push(...s.lines)
    else merged.push({ type: s.type, lines: [...s.lines] })
  }
  return merged
}

const { leftRows, rightRows } = (() => {
  const mineLines = props.mine.split('\n')
  const diskLines = props.disk.split('\n')
  const segs = diffSegments(mineLines, diskLines)
  const left: Row[] = []
  const right: Row[] = []
  for (const seg of segs) {
    if (seg.type === 'eq') {
      for (const l of seg.lines) {
        left.push({ text: l, kind: 'eq' })
        right.push({ text: l, kind: 'eq' })
      }
    } else if (seg.type === 'del') {
      for (const l of seg.lines) {
        left.push({ text: l, kind: 'del' })
        right.push({ text: '', kind: 'empty' })
      }
    } else {
      for (const l of seg.lines) {
        left.push({ text: '', kind: 'empty' })
        right.push({ text: l, kind: 'add' })
      }
    }
  }
  return { leftRows: left, rightRows: right }
})()

function countChars(s: string): number {
  return s.replace(/\r\n/g, '\n').replace(/\n/g, '').length
}

const mineChars = computed(() => countChars(props.mine))
const diskChars = computed(() => countChars(props.disk))

const diskTime = computed(() => {
  if (!props.diskMtime) return ''
  try {
    const d = new Date(props.diskMtime)
    return d.toLocaleString()
  } catch {
    return ''
  }
})

function fileBase(p: string | null): string {
  if (!p) return ''
  const i = Math.max((p as string).lastIndexOf('/'), (p as string).lastIndexOf('\\'))
  return i >= 0 ? (p as string).slice(i + 1) : (p as string)
}
</script>

<template>
  <div v-if="open" class="mask" @mousedown.self.prevent>
    <div class="dialog glass" role="alertdialog" aria-modal="true" :aria-label="L.conflict">
      <header class="dlg__head">
        <Icon name="alert" :size="16" class="dlg__icon" />
        <div class="dlg__titles">
          <h3 class="dlg__title">{{ L.conflict }}</h3>
          <span class="dlg__file">{{ fileBase(path) }}</span>
        </div>
      </header>

      <p class="dlg__intro">{{ L.conflictIntro }}</p>

      <div class="dlg__meta">
        <span class="chip chip--mine">{{ L.conflictMineChars.replace('{n}', String(mineChars)) }}</span>
        <span class="chip chip--disk">{{ L.conflictDiskChars.replace('{n}', String(diskChars)) }}</span>
        <span v-if="diskTime" class="chip chip--time">{{ L.conflictDiskTime.replace('{t}', diskTime) }}</span>
      </div>

      <div class="dlg__diff" :aria-label="`${L.conflictDiffMine} / ${L.conflictDiffDisk}`">
        <div class="diff__col">
          <div class="diff__col-head">{{ L.conflictDiffMine }}</div>
          <div class="diff__scroll">
            <div
              v-for="(r, i) in leftRows"
              :key="'l' + i"
              class="line"
              :class="{
                'line--del': r.kind === 'del',
                'line--empty': r.kind === 'empty'
              }"
            >{{ r.text }}</div>
          </div>
        </div>
        <div class="diff__col">
          <div class="diff__col-head">{{ L.conflictDiffDisk }}</div>
          <div class="diff__scroll">
            <div
              v-for="(r, i) in rightRows"
              :key="'r' + i"
              class="line"
              :class="{
                'line--add': r.kind === 'add',
                'line--empty': r.kind === 'empty'
              }"
            >{{ r.text }}</div>
          </div>
        </div>
      </div>

      <div class="dlg__acts">
        <button class="act act--mine" type="button" :title="L.conflictMineHint" @click="emit('keep-mine')">
          {{ L.conflictMine }}
        </button>
        <button class="act act--disk" type="button" :title="L.conflictDiskHint" @click="emit('use-disk')">
          {{ L.conflictDisk }}
        </button>
        <button class="act act--both" type="button" :title="L.conflictBothHint" @click="emit('keep-both')">
          {{ L.conflictBoth }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  padding: 24px;
}

.dialog {
  width: 720px;
  max-width: 100%;
  max-height: calc(100% - 48px);
  padding: 18px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dlg__head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dlg__icon {
  color: rgb(var(--hue-mark));
  flex-shrink: 0;
}
.dlg__titles {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dlg__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.dlg__file {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dlg__intro {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--hue-text-2);
}

.dlg__meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--hue-border-subtle);
  color: var(--hue-text-2);
}
.chip--mine {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.chip--disk {
  border-color: var(--hue-success, #3cb27f);
  color: var(--hue-success, #3cb27f);
}
.chip--time {
  color: var(--hue-text-3);
}

.dlg__diff {
  display: flex;
  gap: 1px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--hue-border-subtle);
  min-height: 0;
}
.diff__col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--hue-editor);
}
.diff__col-head {
  font-size: 10.5px;
  font-weight: 600;
  padding: 5px 10px;
  color: var(--hue-text-3);
  background: var(--hue-surface);
  border-bottom: 1px solid var(--hue-border-subtle);
}
.diff__scroll {
  flex: 1;
  min-height: 120px;
  max-height: 320px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
}
.line {
  padding: 0 10px;
  min-height: 1.5em;
  white-space: pre-wrap;
  word-break: break-word;
  border-left: 2px solid transparent;
  color: var(--hue-text-2);
}
.line--del {
  background: rgba(224, 79, 69, 0.14);
  border-left-color: var(--hue-danger, #f34f45);
  color: #f3b4af;
}
.line--add {
  background: rgba(60, 178, 127, 0.14);
  border-left-color: var(--hue-success, #3cb27f);
  color: #9fe3c4;
}
.line--empty {
  background: var(--hue-surface);
}

.dlg__acts {
  display: flex;
  gap: 8px;
}
.act {
  flex: 1;
  height: 34px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.act:hover {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.act--disk:hover {
  border-color: var(--hue-success, #3cb27f);
  color: var(--hue-success, #3cb27f);
}
.act--both:hover {
  border-color: rgb(var(--hue-mark));
  color: rgb(var(--hue-mark));
}
</style>
