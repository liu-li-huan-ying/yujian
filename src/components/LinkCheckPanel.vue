<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import type { BrokenLinkItem, BrokenLinkReport } from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  vaultPath: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open', path: string): void
}>()

const report = ref<BrokenLinkReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const hasResult = computed(() => report.value !== null)

const summary = computed(() => {
  const r = report.value
  if (!r) return ''
  return L.linkCheckSummary
    .replace('{n}', String(r.scanned))
    .replace('{m}', String(r.total))
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

async function run(): Promise<void> {
  if (!props.vaultPath) {
    error.value = L.linkCheckNoVault
    return
  }
  loading.value = true
  error.value = null
  try {
    report.value = await window.api.checkLinks(props.vaultPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(run)
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

    <p v-if="loading" class="lc__empty">{{ L.linkCheckScanning }}</p>
    <p v-else-if="error" class="lc__empty lc__empty--err">{{ error }}</p>
    <p v-else-if="hasResult && report!.total === 0" class="lc__empty">{{ L.linkCheckEmpty }}</p>

    <template v-else-if="hasResult">
      <p class="lc__summary">{{ summary }}</p>
      <div class="lc__list">
        <button
          v-for="(it, i) in report!.items"
          :key="i"
          type="button"
          class="row"
          :title="`${it.raw}\n${it.file}`"
          @click="emit('open', it.file)"
        >
          <span class="row__kind" :class="`row__kind--${it.kind}`">{{ kindLabel[it.kind] }}</span>
          <span class="row__main">
            <span class="row__file">{{ fileBase(it.file) }}</span>
            <span class="row__line">:{{ it.line }}</span>
            <span class="row__target">{{ it.target }}</span>
          </span>
          <span class="row__dir">{{ fileDir(it.file) }}</span>
        </button>
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
  width: 360px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  background: var(--bg-hover);
  color: var(--hue-text-1);
}
.lc__rerun:disabled {
  opacity: 0.4;
  cursor: default;
}

.lc__empty {
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 22px 8px;
  line-height: 1.6;
}
.lc__empty--err {
  color: var(--hue-danger, #f34f45);
}

.lc__summary {
  margin: 0;
  font-size: 12px;
  color: var(--hue-text-2);
}

.lc__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.row:hover {
  background: var(--hue-surface-2);
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

.row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
}
.row__file {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.row__line {
  font-size: 11px;
  color: var(--hue-accent);
  font-variant-numeric: tabular-nums;
}
.row__target {
  flex-basis: 100%;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__dir {
  flex: 0 0 auto;
  max-width: 38%;
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
