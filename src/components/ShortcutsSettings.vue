<script setup lang="ts">
/**
 * 快捷键设置（批次四 · UI-DESIGN §4.7）
 *
 * 规格：表格 = 命令名（左）· 当前键位（中，键帽胶囊）· 重置（右）；
 * 录入冲突时在行下方给红字 + 「替换 / 取消」；可按命令名过滤；分组与命令面板一致。
 *
 * 与命令面板共用同一份命令目录（`utils/commands.ts`）与同一份绑定状态（`src/shortcuts.ts`），
 * 故这里改完，命令面板上显示的键位与全局派发**立刻**跟着变，不存在第二套事实。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import { COMMANDS, groupCommands, type CommandGroup, type CommandId } from '../utils/commands'
import { eventToCombo, formatCombo, isBindable } from '../utils/keymap'
import {
  RESERVED,
  getBinding,
  getShortcutsVersion,
  isCustomized,
  onShortcutsChange,
  resetAllBindings,
  resetBinding,
  setBinding,
  type Conflict,
} from '../shortcuts'

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const L = t.ui
/** 命令名 / 分组名在 `t.palette` 下（与命令面板同源，不另抄一份） */
const P = t.palette

/** 绑定表版本：任何改动都会顶起它，让下面所有 computed 重算 */
const scVer = ref(getShortcutsVersion())
let unsub: (() => void) | null = null
onMounted(() => {
  unsub = onShortcutsChange(() => {
    scVer.value = getShortcutsVersion()
  })
})
onBeforeUnmount(() => unsub?.())

const query = ref('')
/** 正在录入键位的命令 id（null = 没在录） */
const recordingId = ref<CommandId | null>(null)
const conflict = ref<Conflict | null>(null)
/** 不可绑定时的提示（如只按了一个字母键） */
const invalid = ref('')
const askResetAll = ref(false)

function labelOf(id: CommandId): string {
  const table = P.cmd as unknown as Record<string, string>
  return table[id] ?? id
}

/**
 * 按 i18n 路径取值（保留键位只存路径，不存翻译好的串 —— 切语言要跟着变）。
 * 注意基准是**根节点 `t`**：`labelPath` 用的是 `palette.quickOpen` 这类从根算起的路径，
 * 若从 `L`（= `t.ui`）起算，会去找并不存在的 `t.ui.palette` → 取到 undefined → 名字渲染成空白。
 */
function textByPath(path: string): string {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k]
    return undefined
  }, t as unknown) as string
}

interface Row {
  id: CommandId
  label: string
  keys?: string
  custom: boolean
}

const blocks = computed<{ group: CommandGroup; rows: Row[] }[]>(() => {
  void scVer.value
  const q = query.value.trim().toLowerCase()
  const out: { group: CommandGroup; rows: Row[] }[] = []
  for (const block of groupCommands(COMMANDS)) {
    const rows: Row[] = []
    for (const s of block.specs) {
      const id = s.id as CommandId
      const label = labelOf(id)
      if (q && !label.toLowerCase().includes(q) && !id.toLowerCase().includes(q)) continue
      rows.push({ id, label, keys: getBinding(id), custom: isCustomized(id) })
    }
    if (rows.length > 0) out.push({ group: block.group, rows })
  }
  return out
})

const groupLabel = computed<Record<string, string>>(
  () => P.group as unknown as Record<string, string>,
)

const totalCustom = computed(() => {
  void scVer.value
  return COMMANDS.filter((c) => isCustomized(c.id as CommandId)).length
})

/** 固定键位（不可改）：只列 `app` 类，`system` / `editor` 只在冲突时解释，不占版面 */
const fixedRows = computed(() =>
  RESERVED.filter((r) => r.reason === 'app').map((r) => ({
    combo: r.combo,
    // 兜底成键位串：路径写错时宁可显示「Ctrl+K」，也不要渲染出一个空白名字
    name: (r.labelPath ? textByPath(r.labelPath) : '') || r.combo,
  })),
)

function stopRecord(): void {
  recordingId.value = null
  conflict.value = null
  invalid.value = ''
}

function startRecord(id: CommandId): void {
  if (recordingId.value === id) {
    stopRecord()
    return
  }
  recordingId.value = id
  conflict.value = null
  invalid.value = ''
}

/** 录入态的按键接管：捕获阶段 + 拦截传播，避免被全局快捷键抢走 */
function onRecordKey(e: KeyboardEvent): void {
  const id = recordingId.value
  if (!id) return
  // Tab 放行：录入态不该把键盘用户困住（可 Tab 去点「取消」，Esc 也能退）
  if (e.key === 'Tab') return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopRecord()
    return
  }
  // Delete / Backspace = 清除绑定（录入态下它们没有「删字」语义）
  if (e.key === 'Delete' || e.key === 'Backspace') {
    setBinding(id, '')
    stopRecord()
    return
  }
  const combo = eventToCombo(e)
  if (!combo) return
  if (!isBindable(combo)) {
    invalid.value = L.scNoModifier
    conflict.value = null
    return
  }
  const res = setBinding(id, formatCombo(combo))
  if (res.ok) stopRecord()
  else {
    conflict.value = res.conflict
    invalid.value = ''
  }
}

/** Esc 关面板：但录入态下第一下 Esc 是「取消录入」，第二下才关（避免误关丢掉正在录的键） */
function onEsc(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || recordingId.value) return
  emit('close')
}

watch(recordingId, (id) => {
  if (id) window.addEventListener('keydown', onRecordKey, true)
  else window.removeEventListener('keydown', onRecordKey, true)
})
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onRecordKey, true)
  window.removeEventListener('keydown', onEsc)
})

function conflictName(c: Conflict): string {
  if (c.kind === 'command') return labelOf(c.id)
  return c.entry.labelPath ? textByPath(c.entry.labelPath) : c.entry.combo
}

function conflictReason(c: Conflict): string {
  if (c.kind !== 'reserved') return L.scConflict.replace('{name}', conflictName(c))
  if (c.entry.reason === 'app') return L.scReservedApp.replace('{name}', conflictName(c))
  if (c.entry.reason === 'editor') return L.scReservedEditor
  return L.scReservedSystem
}

function applyReplace(): void {
  const id = recordingId.value
  const c = conflict.value
  if (!id || !c || c.kind !== 'command') return
  setBinding(id, c.combo, { steal: true })
  stopRecord()
}

function doResetAll(): void {
  resetAllBindings()
  askResetAll.value = false
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel glass" role="dialog" aria-modal="true" :aria-label="L.shortcuts">
      <header class="panel__head">
        <h2 class="panel__title">{{ L.shortcuts }}</h2>
        <button class="panel__close" type="button" :title="L.scClose" @click="emit('close')">
          {{ L.scClose }}
        </button>
      </header>

      <p class="intro">{{ L.scIntro }}</p>

      <input
        v-model="query"
        class="search"
        type="text"
        :placeholder="L.scSearch"
        :aria-label="L.scSearch"
        @focus="stopRecord()"
      />

      <div class="scroll">
        <section v-for="b in blocks" :key="b.group" class="grp">
          <h4 class="grp__title">{{ groupLabel[b.group] ?? b.group }}</h4>
          <div v-for="r in b.rows" :key="r.id" class="row">
            <div class="row__main">
              <span class="row__name">{{ r.label }}</span>
              <span v-if="r.custom" class="row__badge">{{ L.scCustom }}</span>
            </div>
            <button
              class="cap"
              type="button"
              :class="{ 'cap--rec': recordingId === r.id, 'cap--none': !r.keys }"
              @click="startRecord(r.id)"
            >
              {{ recordingId === r.id ? L.scRecord : r.keys || L.scNone }}
            </button>
            <button
              class="reset"
              type="button"
              :disabled="!r.custom"
              :title="L.scReset"
              @click="resetBinding(r.id)"
            >
              {{ L.scReset }}
            </button>

            <template v-if="recordingId === r.id">
              <p v-if="!conflict && !invalid" class="hint">{{ L.scRecordHint }}</p>
              <p v-if="invalid" class="err">{{ invalid }}</p>
              <div v-if="conflict" class="cf">
                <span class="cf__txt">{{ conflictReason(conflict) }}</span>
                <button
                  v-if="conflict.kind === 'command'"
                  class="cf__btn cf__btn--on"
                  type="button"
                  @click="applyReplace"
                >
                  {{ L.scReplace }}
                </button>
                <button class="cf__btn" type="button" @click="stopRecord">{{ L.scCancel }}</button>
              </div>
            </template>
          </div>
        </section>

        <p v-if="blocks.length === 0" class="empty">{{ L.scEmpty }}</p>

        <section class="grp grp--fixed">
          <h4 class="grp__title">{{ L.scFixedTitle }}</h4>
          <div v-for="f in fixedRows" :key="f.combo" class="row row--fixed">
            <div class="row__main">
              <span class="row__name">{{ f.name }}</span>
            </div>
            <span class="cap cap--fixed">{{ f.combo }}</span>
          </div>
          <p class="fixedhint">{{ L.scFixedHint }}</p>
        </section>
      </div>

      <footer class="foot">
        <span class="foot__count">
          {{ totalCustom > 0 ? `${L.scCustom} ${totalCustom}` : '' }}
        </span>
        <button v-if="!askResetAll" class="foot__btn" type="button" @click="askResetAll = true">
          {{ L.scResetAll }}
        </button>
        <template v-else>
          <span class="foot__ask">{{ L.scResetAllAsk }}</span>
          <button class="foot__btn foot__btn--on" type="button" @click="doResetAll">
            {{ L.scResetAllYes }}
          </button>
          <button class="foot__btn" type="button" @click="askResetAll = false">
            {{ L.scCancel }}
          </button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 62;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
}

.panel {
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: 74vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  padding: 18px 20px 14px;
  color: var(--hue-text-1);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.panel__close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.panel__close:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.intro {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--hue-text-3);
}

.search {
  flex: 0 0 auto;
  width: 100%;
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 8px;
  background: var(--hue-highlight);
  color: var(--hue-text-1);
  font-size: 12.5px;
  outline: none;
  transition: border-color var(--dur-fast) var(--ease);
}

.search:focus {
  border-color: var(--hue-accent);
}

.scroll {
  flex: 1 1 auto;
  margin-top: 12px;
  overflow-y: auto;
  padding-right: 4px;
}

.grp {
  margin-bottom: 14px;
}

.grp__title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--hue-text-3);
  letter-spacing: 0.05em;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 5px 8px;
  border-radius: 8px;
  transition: background var(--dur-fast) var(--ease);
}

.row:hover {
  background: var(--hue-highlight);
}

.row__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.row__name {
  font-size: 12.5px;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__badge {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  /* 注意：`--hue-accent` 是**完整色值**（如 #5fa8a0），不能塞进 rgba()；
     要「强调色的半透明底」只能用三元组令牌（--hue-tint-*）或现成的 --hue-active。 */
  background: var(--hue-active);
  color: var(--hue-accent);
  font-size: 10px;
}

/* 键位胶囊：点它进入录入态 */
.cap {
  flex: 0 0 auto;
  min-width: 76px;
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: rgba(var(--hue-key), 0.16);
  color: var(--hue-text-2);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.cap:hover {
  color: var(--hue-text-1);
}

/* 未绑定：弱化成虚线空槽，一眼看出「没设」而不是「设了个空」 */
.cap--none {
  background: transparent;
  border: 1px dashed var(--hue-border-subtle);
  color: var(--hue-text-3);
}

.cap--rec {
  /* 同上：强调色本身是完整色值，半透明底走 --hue-active */
  background: var(--hue-active);
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}

.cap--fixed {
  background: transparent;
  border: 1px solid var(--hue-border-subtle);
  color: var(--hue-text-3);
  cursor: default;
}

.reset {
  flex: 0 0 auto;
  width: 46px;
  padding: 3px 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--hue-text-3);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.reset:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.reset:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hint,
.err {
  flex: 1 0 100%;
  margin: 2px 0 4px;
  font-size: 11px;
  color: var(--hue-text-3);
}

.err {
  color: var(--hue-danger);
}

.cf {
  flex: 1 0 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 4px;
  flex-wrap: wrap;
}

.cf__txt {
  flex: 1 1 auto;
  /* UI-DESIGN §4.7 规格：冲突红字 12px */
  font-size: 12px;
  color: var(--hue-danger);
}

.cf__btn {
  flex: 0 0 auto;
  padding: 2px 9px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 5px;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.cf__btn:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.cf__btn--on {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}

.empty {
  margin: 6px 0 14px;
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
}

.fixedhint {
  margin: 6px 8px 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--hue-text-3);
}

.foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hue-border-subtle);
}

.foot__count {
  flex: 1 1 auto;
  font-size: 11px;
  color: var(--hue-text-3);
}

.foot__ask {
  font-size: 11.5px;
  color: var(--hue-text-2);
}

.foot__btn {
  flex: 0 0 auto;
  padding: 4px 11px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: 6px;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.foot__btn:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.foot__btn--on {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
}
</style>
