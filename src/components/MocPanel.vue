<script setup lang="ts">
/**
 * 内容地图（MOC）面板 —— Phase 3 批次三（二）。
 *
 * 与标签 / 反链面板同源的玻璃浮层：标题栏「更多」→ 打开本面板（App 级 v-if 浮层）。
 *
 * 两种状态：
 *  - 当前文档是 MOC（frontmatter `moc: true`）：按「自身每枚标签 / 本图链出 / 挂到本图」
 *    分组展示下级笔记，每组可折叠、点击笔记直接打开；
 *  - 当前文档不是 MOC：列出全库已有的 MOC 供跳转，并提示如何把本篇标成 MOC。
 *
 * 数据全部由统一索引派生（主进程 getMocOutline / listMocs），渲染层不读正文。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import TagChip from './TagChip.vue'
import { useI18n } from '../i18n'
import type { MocGroup, MocItem, TagNoteItem } from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  vaultPath: string | null
  /** 当前打开的文档绝对路径（决定是展示本篇聚合还是全库 MOC 清单） */
  activePath: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open', payload: { path: string; line: number }): void
  /** 请求 App 把当前文档标记 / 取消标记为内容地图（写回 frontmatter，触发重索引） */
  (e: 'toggle-moc'): void
  /** 索引重建完成（App 据此弹 toast） */
  (e: 'rebuilt'): void
}>()

const groups = ref<MocGroup[]>([])
const mocs = ref<MocItem[]>([])
const loading = ref(false)
const rebuilding = ref(false)
const error = ref<string | null>(null)
/** 取消订阅 onVaultChange 的句柄（卸载时清理，避免泄漏） */
let unsubscribeVaultChange: (() => void) | null = null
/** 折叠状态：key = 组的稳定标识；默认全部展开 */
const collapsed = ref<Set<string>>(new Set())

/** 当前文档是否为 MOC —— 以「聚合结果非空」不足以判定（无标签无链接的 MOC 也合法），故单独看清单 */
const isMoc = computed(
  () => !!props.activePath && mocs.value.some((m) => m.path === props.activePath)
)

const totalNotes = computed(() => groups.value.reduce((n, g) => n + g.notes.length, 0))

/** 组的稳定 key：同一 kind 下标签名唯一，故 kind+tag 足够 */
function groupKey(g: MocGroup): string {
  return `${g.kind}:${g.tag}`
}
function groupLabel(g: MocGroup): string {
  if (g.kind === 'tag') return `#${g.tag}`
  return g.kind === 'outlinks' ? L.mocGroupOutlinks : L.mocGroupBacklinks
}
function isCollapsed(g: MocGroup): boolean {
  return collapsed.value.has(groupKey(g))
}
function toggleGroup(g: MocGroup): void {
  const key = groupKey(g)
  const set = new Set(collapsed.value)
  if (set.has(key)) set.delete(key)
  else set.add(key)
  collapsed.value = set
}

async function load(): Promise<void> {
  if (!props.vaultPath) return
  loading.value = true
  error.value = null
  try {
    // 两者都要：清单用于判定「当前是否 MOC」并在否时给出可跳转入口
    const [list, outline] = await Promise.all([
      window.api.listMocs(props.vaultPath),
      props.activePath
        ? window.api.getMocOutline(props.vaultPath, props.activePath)
        : Promise.resolve([] as MocGroup[])
    ])
    mocs.value = list
    groups.value = outline
    collapsed.value = new Set()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function openNote(n: TagNoteItem | MocItem): void {
  emit('open', { path: n.path, line: 1 })
}

function fileDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

/** 把当前笔记标记为 / 取消标记为内容地图（实际写回交给 App，避免面板触碰保真层） */
function toggleMoc(): void {
  emit('toggle-moc')
}

/** 重建统一索引（兜底陈旧缓存），完成后自刷新并通知 App 弹 toast */
async function onRebuild(): Promise<void> {
  if (!props.vaultPath || rebuilding.value) return
  rebuilding.value = true
  try {
    await window.api.rebuildIndex(props.vaultPath)
    await load()
    emit('rebuilt')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    rebuilding.value = false
  }
}

// 实时刷新：库内任意改动（正文加 #标签、勾选「内容地图」经 App 写回并触发 vault change）
// 都让本面板重新聚合，避免出现「明明改了但面板没动」的割裂感。
let changeTimer: ReturnType<typeof setTimeout> | null = null
function onVaultChange(): void {
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void load(), 250)
}

// 切换文档时重新聚合（面板常开着切笔记）
watch(() => props.activePath, () => void load())
onMounted(() => {
  void load()
  window.addEventListener('keydown', onKey)
  unsubscribeVaultChange = window.api.onVaultChange(onVaultChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  unsubscribeVaultChange?.()
  if (changeTimer) clearTimeout(changeTimer)
})
</script>

<template>
  <div class="moc glass" role="dialog" :aria-label="L.mocTitle">
    <div class="moc__head">
      <Icon name="map" :size="15" class="moc__icon" />
      <span class="moc__title">{{ L.mocTitle }}</span>
      <span v-if="isMoc && totalNotes > 0" class="moc__count">{{ totalNotes }}</span>
      <button
        v-if="props.activePath"
        class="moc__act"
        type="button"
        :class="{ 'moc__act--active': isMoc }"
        :title="isMoc ? L.mocUnmark : L.mocMark"
        @click="toggleMoc"
      >
        <Icon :name="isMoc ? 'check' : 'star'" :size="14" />
        <span>{{ isMoc ? L.mocUnmark : L.mocMark }}</span>
      </button>
      <button class="moc__x" type="button" :title="L.mocClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <div class="moc__body">
      <p v-if="loading" class="moc__empty">
        <Icon name="loader" :size="16" class="moc__spin" /> {{ L.mocLoading }}
      </p>
      <p v-else-if="error" class="moc__empty moc__empty--err">
        <Icon name="alert" :size="16" /> {{ error }}
      </p>

      <!-- 当前文档是 MOC：分组聚合 -->
      <template v-else-if="isMoc">
        <p v-if="groups.length === 0" class="moc__empty">
          <Icon name="map" :size="16" /> {{ L.mocEmpty }}
        </p>
        <section v-for="g in groups" :key="groupKey(g)" class="moc__group">
          <button
            type="button"
            class="moc__group-head"
            :aria-expanded="!isCollapsed(g)"
            @click="toggleGroup(g)"
          >
            <Icon
              name="chevron-right"
              :size="13"
              class="moc__twist"
              :class="{ 'moc__twist--open': !isCollapsed(g) }"
            />
            <span class="moc__group-label" :class="{ 'moc__group-label--tag': g.kind === 'tag' }">
              {{ groupLabel(g) }}
            </span>
            <span class="moc__badge">{{ g.notes.length }}</span>
          </button>
          <ul v-if="!isCollapsed(g)" class="moc__notes">
            <li v-for="n in g.notes" :key="n.path" class="row">
              <button
                type="button"
                class="row__main"
                :title="`${n.base}\n${fileDir(n.path)}`"
                @click="openNote(n)"
              >
                <span class="row__top"><span class="row__file">{{ n.title || n.base }}</span></span>
                <span class="row__dir">{{ fileDir(n.path) }}</span>
              </button>
            </li>
          </ul>
          <p v-if="!isCollapsed(g) && g.truncated" class="moc__trunc">{{ L.mocTruncated }}</p>
        </section>
      </template>

      <!-- 当前文档不是 MOC：全库 MOC 清单 + 如何标记 -->
      <template v-else>
        <p class="moc__notice">
          <Icon name="info" :size="15" />
          <span>{{ L.mocNotMocHint }}</span>
        </p>
        <h4 class="moc__sub">{{ L.mocListTitle }}</h4>
        <p v-if="mocs.length === 0" class="moc__empty">
          <Icon name="map" :size="16" /> {{ L.mocListEmpty }}
        </p>
        <ul v-else class="moc__notes">
          <li v-for="m in mocs" :key="m.path" class="row">
            <button
              type="button"
              class="row__main"
              :title="`${m.base}\n${fileDir(m.path)}`"
              @click="openNote(m)"
            >
              <span class="row__top"><span class="row__file">{{ m.title || m.base }}</span></span>
              <span v-if="m.tags.length" class="row__tags">
                <TagChip v-for="tg in m.tags" :key="tg" :name="tg" />
              </span>
              <span v-else class="row__dir">{{ fileDir(m.path) }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>

    <div class="moc__foot">
      <button
        class="moc__rebuild"
        type="button"
        :disabled="rebuilding || !props.vaultPath"
        :title="L.mocRebuild"
        @click="onRebuild"
      >
        <Icon name="loader" :size="13" :class="{ 'moc__spin': rebuilding }" />
        <span>{{ rebuilding ? L.mocRebuilding : L.mocRebuild }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 库级面板：锚编辑区左上（同 TagPanel），紧邻左缘活动栏触发点与文件树 */
.moc {
  position: absolute;
  top: 10px;
  left: 16px;
  z-index: 30;
  width: 340px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: moc-in 0.18s var(--ease, ease) both;
}
@keyframes moc-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.moc__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.moc__icon {
  color: var(--hue-accent);
}
.moc__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.moc__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-on-accent);
  background: var(--hue-accent);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 18px;
  text-align: center;
}
.moc__x {
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
  transition: background var(--dur-fast) var(--ease);
}
.moc__x:hover {
  background: var(--hue-active);
  color: var(--hue-text-1);
}

/* 标记 / 取消标记当前笔记为内容地图 */
.moc__act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.moc__act:hover {
  background: var(--hue-active);
  color: var(--hue-text-1);
  border-color: var(--hue-accent);
}
.moc__act--active {
  color: var(--hue-on-accent);
  background: var(--hue-accent);
  border-color: var(--hue-accent);
}
.moc__act--active:hover {
  filter: brightness(0.94);
  color: var(--hue-on-accent);
}

/* 底部重建索引导航 */
.moc__foot {
  display: flex;
  padding-top: 8px;
  border-top: 1px solid var(--hue-border-subtle);
}
.moc__rebuild {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.moc__rebuild:hover:not(:disabled) {
  background: var(--hue-active);
  color: var(--hue-text-1);
  border-color: var(--hue-accent);
}
.moc__rebuild:disabled {
  opacity: 0.6;
  cursor: default;
}

.moc__body {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}

.moc__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 4px;
  font-size: 12.5px;
  color: var(--hue-text-3);
}
.moc__empty--err {
  color: var(--hue-mark, #d97757);
}

/* 非 MOC 时的引导 */
.moc__notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 10px;
  padding: 9px 10px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--hue-text-2);
  background: var(--hue-surface);
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
}
.moc__notice svg {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--hue-accent);
}
.moc__sub {
  margin: 0 0 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--hue-text-3);
  text-transform: none;
}

/* 分组 */
.moc__group {
  margin-bottom: 10px;
}
.moc__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 8px 0 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.moc__group-head:hover {
  background: var(--hue-active);
}
.moc__twist {
  flex-shrink: 0;
  color: var(--hue-text-3);
  transition: transform var(--dur-fast) var(--ease);
}
.moc__twist--open {
  transform: rotate(90deg);
}
.moc__group-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 标签组：与编辑器里的 .yj-tag 芯片同语言（# 弱化、名字为主） */
.moc__group-label--tag {
  color: var(--hue-text-1);
  font-weight: 600;
}
/* 计数徽标：min-width 钉死居中，位数变化不抖动（动态布局铁律 #2） */
.moc__badge {
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-text-3);
  background: var(--hue-active);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 20px;
  text-align: center;
}
.moc__trunc {
  margin: 4px 2px 0;
  font-size: 11px;
  color: var(--hue-text-3);
}

/* 笔记条目：与反链 / 标签面板 .row 同观感（各面板 scoped，故本组件独立定义） */
.moc__notes {
  list-style: none;
  margin: 4px 0 0;
  padding: 0 0 0 4px;
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
    background var(--dur-fast, 0.12s) var(--ease, ease),
    border-color var(--dur-fast, 0.12s) var(--ease, ease);
}
.row:hover {
  background: var(--hue-surface-2);
  border-color: var(--hue-accent);
}
.row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}
.row__top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.row__file {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__dir {
  font-size: 11px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 有标签时：玉质芯片 flex-wrap 平铺（替换原先裸写的 #标签 串） */
.row__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.moc__spin {
  animation: moc-spin 0.9s linear infinite;
}
@keyframes moc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
