<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import type { FileNode } from '../../electron/shared/ipc-channels'

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
      kind: 'html' | 'pdf' | 'latex'
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
const kind = ref<'html' | 'pdf' | 'latex'>('pdf')
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
          <label class="opt__label">{{ L.compileBookTitle }}</label>
          <input
            class="opt__input"
            type="text"
            v-model="title"
            :placeholder="L.compileBookTitlePlaceholder"
          />
        </div>

        <div class="opt">
          <label class="opt__label">{{ L.compileFormat }}</label>
          <div class="seg">
            <button
              class="seg__item"
              :class="{ 'seg__item--on': kind === 'html' }"
              type="button"
              @click="kind = 'html'"
            >
              HTML
            </button>
            <button
              class="seg__item"
              :class="{ 'seg__item--on': kind === 'pdf' }"
              type="button"
              @click="kind = 'pdf'"
            >
              PDF
            </button>
            <button
              class="seg__item"
              :class="{ 'seg__item--on': kind === 'latex' }"
              type="button"
              @click="kind = 'latex'"
            >
              LaTeX
            </button>
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
  color: var(--text-primary);
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
  color: var(--text-secondary);
  cursor: pointer;
}
.panel__x:hover {
  background: var(--hue-hover, rgba(0, 0, 0, 0.06));
  color: var(--text-primary);
}

.panel__hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-secondary);
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
  color: var(--text-secondary);
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
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__dir {
  font-size: 10.5px;
  color: var(--text-secondary);
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
  color: var(--text-secondary);
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
  flex: 1;
  min-width: 200px;
}
.opt__label {
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.opt__input {
  flex: 1;
  min-width: 120px;
  height: 26px;
  padding: 0 9px;
  font-size: 12px;
  border-radius: 7px;
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.12));
  background: var(--hue-bg-input, rgba(255, 255, 255, 0.7));
  color: var(--text-primary);
}
.opt__input:focus {
  outline: none;
  border-color: var(--hue-accent, #248077);
}
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hue-border-subtle, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: var(--hue-highlight);
}
.seg__item {
  border: none;
  background: transparent;
  font-size: 11.5px;
  padding: 3px 10px;
  color: var(--hue-text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.seg__item:hover {
  color: var(--hue-text-1);
}
.seg__item--on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-weight: 500;
}
.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
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
  color: var(--text-primary);
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
