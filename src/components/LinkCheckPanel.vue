<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import type { BrokenLinkItem, BrokenLinkKind, BrokenLinkReport } from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  vaultPath: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open', item: BrokenLinkItem): void
  /** 断链目标一键创建：由 App 建笔记并打开，成功后回调本面板 refresh() 复检 */
  (e: 'create', item: BrokenLinkItem): void
}>()

const report = ref<BrokenLinkReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const filter = ref<'all' | BrokenLinkKind>('all')

const hasResult = computed(() => report.value !== null)

const summary = computed(() => {
  const r = report.value
  if (!r) return ''
  return L.linkCheckSummary.replace('{n}', String(r.scanned)).replace('{m}', String(r.total))
})

/** 按类型统计，用于汇总拆分展示 */
const counts = computed<Record<BrokenLinkKind, number>>(() => {
  const c: Record<BrokenLinkKind, number> = { wikilink: 0, mdlink: 0, image: 0 }
  if (report.value) for (const it of report.value.items) c[it.kind]++
  return c
})

const breakdown = computed(() => {
  const c = counts.value
  return L.linkCheckBreakdown
    .replace('{w}', String(c.wikilink))
    .replace('{l}', String(c.mdlink))
    .replace('{i}', String(c.image))
})

const filters = computed(() => [
  { key: 'all' as const, label: L.linkCheckFilterAll, count: report.value?.total ?? 0 },
  { key: 'wikilink' as const, label: L.linkKindWiki, count: counts.value.wikilink },
  { key: 'mdlink' as const, label: L.linkKindLink, count: counts.value.mdlink },
  { key: 'image' as const, label: L.linkKindImage, count: counts.value.image }
])

const filtered = computed<BrokenLinkItem[]>(() => {
  const r = report.value
  if (!r) return []
  return filter.value === 'all' ? r.items : r.items.filter((it) => it.kind === filter.value)
})

const kindLabel: Record<BrokenLinkItem['kind'], string> = {
  wikilink: L.linkKindWiki,
  mdlink: L.linkKindLink,
  image: L.linkKindImage
}

function fileBase(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}
function fileDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}
function rowTitle(it: BrokenLinkItem): string {
  return `${it.raw}\n${L.linkCheckContext}${it.context}\n${L.linkCheckLocate.replace('{n}', String(it.line))}`
}

async function run(): Promise<void> {
  if (!props.vaultPath) {
    error.value = L.linkCheckNoVault
    return
  }
  loading.value = true
  error.value = null
  try {
    report.value = await window.api.checkLinks(props.vaultPath)
    filter.value = 'all'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  void run()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** 供 App 在「一键创建」成功后复检（新建的笔记会让该条断链转为正常） */
defineExpose({ refresh: run })
</script>

<template>
  <div class="lc glass" role="dialog" aria-label="链接健康检查">
    <div class="lc__head">
      <Icon name="link" :size="15" class="lc__icon" />
      <span class="lc__title">{{ L.linkCheck }}</span>
      <span v-if="hasResult && !loading" class="lc__count">{{ report!.total }}</span>
      <button
        class="lc__rerun"
        type="button"
        :title="L.linkCheckRerun"
        :disabled="loading || !vaultPath"
        @click="run"
      >
        <Icon name="history" :size="13" />
      </button>
      <button class="lc__x" type="button" :title="L.linkCheckClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <!-- 类型筛选 -->
    <div v-if="hasResult && !loading && report!.total > 0" class="lc__filters">
      <button
        v-for="f in filters"
        :key="f.key"
        type="button"
        class="fchip"
        :class="{ 'fchip--on': filter === f.key }"
        :disabled="f.count === 0"
        @click="filter = f.key"
      >
        {{ f.label }}
        <span class="fchip__n">{{ f.count }}</span>
      </button>
    </div>

    <p v-if="loading" class="lc__empty">
      <Icon name="loader" :size="16" class="lc__spin" />
      {{ L.linkCheckScanning }}
    </p>
    <p v-else-if="error" class="lc__empty lc__empty--err">
      <Icon name="unlink" :size="16" />
      {{ error }}
    </p>
    <p v-else-if="hasResult && report!.total === 0" class="lc__empty lc__empty--ok">
      <Icon name="check" :size="16" />
      {{ L.linkCheckEmpty }}
    </p>

    <template v-else-if="hasResult">
      <div class="lc__summary">
        <span>{{ summary }}</span>
        <span class="lc__break">{{ breakdown }}</span>
      </div>
      <div class="lc__list">
        <div v-for="(it, i) in filtered" :key="i" class="row">
          <button type="button" class="row__main" :title="rowTitle(it)" @click="emit('open', it)">
            <span class="row__kind" :class="`row__kind--${it.kind}`">{{ kindLabel[it.kind] }}</span>
            <span class="row__body">
              <span class="row__top">
                <span class="row__file">{{ fileBase(it.file) }}</span>
                <span class="row__line">:{{ it.line }}</span>
              </span>
              <span class="row__target">{{ it.target }}</span>
              <span class="row__ctx">{{ it.context }}</span>
            </span>
            <span class="row__dir">{{ fileDir(it.file) }}</span>
          </button>
          <!-- 只有笔记链接能「一键创建」：图片/附件缺失靠创建空文件无意义 -->
          <button
            v-if="it.kind === 'wikilink'"
            type="button"
            class="row__act"
            :title="L.linkCheckCreate"
            @click="emit('create', it)"
          >
            <Icon name="plus" :size="13" />
          </button>
        </div>
      </div>
      <p class="lc__hint">{{ L.linkCheckHint }}</p>
    </template>
  </div>
</template>

<style scoped>
.lc {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 30;
  width: 372px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: lc-in 0.18s var(--ease, ease) both;
}
@keyframes lc-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.lc__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lc__icon {
  color: var(--hue-accent);
}
.lc__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.lc__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-on-accent);
  background: var(--hue-danger, #f34f45);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 18px;
  text-align: center;
}
.lc__rerun,
.lc__x {
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
.lc__rerun {
  margin-left: auto;
}
.lc__x {
  margin-left: 2px;
}
.lc__rerun:hover:not(:disabled),
.lc__x:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.14));
  color: var(--hue-text-1);
}
.lc__rerun:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 类型筛选 */
.lc__filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.fchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 999px;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast, 0.12s) var(--ease, ease),
    color var(--dur-fast, 0.12s) var(--ease, ease),
    border-color var(--dur-fast, 0.12s) var(--ease, ease);
}
.fchip:hover:not(:disabled) {
  border-color: var(--hue-accent);
  color: var(--hue-text-1);
}
.fchip--on {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
  color: var(--hue-on-accent);
}
.fchip:disabled {
  opacity: 0.4;
  cursor: default;
}
.fchip__n {
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  opacity: 0.8;
}

.lc__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 22px 8px;
  line-height: 1.6;
}
.lc__empty--err {
  color: var(--hue-danger, #f34f45);
}
.lc__empty--ok {
  color: #6fcf97;
}
.lc__spin {
  animation: lc-spin 0.9s linear infinite;
}
@keyframes lc-spin {
  to {
    transform: rotate(360deg);
  }
}

.lc__summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--hue-text-2);
}
.lc__break {
  font-size: 11px;
  color: var(--hue-text-3);
}

.lc__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 行容器：把「跳转」与「一键创建」两个动作并排装下，故 .row 从按钮降为容器 */
.row {
  display: flex;
  align-items: stretch;
  gap: 2px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  transition:
    background var(--dur-fast, 0.12s) var(--ease, ease),
    border-color var(--dur-fast, 0.12s) var(--ease, ease);
}
.row:hover {
  background: var(--hue-surface-2);
  border-color: var(--hue-accent);
}
.row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
}
/* 一键创建：默认压得很轻，只在悬停该行时才浮出来，避免每行一个加号把列表变噪 */
.row__act {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  margin: 5px 5px 5px 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  opacity: 0;
  cursor: pointer;
  transition:
    background var(--dur-fast, 0.12s) var(--ease, ease),
    color var(--dur-fast, 0.12s) var(--ease, ease),
    opacity var(--dur-fast, 0.12s) var(--ease, ease);
}
.row:hover .row__act {
  opacity: 1;
  border-color: var(--hue-border-subtle);
}
.row__act:hover {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
  color: var(--hue-on-accent);
}
.row__act:focus-visible {
  opacity: 1;
  outline: none;
  border-color: var(--hue-accent);
}

.row__kind {
  flex: 0 0 auto;
  margin-top: 1px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: 999px;
  color: #fff;
}
.row__kind--wikilink {
  background: #6a8caf;
}
.row__kind--mdlink {
  background: #5fa8a0;
}
.row__kind--image {
  background: #b08968;
}

.row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.row__top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.row__file {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__line {
  font-size: 11px;
  color: var(--hue-accent);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.row__target {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__ctx {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--hue-text-3);
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-left: 2px solid var(--hue-border-subtle);
  padding-left: 6px;
}
.row__dir {
  flex: 0 0 auto;
  max-width: 36%;
  font-size: 10.5px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  align-self: center;
}

.lc__hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--hue-text-3);
}
</style>
