<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import type { FileNode } from '../../electron/shared/ipc-channels'
import type { ExportKind } from '../export/types'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  /** 笔记库文件树（含子目录），用于按树序列出 .md */
  tree: FileNode[]
  /** 笔记库根路径（用于默认合订标题） */
  vaultPath: string | null
  /** 当前「导出前预览」全局开关（作为面板内默认勾选） */
  preview: boolean
}>()

const emit = defineEmits<{
  close: []
  compile: [
    payload: {
      files: string[]
      title: string
      newPagePerDoc: boolean
      kind: ExportKind
      preview: boolean
    }
  ]
}>()

/** 把文件树压平成 .md 列表（保留「目录在前、名称升序」的树序，递归子目录） */
function flatten(nodes: FileNode[]): { path: string; name: string; dir: string }[] {
  const out: { path: string; name: string; dir: string }[] = []
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.type === 'dir') {
        if (n.children) walk(n.children)
      } else if (/\.(md|markdown)$/i.test(n.name)) {
        const dir = n.path.replace(/[\\/][^\\/]*$/, '').replace(/^.*[\\/]/, '')
        out.push({ path: n.path, name: n.name.replace(/\.(md|markdown)$/i, ''), dir })
      }
    }
  }
  walk(nodes)
  return out
}

interface Row {
  path: string
  name: string
  dir: string
  checked: boolean
}

const all = flatten(props.tree)
const rows = ref<Row[]>(all.map((f) => ({ ...f, checked: true })))

const title = ref('')
const newPage = ref(true)
const kind = ref<ExportKind>('pdf')
const preview = ref(props.preview)

const selectedCount = computed(() => rows.value.filter((r) => r.checked).length)
const hasFiles = computed(() => rows.value.length > 0)

function move(index: number, delta: number): void {
  const to = index + delta
  if (to < 0 || to >= rows.value.length) return
  const arr = rows.value
  ;[arr[index], arr[to]] = [arr[to], arr[index]]
}

function setAll(value: boolean): void {
  rows.value.forEach((r) => (r.checked = value))
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? 'vault').replace(/\.(md|markdown)$/i, '')
}

function confirm(): void {
  if (!selectedCount.value) return
  emit('compile', {
    files: rows.value.filter((r) => r.checked).map((r) => r.path),
    title: title.value.trim() || baseName(props.vaultPath ?? '合订文档'),
    newPagePerDoc: newPage.value,
    kind: kind.value,
    preview: preview.value
  })
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel glass" role="dialog" :aria-label="L.compileTitle">
      <div class="panel__head">
        <Icon name="layers" :size="15" class="panel__icon" />
        <span class="panel__title">{{ L.compileTitle }}</span>
        <span class="panel__count">{{ L.compileSelected.replace('{n}', String(selectedCount)) }}</span>
        <button class="panel__x" type="button" :title="L.compileCancel" @click="emit('close')">
          <Icon name="x" :size="14" />
        </button>
      </div>

      <p class="panel__hint">{{ L.compileHint }}</p>

      <div class="panel__body">
        <div v-if="!hasFiles" class="empty">{{ L.compileEmpty }}</div>
        <ul v-else class="list">
          <li v-for="(r, i) in rows" :key="r.path" class="row" :class="{ 'row--off': !r.checked }">
            <label class="row__check">
              <input type="checkbox" v-model="r.checked" />
            </label>
            <div class="row__meta">
              <span class="row__name">{{ r.name }}</span>
              <span v-if="r.dir" class="row__dir">{{ r.dir }}</span>
            </div>
            <div class="row__acts">
              <button
                class="mini"
                type="button"
                :title="L.compileUp"
                :disabled="i === 0"
                @click="move(i, -1)"
              >
                <Icon name="chevron-up" :size="13" />
              </button>
              <button
                class="mini"
                type="button"
                :title="L.compileDown"
                :disabled="i === rows.length - 1"
                @click="move(i, 1)"
              >
                <Icon name="chevron-down" :size="13" />
              </button>
            </div>
          </li>
        </ul>
      </div>

      <div class="panel__opts">
        <div class="opt opt--title">
          <label class="opt__label" for="compile-title">{{ L.compileBookTitle }}</label>
          <div class="field">
            <Icon name="book" :size="13" class="field__icon" />
            <input
              id="compile-title"
              class="opt__input"
              type="text"
              v-model="title"
              :placeholder="L.compileBookTitlePlaceholder"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="opt">
          <label class="opt__label">{{ L.compileFormat }}</label>
          <div class="select-wrap">
            <select v-model="kind" class="select" :title="L.compileFormat">
              <option value="md">{{ L.exportMenuMd }}</option>
              <option value="txt">{{ L.exportMenuTxt }}</option>
              <option value="html">{{ L.exportMenuHtml }}</option>
              <option value="pdf">{{ L.exportMenuPdf }}</option>
              <option value="latex">{{ L.exportMenuLatex }}</option>
              <option value="docx">{{ L.exportMenuDocx }}</option>
              <option value="epub">{{ L.exportMenuEpub }}</option>
              <option value="rtf">{{ L.exportMenuRtf }}</option>
              <option value="odt">{{ L.exportMenuOdt }}</option>
            </select>
          </div>
        </div>

        <label class="switch">
          <input type="checkbox" v-model="newPage" />
          <span>{{ L.compileNewPage }}</span>
        </label>

        <label class="switch">
          <input type="checkbox" v-model="preview" />
          <span>{{ L.exportOptPreview }}</span>
        </label>

        <div class="opt__quick">
          <button class="link" type="button" @click="setAll(true)">{{ L.compileSelectAll }}</button>
          <button class="link" type="button" @click="setAll(false)">{{ L.compileClear }}</button>
        </div>
      </div>

      <div class="panel__foot">
        <button class="btn" type="button" @click="emit('close')">{{ L.compileCancel }}</button>
        <button
          class="btn btn--primary"
          type="button"
          :disabled="!selectedCount"
          @click="confirm"
        >
          <Icon name="download" :size="14" />
          {{ L.compileConfirm }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.38);
  animation: cp-fade 0.16s ease both;
}

.panel {
  width: 540px;
  max-width: calc(100vw - 48px);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-lg, 14px);
  animation: cp-in 0.18s ease both;
}

.panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.panel__icon {
  color: var(--hue-accent, #248077);
}
.panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1, #e8e9e7);
}
.panel__count {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--hue-accent, #248077);
  background: var(--hue-active, rgba(95, 168, 160, 0.16));
}
.panel__x {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--hue-text-2, #a3a7a5);
  cursor: pointer;
}
.panel__x:hover {
  background: var(--hue-hover, rgba(0, 0, 0, 0.06));
  color: var(--hue-text-1, #e8e9e7);
}

.panel__hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--hue-text-2, #a3a7a5);
  flex-shrink: 0;
}

.panel__body {
  flex: 1;
  min-height: 0;
  border-radius: 10px;
  overflow: auto;
  background: rgba(var(--hue-tint-1, 95, 168, 160), 0.06);
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.08));
}

.empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--hue-text-2, #a3a7a5);
}

.list {
  margin: 0;
  padding: 4px;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 8px;
}
.row:hover {
  background: rgba(var(--hue-tint-1, 95, 168, 160), 0.1);
}
.row--off {
  opacity: 0.5;
}
.row__check {
  display: grid;
  place-items: center;
}
.row__check input {
  width: 15px;
  height: 15px;
  accent-color: var(--hue-accent, #248077);
  cursor: pointer;
}
.row__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.row__name {
  font-size: 12.5px;
  color: var(--hue-text-1, #e8e9e7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__dir {
  font-size: 10.5px;
  color: var(--hue-text-2, #a3a7a5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__acts {
  display: flex;
  gap: 2px;
}
.mini {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.1));
  border-radius: 6px;
  background: transparent;
  color: var(--hue-text-2, #a3a7a5);
  cursor: pointer;
}
.mini:hover:not(:disabled) {
  color: var(--hue-accent, #248077);
  border-color: var(--hue-accent, #248077);
}
.mini:disabled {
  opacity: 0.35;
  cursor: default;
}

.panel__opts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  flex-shrink: 0;
  padding: 10px 2px 2px;
  border-top: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.08));
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opt--title {
  flex: 1 1 100%;
  min-width: 200px;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.opt__label {
  font-size: 11.5px;
  color: var(--hue-text-2, #a3a7a5);
  white-space: nowrap;
}
.field {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 120px;
}
.field__icon {
  position: absolute;
  left: 9px;
  color: var(--hue-text-3, #8b908e);
  pointer-events: none;
}
.opt__input {
  flex: 1;
  width: 100%;
  height: 30px;
  padding: 0 11px 0 30px;
  font-size: 12.5px;
  font-family: var(--font-ui);
  color: var(--hue-text-1, #e8e9e7);
  /* 凹陷玻璃：比面板更深一档，配合内阴影表达「刻入」层次（呼应 §10.1 Depth 原则） */
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--hue-border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 6px);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
  box-sizing: border-box;
  transition: border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.opt__input::placeholder {
  color: var(--hue-text-3, #8b908e);
  opacity: 1;
}
.opt__input:focus {
  outline: none;
  border-color: var(--hue-accent, #5fa8a0);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35),
    0 0 0 3px rgba(var(--hue-tint-2, 95, 168, 160), 0.2);
}
/* 浅色：凹陷改为极淡墨调，避免白底浮在羊脂玉玻璃上 */
[data-skin][data-mode='light'] .opt__input {
  color: var(--hue-text-1, #1b1d1c);
  background: rgba(20, 30, 28, 0.05);
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
}
[data-skin][data-mode='light'] .opt__input:focus {
  border-color: var(--hue-accent, #248077);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08),
    0 0 0 3px rgba(36, 128, 119, 0.16);
}
.select-wrap {
  position: relative;
  flex: 1;
  min-width: 140px;
}
.select {
  width: 100%;
  height: 30px;
  padding: 0 28px 0 9px;
  font-size: 12.5px;
  font-family: var(--font-ui, inherit);
  color: var(--hue-text-1);
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.12));
  border-radius: var(--radius-md);
  /* 深色：凹陷玻璃质感，与书名输入框统一 */
  background: rgba(0, 0, 0, 0.22)
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%23a3a7a5' stroke-width='1.4' stroke-linecap='round'/></svg>")
    no-repeat right 10px center;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}
.select:focus {
  outline: none;
  border-color: var(--hue-accent, #248077);
  box-shadow: 0 0 0 3px rgba(var(--hue-tint-2, 36, 128, 119), 0.22);
}
.select option {
  color: #1c1e1f;
  background: #fcfcfb;
}
[data-skin][data-mode='light'] .select {
  background: rgba(20, 30, 28, 0.05)
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%235b6266' stroke-width='1.4' stroke-linecap='round'/></svg>")
    no-repeat right 10px center;
}
.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--hue-text-2, #a3a7a5);
  cursor: pointer;
}
.switch input {
  width: 14px;
  height: 14px;
  accent-color: var(--hue-accent, #248077);
  cursor: pointer;
}
.opt__quick {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.link {
  border: 0;
  background: transparent;
  color: var(--hue-accent, #248077);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0;
}
.link:hover {
  text-decoration: underline;
}

.panel__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.1));
  background: transparent;
  color: var(--hue-text-1, #e8e9e7);
  cursor: pointer;
}
.btn:hover {
  background: var(--hue-hover, rgba(0, 0, 0, 0.05));
}
.btn--primary {
  border-color: transparent;
  background: var(--hue-accent, #248077);
  color: var(--hue-on-accent, #fff);
}
.btn--primary:hover {
  filter: brightness(1.06);
  background: var(--hue-accent, #248077);
}
.btn--primary:disabled {
  opacity: 0.45;
  cursor: default;
  filter: none;
}

@keyframes cp-fade {
  from {
    opacity: 0;
  }
}
@keyframes cp-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}
</style>
