<script setup lang="ts">
/**
 * 玉笺图标系统 · 线性 24×24（Lucide 风格）
 * 统一线宽、圆角端点、无填充；颜色继承 currentColor，默认 --text-secondary。
 * 设计令牌见 UI-DESIGN.md §8。新增图标只需在 PATHS 增补内部 SVG 片段。
 */
const props = defineProps<{
  name: string
  /** 像素尺寸，默认 16（标题栏图标） */
  size?: number
}>()

/** 每个图标是 <svg> 内部的一段 path / circle / line 片段 */
const PATHS: Record<string, string> = {
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  'file-text':
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'folder-open':
    '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5.5A2.5 2.5 0 0 1 4.5 3H9l1.5 2.5H20a2 2 0 0 1 2 2v3"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="9" r="1"/><circle cx="9" cy="14" r="1"/><path d="M12 12a3 3 0 0 0 3 3"/>',
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  more:
    '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  help:
    '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.6-2.6 2.6"/><path d="M12 16.4h.01"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4-4-7 7"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>',
  book:
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><line x1="4" y1="5.5" x2="4" y2="19.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  history:
    '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
}
</script>

<template>
  <svg
    class="icon"
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="PATHS[name] ?? ''"
  />
</template>

<style scoped>
.icon {
  display: block;
  flex-shrink: 0;
}
</style>
