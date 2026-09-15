<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'
import {
  buildHunks,
  diffStats,
  hasChanges,
  splitPairs,
  type DiffHunk,
  type DiffRow,
} from '../utils/snapshotDiff'
import { useI18n } from '../i18n'

/**
 * 快照 diff 视图：把「逐行 diff」渲染成可摘取（cherry-pick）的变更段。
 *
 * 职责边界（为什么这样切）：
 * - **算 diff 的是纯函数**（`utils/snapshotDiff`，已单测）；本组件只做渲染与交互微态。
 * - **对比状态**（A/B 选点、快照内容读取、diffMode）在 `useSnapshotDiff`，由面板持有。
 *   本组件只收「已算好的 rows」，于是可被任何宿主复用（面板 / 未来的全屏 diff 弹窗）。
 * - **统一 / 并排 的选择归面板**（`v-model:view`）：面板根节点要靠它切 `.snap--split` 宽度。
 */

/** 摘取成功高亮的持续时长（与 CSS 动画 hunkPicked 对齐） */
const PICK_HILITE_MS = 1400

const props = defineProps<{
  /** 'ab' = A↔B 两点对比；'selected' = 当前稿 ↔ 选中快照 */
  mode: 'ab' | 'selected'
  /** 已算好的逐行 diff（纯逻辑见 utils/snapshotDiff） */
  rows: DiffRow[]
  /** 摘取来源标注（B 侧 / 选中快照的备注或时间） */
  source: string
  /** 统一 / 并排；面板持有该状态（面板宽度随之变化） */
  view: 'unified' | 'split'
}>()

const emit = defineEmits<{
  (e: 'update:view', view: 'unified' | 'split'): void
  (e: 'pick', text: string): void
  (e: 'clear'): void
}>()

const { t } = useI18n()
const L = t.ui

const hasDiff = computed(() => hasChanges(props.rows))
const stats = computed(() => diffStats(props.rows))
const hunks = computed<DiffHunk[]>(() => buildHunks(props.rows))
const label = computed(() =>
  props.mode === 'ab' ? L.snapshotCompareAB : L.snapshotCompareWithSelected,
)

/** 摘取成功微态：短暂高亮对应变更段，给即时反馈（定时器随组件卸载清理） */
const pickedHi = ref<number | null>(null)
let pickedTimer: ReturnType<typeof setTimeout> | null = null
function onPick(text: string, hi: number): void {
  emit('pick', text)
  pickedHi.value = hi
  if (pickedTimer) clearTimeout(pickedTimer)
  pickedTimer = setTimeout(() => {
    pickedHi.value = null
  }, PICK_HILITE_MS)
}

onBeforeUnmount(() => {
  if (pickedTimer) clearTimeout(pickedTimer)
})
</script>

<template>
  <!-- diff 预览（cherry-pick 单位 = 每个变更段 hunk） -->
  <div class="snap__diff">
    <div class="diff__head">
      <span class="diff__mode">{{ label }}</span>
      <span v-if="hasDiff" class="diff__stat">
        <b class="stat--add">+{{ stats.add }}</b>
        <b class="stat--del">−{{ stats.del }}</b>
      </span>
      <span v-if="hasDiff" class="diff__src" :title="L.snapshotPickTip">{{ L.snapshotDiffSource.replace('{src}', source) }}</span>
      <span class="diff__views" v-if="hasDiff">
        <button type="button" class="vbtn vbtn--mini" :class="{ on: view === 'unified' }" @click="emit('update:view', 'unified')">{{ L.snapshotViewUnified }}</button>
        <button type="button" class="vbtn vbtn--mini" :class="{ on: view === 'split' }" @click="emit('update:view', 'split')">{{ L.snapshotViewSplit }}</button>
      </span>
      <button v-if="mode === 'ab'" type="button" class="diff__clear" :title="L.snapshotClearCompare" @click="emit('clear')">
        <Icon name="x" :size="12" />
      </button>
    </div>

    <div v-if="!hasDiff" class="diff__none">— {{ L.snapshotNoDiff }} —</div>
    <div v-else class="diff">
      <div
        v-for="(hunk, hi) in hunks"
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
        <pre v-if="view === 'unified'" class="hunk__code"><span
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
</template>

<style scoped>
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
</style>
