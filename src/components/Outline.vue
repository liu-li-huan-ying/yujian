<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import type { OutlineItem } from '../editor/outline'

const props = defineProps<{
  items: OutlineItem[]
  /** 当前阅读位置对应的章节序号（-1 表示顶部/无标题） */
  activeIndex: number
  /** 面板是否可见（收起时宽度归零） */
  visible?: boolean
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
  <aside class="outline jade" :class="{ 'is-collapsed': !visible }" aria-label="文档大纲">
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
      <div v-else class="empty-state">
        <div class="empty-state__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 5h9M5 5v14h14M9 9h8M9 13h8M9 17h5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <p class="empty-state__hint">{{ L.outlineEmpty }}</p>
      </div>
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
  /* 收起/展开用宽度过渡，与整体动效一致 */
  transition:
    width var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease),
    border-color var(--dur-base) var(--ease);
}

/* 收起态：宽度归零、去左边框、淡出 */
.outline.is-collapsed {
  width: 0 !important;
  opacity: 0;
  border-left-color: transparent;
  pointer-events: none;
  overflow: hidden;
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

/* 优雅空状态：图标徽章 + 提示，居中 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 24px 16px;
  text-align: center;
}

.empty-state__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius-lg);
  background: var(--hue-active);
  color: var(--hue-accent);
  box-shadow: inset 0 1px 0 var(--hue-highlight);
}

.empty-state__hint {
  margin: 0;
  max-width: 150px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--hue-text-3);
}

/* 尊重减弱动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .outline__item {
    transition: none;
  }
}
</style>
