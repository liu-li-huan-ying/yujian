<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import type { OutlineItem } from '../editor/outline'

const props = defineProps<{
  items: OutlineItem[]
  /** 当前阅读位置对应的章节序号（-1 表示顶部/无标题） */
  activeIndex: number
}>()

const emit = defineEmits<{ (e: 'select', index: number): void }>()

const { t } = useI18n()
const L = t.ui

const listEl = ref<HTMLElement | null>(null)

/** 当前章节变化：让激活项平滑滚入大纲可视区（不抢编辑器焦点） */
watch(
  () => props.activeIndex,
  async (idx) => {
    if (idx < 0 || !listEl.value) return
    await nextTick()
    const el = listEl.value.children[idx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }
)
</script>

<template>
  <aside class="outline jade" aria-label="文档大纲">
    <header class="outline__head">
      <span class="outline__title">{{ L.outline }}</span>
    </header>

    <nav ref="listEl" class="outline__body" aria-label="文档大纲">
      <ul v-if="items.length" class="outline__list">
        <li
          v-for="item in items"
          :key="item.index"
          class="outline__item"
          :class="{ 'is-active': item.index === activeIndex }"
          :style="{ paddingLeft: 12 + (item.level - 1) * 16 + 'px' }"
          @click="emit('select', item.index)"
        >
          <span class="outline__txt">{{ item.text }}</span>
        </li>
      </ul>
      <p v-else class="outline__empty">{{ L.outlineEmpty }}</p>
    </nav>
  </aside>
</template>

<style scoped>
.outline {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  width: var(--w-outline);
  min-height: 0;
  border-left: 1px solid var(--hue-border-subtle);
}

.outline__head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  height: var(--h-crumb);
  padding: 0 12px;
  flex-shrink: 0;
}

.outline__title {
  font-size: 12px;
  font-weight: 500;
  color: var(--hue-text-2);
  letter-spacing: 0.04em;
}

.outline__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0 12px;
}

.outline__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.outline__item {
  position: relative;
  padding: 5px 10px 5px 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--hue-text-2);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: var(--radius-sm);
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.outline__item:hover {
  background: var(--bg-hover);
  color: var(--hue-text-1);
}

.outline__item.is-active {
  color: var(--hue-accent);
  background: var(--hue-active);
  font-weight: 500;
}

/* 激活项左侧 2px accent 竖条（圆角、内缩于左侧栏留白中） */
.outline__item.is-active::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 16px;
  border-radius: 1px;
  background: var(--hue-accent);
}

.outline__txt {
  pointer-events: none;
}

.outline__empty {
  margin: 0;
  padding: 14px 12px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--hue-text-3);
}

/* 尊重减弱动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .outline__item {
    transition: none;
  }
}
</style>
