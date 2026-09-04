<script setup lang="ts">
/**
 * 标签芯片 TagChip —— 全库统一的 #标签 视觉单元（玉质药丸，与编辑器内联 .yj-tag__label 同族）。
 *
 * 用途：标签面板树、内容地图(MOC)清单的标签展示。一处定义、处处一致，
 * 杜绝各面板各自裸写 `#标签` 文字。
 *
 * 设计语言（对齐 docs/PHASE3-UI-DESIGN.md §4.2）：
 *  - 基底走「中性玉色」而非强调色，区别于 wikilink 的导航药丸；一眼可辨「这是元数据」；
 *  - # 弱化（--hue-text-3, 600），标签名为主（--hue-text-1）；
 *  - 玉质渐变 + 1px 玉色描边 + 5px 圆角，hover 微提亮（继承父级 cursor）。
 */
defineProps<{
  /** 标签名（不含 #），如 "project/phase3" */
  name: string
}>()
</script>

<template>
  <span class="tag-chip">
    <span class="tag-chip__hash">#</span>
    <span class="tag-chip__name">{{ name }}</span>
  </span>
</template>

<style scoped>
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  /* 在 flex 行内：不主动撑开、可收缩、长名截断；在 flex-wrap 容器内天然定宽并换行 */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 190px;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 1.45;
  color: var(--hue-text-1);
  background-image: linear-gradient(
    180deg,
    rgba(var(--hue-tint-1), 0.14) 0%,
    rgba(var(--hue-tint-1), 0.06) 100%
  );
  border: 1px solid rgba(var(--hue-tint-1), 0.3);
  border-radius: 5px;
  padding: 1px 7px;
  cursor: inherit;
  transition:
    background-image var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.tag-chip__hash {
  flex-shrink: 0;
  color: var(--hue-text-3);
  font-weight: 600;
  margin-right: 1px;
}
.tag-chip__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-chip:hover {
  background-image: linear-gradient(
    180deg,
    rgba(var(--hue-tint-1), 0.22) 0%,
    rgba(var(--hue-tint-1), 0.1) 100%
  );
  border-color: rgba(var(--hue-tint-1), 0.46);
}
</style>
