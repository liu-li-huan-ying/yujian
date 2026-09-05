<script setup lang="ts">
/**
 * 活动栏（左缘竖排按钮条）——落实「把更多里的东西拆出来变成按钮」。
 *
 * 六个视图按钮分散在窗口左缘，分两组：
 *   库级视图：文件树 / 标签 / 内容地图
 *   文档级视图：大纲 / 反链 / 快照
 * 中间以细分隔线分组，语义清晰、互不混淆。
 *
 * 点击即开该视图（再点收起）。4 个浮层视图（标签 / 内容地图 / 反链 / 快照）
 * 由 App 侧做互斥：任一时刻只有一个浮层可见，避免多个玻璃浮层叠在编辑区上
 * ——这正是此前「轨道视图」并发渲染导致「面板切换失灵」的成因。
 */
import { computed } from 'vue'
import Icon from './Icon.vue'
import { i18n } from '../i18n'

export type ViewKey = 'files' | 'tags' | 'moc' | 'outline' | 'backlinks' | 'snapshot'

const L = i18n.ui

const props = defineProps<{
  /** 侧栏（文件树）是否可见 */
  filesActive: boolean
  /** 标签浮层是否打开 */
  tagsActive: boolean
  /** 内容地图浮层是否打开 */
  mocActive: boolean
  /** 大纲是否可见 */
  outlineActive: boolean
  /** 反链浮层是否打开 */
  backlinksActive: boolean
  /** 快照浮层是否打开 */
  snapshotActive: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', key: ViewKey): void
}>()

interface ViewItem {
  key: ViewKey
  icon: string
  label: string
  on: boolean
}

/** 两组视图：库级 / 文档级（渲染时以细分隔线隔开） */
const groups = computed<ViewItem[][]>(() => [
  [
    { key: 'files', icon: 'folder', label: L.sidebar, on: props.filesActive },
    { key: 'tags', icon: 'tag', label: L.tags, on: props.tagsActive },
    { key: 'moc', icon: 'map', label: L.moc, on: props.mocActive },
  ],
  [
    { key: 'outline', icon: 'file-text', label: L.outline, on: props.outlineActive },
    { key: 'backlinks', icon: 'backlink', label: L.backlinks, on: props.backlinksActive },
    { key: 'snapshot', icon: 'history', label: L.snapshots, on: props.snapshotActive },
  ],
])
</script>

<template>
  <nav class="act jade" aria-label="视图">
    <template v-for="(g, gi) in groups" :key="gi">
      <span v-if="gi > 0" class="act__sep" />
      <button
        v-for="v in g"
        :key="v.key"
        class="act__btn"
        :class="{ 'act__btn--on': v.on }"
        type="button"
        :title="v.label"
        :aria-label="v.label"
        :aria-pressed="v.on"
        @click="emit('toggle', v.key)"
      >
        <Icon :name="v.icon" :size="18" />
      </button>
    </template>
  </nav>
</template>

<style scoped>
/* 左缘竖排条：44px 宽，玉质底，右侧细分隔线，与侧栏 / 大纲呼应 */
.act {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 44px;
  padding: 8px 0;
  border-right: 1px solid var(--hue-border-subtle);
  background: var(--hue-highlight, rgba(127, 127, 127, 0.04));
}

/* 分组分隔线：隔开「库级视图」与「文档级视图」 */
.act__sep {
  width: 18px;
  height: 1px;
  margin: 6px 0;
  background: var(--hue-border-subtle);
  flex-shrink: 0;
}

/* 视图按钮：34×34（≥28px 触控目标），未激活低对比，激活走 accent 玉质高亮 */
.act__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.act__btn:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}

.act__btn:focus-visible {
  outline: 2px solid var(--hue-accent);
  outline-offset: -2px;
}

/* 激活态：accent 文字 + 玉质高亮底 + 左侧 2px accent 竖条，与标题栏开关同源语义 */
.act__btn--on {
  color: var(--hue-accent);
  background: var(--hue-active);
  box-shadow: inset 2px 0 0 var(--hue-accent);
}

.act__btn--on:hover {
  color: var(--hue-accent);
  background: var(--hue-active);
  filter: brightness(1.06);
}
</style>
