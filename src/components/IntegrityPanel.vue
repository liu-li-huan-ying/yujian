<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useI18n } from '../i18n'
import type {
  IntegrityReport,
  IntegrityCategory,
  IntegrityIssue
} from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{ vaultPath: string | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'report', report: IntegrityReport | null): void
}>()

const report = ref<IntegrityReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const filter = ref<'all' | IntegrityCategory>('all')
const confirmOpen = ref(false)

const hasResult = computed(() => report.value !== null)
const repairable = computed(() => report.value?.repairable ?? false)

const filters = computed(() => {
  const c = report.value?.counts
  return [
    { key: 'all' as const, label: L.integrityFilterAll, count: report.value?.total ?? 0 },
    { key: 'index' as const, label: L.integrityCatIndex, count: c?.index ?? 0 },
    { key: 'orphan-snapshot' as const, label: L.integrityCatOrphan, count: c?.['orphan-snapshot'] ?? 0 },
    {
      key: 'missing-attachment' as const,
      label: L.integrityCatAttachment,
      count: c?.['missing-attachment'] ?? 0
    },
    { key: 'broken-link' as const, label: L.integrityCatLink, count: c?.['broken-link'] ?? 0 }
  ]
})

const filtered = computed<IntegrityIssue[]>(() => {
  const r = report.value
  if (!r) return []
  return filter.value === 'all' ? r.issues : r.issues.filter((i) => i.category === filter.value)
})

const catLabel: Record<IntegrityCategory, string> = {
  index: L.integrityCatIndex,
  'orphan-snapshot': L.integrityCatOrphan,
  'missing-attachment': L.integrityCatAttachment,
  'broken-link': L.integrityCatLink
}

function fileBase(p?: string): string {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}
function fileDir(p?: string): string {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

async function run(): Promise<void> {
  if (!props.vaultPath) {
    error.value = L.integrityNoVault
    return
  }
  loading.value = true
  error.value = null
  try {
    report.value = await window.api.checkIntegrity(props.vaultPath)
    filter.value = 'all'
    emit('report', report.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function requestRepair(): void {
  if (!repairable.value) return
  confirmOpen.value = true
}

async function doRepair(): Promise<void> {
  confirmOpen.value = false
  if (!props.vaultPath) return
  loading.value = true
  error.value = null
  try {
    await window.api.repairIntegrity(props.vaultPath, ['rebuildIndex', 'removeOrphanSnapshots'])
    await run()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
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
</script>

<template>
  <div class="ic glass" role="dialog" aria-label="完整性自检">
    <div class="ic__head">
      <Icon name="shield" :size="15" class="ic__icon" />
      <span class="ic__title">{{ L.integrity }}</span>
      <span v-if="hasResult && !loading && report!.total > 0" class="ic__count">{{ report!.total }}</span>
      <button
        class="ic__rerun"
        type="button"
        :title="L.integrityRerun"
        :disabled="loading || !vaultPath"
        @click="run"
      >
        <Icon name="history" :size="13" />
      </button>
      <button class="ic__x" type="button" :title="L.integrityClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <div v-if="hasResult && !loading && report!.total > 0" class="ic__filters">
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

    <p v-if="loading" class="ic__empty">
      <Icon name="loader" :size="16" class="ic__spin" />
      {{ L.integrityScanning }}
    </p>
    <p v-else-if="error" class="ic__empty ic__empty--err">
      <Icon name="alert" :size="16" />
      {{ error }}
    </p>
    <p v-else-if="hasResult && report!.total === 0" class="ic__empty ic__empty--ok">
      <Icon name="check" :size="16" />
      {{ L.integrityEmpty }}
    </p>

    <template v-else-if="hasResult">
      <div class="ic__list">
        <div v-for="(it, i) in filtered" :key="i" class="row">
          <span class="row__sev" :class="it.severity === 'error' ? 'row__sev--err' : 'row__sev--warn'" />
          <span class="row__cat">{{ catLabel[it.category] }}</span>
          <span class="row__body">
            <span class="row__top">
              <span class="row__file">{{ fileBase(it.file) }}</span>
            </span>
            <span v-if="it.detail" class="row__detail">{{ it.detail }}</span>
          </span>
          <span class="row__dir">{{ fileDir(it.file) }}</span>
        </div>
      </div>
      <p v-if="!repairable" class="ic__hint">{{ L.integrityReportOnly }}</p>
    </template>

    <div v-if="hasResult && !loading" class="ic__acts">
      <span class="ic__spacer" />
      <button
        class="btn btn--primary"
        type="button"
        :disabled="!repairable"
        :title="repairable ? '' : L.integrityNothingToRepair"
        @click="requestRepair"
      >
        {{ L.integrityRepair }}
      </button>
    </div>

    <ConfirmDialog
      :open="confirmOpen"
      :title="L.integrityRepair"
      :message="L.integrityRepairConfirm"
      :confirm-label="L.integrityRepair"
      danger
      @confirm="doRepair"
      @cancel="confirmOpen = false"
    />
  </div>
</template>

<style scoped>
.ic {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 30;
  width: 520px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: ic-in 0.18s var(--ease, ease) both;
}
@keyframes ic-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ic__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ic__icon {
  color: var(--hue-accent);
}
.ic__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.ic__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-on-accent);
  background: var(--hue-danger, #f34f45);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 18px;
  text-align: center;
}
.ic__rerun,
.ic__x {
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
.ic__rerun {
  margin-left: auto;
}
.ic__x {
  margin-left: 2px;
}
.ic__rerun:hover:not(:disabled),
.ic__x:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.14));
  color: var(--hue-text-1);
}
.ic__rerun:disabled {
  opacity: 0.4;
  cursor: default;
}

.ic__filters {
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

.ic__empty {
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
.ic__empty--err {
  color: var(--hue-danger, #f34f45);
}
.ic__empty--ok {
  color: #6fcf97;
}
.ic__spin {
  animation: ic-spin 0.9s linear infinite;
}
@keyframes ic-spin {
  to {
    transform: rotate(360deg);
  }
}

.ic__list {
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
  text-align: left;
}
.row:hover {
  background: var(--hue-surface-2);
  border-color: var(--hue-accent);
}
.row__sev {
  flex: 0 0 auto;
  margin-top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.row__sev--err {
  background: var(--hue-danger, #f34f45);
}
.row__sev--warn {
  background: rgb(var(--hue-mark));
}
.row__cat {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: 999px;
  color: #fff;
  background: #5fa8a0;
}
.row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.row__file {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__detail {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--hue-text-3);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__dir {
  flex: 0 0 auto;
  max-width: 34%;
  font-size: 10.5px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  align-self: center;
}

.ic__hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--hue-text-3);
}

.ic__acts {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ic__spacer {
  flex: 1;
}
.btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn--primary {
  background: var(--hue-accent);
  border-color: var(--hue-accent);
  color: #fff;
}
.btn--primary:hover:not(:disabled) {
  filter: brightness(1.06);
  background: var(--hue-accent);
}
</style>
