<script setup lang="ts">
import { errMsg } from '../../electron/shared/error'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useI18n } from '../i18n'
import type {
  IntegrityReport,
  IntegrityCategory,
  IntegrityIssue,
  SoftErrorReport
} from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{ vaultPath: string | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'report', report: IntegrityReport | null): void
  /** 某篇损坏文档已还原为历史版本（宿主据此刷新编辑器 / 索引 / 内容地图） */
  (e: 'healed', payload: { file: string; content: string }): void
}>()

const report = ref<IntegrityReport | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const filter = ref<'all' | IntegrityCategory>('all')
const confirmOpen = ref(false)

// 软错误（已知可容忍失败）：主进程里被 catch 吞掉、但不该无声消失在黑洞里的 IO 失败
const soft = ref<SoftErrorReport | null>(null)
const softOpen = ref(false)

const hasResult = computed(() => report.value !== null)
const repairable = computed(() => report.value?.repairable ?? false)
const softWarn = computed(() => soft.value?.warnCount ?? 0)

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
    { key: 'broken-link' as const, label: L.integrityCatLink, count: c?.['broken-link'] ?? 0 },
    {
      key: 'corrupted-markdown' as const,
      label: L.integrityCatCorrupt,
      count: c?.['corrupted-markdown'] ?? 0
    }
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
  'broken-link': L.integrityCatLink,
  'corrupted-markdown': L.integrityCatCorrupt
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
    // 软错误是进程级、与 vault 无关，独立拉取并互不阻塞
    void loadSoft()
    filter.value = 'all'
    emit('report', report.value)
  } catch (e) {
    error.value = errMsg(e)
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
    error.value = errMsg(e)
    loading.value = false
  }
}

/* ── 损坏文档自愈：把某篇文档的磁盘内容还原为指定快照（损坏前那一份）── */

/** 是否有可一键还原的损坏文档（决定「自愈」区块是否显示） */
const corrupted = computed<IntegrityIssue[]>(() =>
  (report.value?.issues ?? []).filter((i) => i.category === 'corrupted-markdown' && i.snapshotId)
)

const healingFile = ref<string | null>(null)
async function heal(issue: IntegrityIssue): Promise<void> {
  if (!props.vaultPath || !issue.file || !issue.snapshotId || healingFile.value) return
  healingFile.value = issue.file
  error.value = null
  try {
    const text = await window.api.snapshotRestore(props.vaultPath, issue.file, issue.snapshotId)
    // 还原 = 覆盖磁盘（保真层会把上一版自动备份下来，故这一步本身也是可回滚的）
    await window.api.writeFile(issue.file, text)
    emit('healed', { file: issue.file, content: text })
    await run()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    healingFile.value = null
  }
}

/** 拉取主进程软错误（容错：拉不到就静默，绝不让「观测」本身变成新的故障） */
async function loadSoft(): Promise<void> {
  try {
    soft.value = await window.api.getSoftErrors()
  } catch {
    soft.value = null
  }
}

async function clearSoft(): Promise<void> {
  try {
    await window.api.clearSoftErrors()
    soft.value = null
    softOpen.value = false
  } catch (e) {
    error.value = errMsg(e)
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

    <!-- 损坏文档自愈：检测到序列化写坏的文档时，提供「还原为损坏前那一版」 -->
    <div v-if="!loading && corrupted.length > 0" class="hl">
      <div class="hl__head">
        <Icon name="alert" :size="13" class="hl__icon" />
        <span class="hl__title">{{ L.integrityHealTitle }}</span>
        <span class="hl__badge">{{ corrupted.length }}</span>
      </div>
      <p class="hl__hint">{{ L.integrityHealHint }}</p>
      <div v-for="(it, i) in corrupted" :key="i" class="hl__row">
        <span class="hl__file">{{ fileBase(it.file) }}</span>
        <span class="hl__detail">{{ it.detail }}</span>
        <button
          class="hl__btn"
          type="button"
          :disabled="healingFile !== null"
          @click="heal(it)"
        >
          {{ healingFile === it.file ? L.integrityHealing : L.integrityHeal }}
        </button>
      </div>
    </div>

    <!-- 软错误：主进程里被 catch 吞掉但不该消失的 IO 失败（索引落盘 / 快照搬运 / 附件迁移…） -->
    <div v-if="soft && soft.summary.length > 0" class="sw">
      <button class="sw__head" type="button" @click="softOpen = !softOpen">
        <Icon name="alert" :size="13" class="sw__icon" />
        <span class="sw__title">{{ L.integritySoftErrors }}</span>
        <span v-if="softWarn > 0" class="sw__badge">{{ softWarn }}</span>
        <Icon
          :name="softOpen ? 'chevron-down' : 'chevron-right'"
          :size="13"
          class="sw__chev"
        />
      </button>
      <p class="sw__hint">{{ L.integritySoftHint }}</p>
      <div v-if="softOpen" class="sw__list">
        <div v-for="s in soft.summary" :key="s.level + s.scope" class="sw__row">
          <span class="sw__sev" :class="s.level === 'warn' ? 'sw__sev--warn' : 'sw__sev--dbg'" />
          <span class="sw__scope">{{ s.scope }}</span>
          <span class="sw__n">×{{ s.count }}</span>
          <span class="sw__msg">{{ s.lastMessage }}</span>
        </div>
      </div>
      <div v-if="softOpen" class="sw__acts">
        <button class="sw__clear" type="button" @click="clearSoft">
          {{ L.integritySoftClear }}
        </button>
      </div>
    </div>

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
  /* 走令牌而非写死 #5fa8a0：换皮肤 / 幻色时徽章必须跟着走，
     否则「青瓷」之外的主题上这枚徽章会突兀地卡在旧色。 */
  color: var(--hue-on-accent);
  background: var(--hue-accent);
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
  color: var(--hue-on-accent);
}
.btn--primary:hover:not(:disabled) {
  filter: brightness(1.06);
  background: var(--hue-accent);
}
/* ── 损坏文档自愈 ── */
.hl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--hue-danger);
  border-radius: var(--radius-sm);
}
.hl__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hl__icon {
  flex: 0 0 auto;
  color: rgb(var(--hue-mark));
}
.hl__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.hl__badge {
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
}
.hl__hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--hue-text-3);
}
.hl__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hl__file {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--hue-text-1);
}
.hl__detail {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--hue-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hl__btn {
  flex: 0 0 auto;
  padding: 2px 9px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-1);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: filter var(--dur-fast) var(--ease);
}
.hl__btn:hover:not(:disabled) {
  filter: brightness(1.06);
  background: var(--hue-accent);
  border-color: var(--hue-accent);
}
.hl__btn:disabled {
  opacity: 0.5;
  cursor: default;
}
/* 软错误（已知可容忍失败） */
.sw {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
}
.sw__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.sw__icon {
  flex: 0 0 auto;
  color: var(--hue-mark);
}
.sw__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.sw__badge {
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
}
.sw__chev {
  margin-left: auto;
  color: var(--hue-text-3);
}
.sw__hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--hue-text-3);
}
.sw__list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 132px;
  overflow: auto;
}
.sw__row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
}
.sw__sev {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.sw__sev--warn {
  background: rgb(var(--hue-mark));
}
.sw__sev--dbg {
  background: var(--hue-text-3);
  opacity: 0.5;
}
.sw__scope {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--hue-text-3);
}
.sw__n {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--hue-text-3);
}
.sw__msg {
  flex: 1;
  min-width: 0;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sw__acts {
  display: flex;
  justify-content: flex-end;
}
.sw__clear {
  padding: 2px 8px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.sw__clear:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}
</style>
