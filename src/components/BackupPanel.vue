<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useI18n } from '../i18n'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{ vaultPath: string | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  /** 恢复完成：交由 App 重载当前文档并抑制「外部修改」误报 */
  (e: 'after-restore'): void
}>()

type Phase = 'idle' | 'busy' | 'done' | 'error'

const phase = ref<Phase>('idle')
const busyLabel = ref('')
const error = ref<string | null>(null)
const result = ref<{ files: number; bytes: number; skipped: string[]; kind: 'backup' | 'restore' } | null>(null)
const confirmOpen = ref(false)

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const resultText = computed(() => {
  if (!result.value) return ''
  const r = result.value
  if (r.kind === 'backup') {
    const base = L.backupDone.replace('{n}', String(r.files)).replace('{size}', formatBytes(r.bytes))
    return r.skipped.length
      ? `${base} · ${L.backupSkipped.replace('{n}', String(r.skipped.length))}`
      : base
  }
  const base = L.backupRestoreDone.replace('{n}', String(r.files)).replace('{size}', formatBytes(r.bytes))
  return r.skipped.length
    ? `${base} · ${L.backupSkipped.replace('{n}', String(r.skipped.length))}`
    : base
})

async function doBackup(): Promise<void> {
  if (!props.vaultPath) {
    error.value = L.backupNoVault
    return
  }
  const dest = await window.api.saveFileDialog(`${basename(props.vaultPath) || 'vault'}-backup.zip`)
  if (!dest) return
  phase.value = 'busy'
  busyLabel.value = L.backupRunning
  error.value = null
  try {
    const res = await window.api.backupVault(props.vaultPath, dest)
    result.value = { files: res.files, bytes: res.bytes, skipped: [], kind: 'backup' }
    phase.value = 'done'
  } catch (e) {
    error.value = L.backupFailed.replace('{e}', e instanceof Error ? e.message : String(e))
    phase.value = 'error'
  }
}

function requestRestore(): void {
  confirmOpen.value = true
}

async function doRestore(): Promise<void> {
  confirmOpen.value = false
  if (!props.vaultPath) return
  const zip = await window.api.openFileDialog()
  if (!zip) return
  phase.value = 'busy'
  busyLabel.value = L.backupRunning
  error.value = null
  try {
    const res = await window.api.restoreVault(zip, props.vaultPath)
    result.value = { files: res.files, bytes: res.bytes, skipped: res.skipped, kind: 'restore' }
    phase.value = 'done'
    // 恢复会改写在库文件，交由 App 重载当前文档并抑制「外部修改」误报
    emit('after-restore')
  } catch (e) {
    error.value = L.backupFailed.replace('{e}', e instanceof Error ? e.message : String(e))
    phase.value = 'error'
  }
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && phase.value !== 'busy') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="bk glass" role="dialog" aria-label="整库备份">
    <div class="bk__head">
      <Icon name="archive" :size="15" class="bk__icon" />
      <span class="bk__title">{{ L.backup }}</span>
      <button class="bk__x" type="button" :title="L.backupClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <p class="bk__desc">{{ L.backupTitleDesc }}</p>

    <div class="bk__acts">
      <button
        class="btn"
        type="button"
        :disabled="phase === 'busy' || !vaultPath"
        @click="doBackup"
      >
        <Icon name="download" :size="13" />
        {{ L.backupCreate }}
      </button>
      <button
        class="btn"
        type="button"
        :disabled="phase === 'busy' || !vaultPath"
        @click="requestRestore"
      >
        <Icon name="history" :size="13" />
        {{ L.backupRestore }}
      </button>
    </div>

    <p v-if="phase === 'busy'" class="bk__empty">
      <Icon name="loader" :size="16" class="bk__spin" />
      {{ busyLabel }}
    </p>
    <p v-else-if="phase === 'error'" class="bk__empty bk__empty--err">
      <Icon name="alert" :size="16" />
      {{ error }}
    </p>
    <p v-else-if="phase === 'done'" class="bk__result">
      <Icon name="check" :size="16" />
      {{ resultText }}
    </p>

    <ConfirmDialog
      :open="confirmOpen"
      :title="L.backupRestore"
      :message="L.backupRestoreConfirm"
      :confirm-label="L.backupRestore"
      danger
      @confirm="doRestore"
      @cancel="confirmOpen = false"
    />
  </div>
</template>

<style scoped>
.bk {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 30;
  width: 320px;
  max-width: calc(100% - 32px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: bk-in 0.18s var(--ease, ease) both;
}
@keyframes bk-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bk__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bk__icon {
  color: var(--hue-accent);
}
.bk__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.bk__x {
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
.bk__x:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.14));
  color: var(--hue-text-1);
}

.bk__desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--hue-text-3);
}

.bk__acts {
  display: flex;
  gap: 8px;
}
.btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
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
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.bk__empty {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--hue-text-3);
  padding: 4px 2px;
}
.bk__empty--err {
  color: var(--hue-danger, #f34f45);
}
.bk__result {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #6fcf97;
  padding: 4px 2px;
  line-height: 1.5;
}
.bk__spin {
  animation: bk-spin 0.9s linear infinite;
}
@keyframes bk-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
