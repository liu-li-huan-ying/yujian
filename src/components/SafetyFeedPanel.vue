<script setup lang="ts">
/**
 * 安全网降级面板 —— 让「安全网坏过」这件事对用户可见。
 *
 * ## 为什么需要这个面板
 *
 * 主进程会记录降级事件（备份失败 / 读不到原文 / 回收站降级为永久删除 / 启动自检发现
 * 库不可写…），此前这些只进内存环、**渲染层零消费**，于是「昨晚备份失败 3 次」
 * 用户永远看不到。上一轮把它们修成「会说话」，这一轮接上最后一跳。
 *
 * ## 与「软错误面板」的分工（别混淆）
 *
 *  - **软错误**（`IntegrityPanel`）：可容忍失败的**诊断入口**，要用户主动去看。
 *  - **本面板**：安全网失效的**告知**，出错即常驻红点，直到用户确认。
 *
 * 两者内容有重叠（降级同时也会记一条 warn 软错误），但语义不同、打扰策略不同，
 * 故独立成面板而非合并。
 */
import { computed } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import { useSafetyFeed } from '../composables/useSafetyFeed'
import { safetyTitleKey, foldPaths } from '../utils/safetyNotice'

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const L = t.ui
const feed = useSafetyFeed()

const items = computed(() => feed.notices.value)

/** 每条事件的 i18n 键 + 路径折叠后的可见/剩余 */
const rows = computed(() =>
  items.value.map((n) => ({
    id: n.id,
    // safetyTitleKey 返回的是 locales 里的键名联合类型（非泛化 string），
    // 故索引 L 安全 —— 若新增 kind 忘了加 i18n 键，会在**编译期**报红而非运行时显示 undefined。
    title: L[safetyTitleKey(n.kind)],
    detail: n.detail,
    at: n.at,
    error: n.kind === 'prev-unreadable' || n.kind === 'backup-failed' || n.kind === 'trash-fallback',
    ...foldPaths(n.paths),
  })),
)

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
function timeText(at: number): string {
  return new Date(at).toLocaleTimeString()
}
</script>

<template>
  <div class="sf glass" role="dialog" :aria-label="L.safetyFeed" @keydown="onKey">
    <div class="sf__head">
      <Icon name="shield" :size="15" class="sf__icon" />
      <span class="sf__title">{{ L.safetyFeed }}</span>
      <span v-if="rows.length" class="sf__count">{{ rows.length }}</span>
      <button
        v-if="rows.length"
        class="sf__clear"
        type="button"
        :title="L.safetyFeedClear"
        @click="feed.clear()"
      >
        <Icon name="trash" :size="13" />
      </button>
      <button class="sf__x" type="button" :title="L.safetyFeedClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <p v-if="!rows.length" class="sf__empty">{{ L.safetyFeedEmpty }}</p>

    <ul v-else class="sf__list">
      <li v-for="r in rows" :key="r.id" class="sf__item" :class="{ 'sf__item--err': r.error }">
        <div class="sf__row1">
          <span class="sf__dot" />
          <span class="sf__name">{{ r.title }}</span>
          <span class="sf__time">{{ timeText(r.at) }}</span>
        </div>
        <p v-if="r.detail" class="sf__detail">{{ r.detail }}</p>
        <ul v-if="r.visible.length" class="sf__paths">
          <li v-for="(p, i) in r.visible" :key="i" class="sf__path" :title="p">{{ p }}</li>
          <li v-if="r.rest" class="sf__path sf__path--rest">
            {{ L.safetyFeedMore.replace('{n}', String(r.rest)) }}
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* 浮层定位（Teleport 到 body，故用 fixed 而非 absolute）。
   锚在状态栏之上：状态栏高度走令牌，不写死数值。 */
.sf {
  position: fixed;
  bottom: calc(var(--h-statusbar) + 8px);
  right: 16px;
  z-index: var(--z-panel);
  width: 420px;
  max-width: calc(100% - 32px);
  max-height: min(60vh, 460px);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 12px 12px;
}
.sf__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding-bottom: 8px;
}
.sf__icon {
  color: var(--hue-accent);
}
.sf__title {
  font-size: var(--fs-13);
  font-weight: 600;
  color: var(--hue-text-1);
}
.sf__count {
  font-size: var(--fs-11);
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
}
.sf__clear,
.sf__x {
  margin-left: auto;
}
.sf__clear + .sf__x {
  margin-left: 0;
}
.sf__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
}
.sf__x:hover {
  background: rgba(var(--hue-tint-1), 0.18);
  color: var(--hue-text-1);
}
.sf__empty {
  margin: 0;
  padding: 18px 0;
  text-align: center;
  font-size: var(--fs-12);
  color: var(--hue-text-3);
}
.sf__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
}
.sf__item {
  padding: 7px 0;
  border-top: 1px solid var(--hue-border-subtle);
}
.sf__item:first-child {
  border-top: 0;
}
.sf__row1 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sf__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--hue-mark);
  flex-shrink: 0;
}
/* error 级用 danger 令牌（不用写死色），与状态栏 dot--fail 呼应 */
.sf__item--err .sf__dot {
  background: var(--hue-danger);
}
.sf__name {
  font-size: var(--fs-12);
  font-weight: 600;
  color: var(--hue-text-1);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf__time {
  font-size: var(--fs-11);
  color: var(--hue-text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.sf__detail {
  margin: 3px 0 0 12px;
  font-size: var(--fs-12);
  color: var(--hue-text-2);
  line-height: 1.5;
}
.sf__paths {
  list-style: none;
  margin: 4px 0 0 12px;
  padding: 0;
}
.sf__path {
  font-size: var(--fs-11);
  color: var(--hue-text-3);
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-ui);
}
</style>
