<script setup lang="ts">
/**
 * 批量替换确认（2026-10-04）。
 *
 * ## 为什么值得单独立一个组件
 *
 * 1. **风险配得上界面**：这是本项目唯一「不可撤销 + 可批量改写全库」的操作。
 *    原实现只有一句「将替换 N 处」+ 两个硬编码中文按钮，用户既不知道要改哪些文件、
 *    也看不出是全库还是本文档 —— 确认框形同虚设。
 * 2. **行数**：`Sidebar.vue` 当时 1434/1500，UI 塞不下 60 行；且确认逻辑与侧栏搜索
 *    无关，自成一组件更合「关注点分离」。
 *
 * ## 三件事必须同时说清
 *
 * - **范围**：本文档 / 全部（`scoped`）—— 影响面完全不同，必须明示；
 * - **规模**：改 N 处、涉及 M 个文件；
 * - **清单**：具体哪些文件（超 8 个折叠为「还有 K 个」+ 可展开）。
 */
import { computed } from 'vue'
import { useI18n } from '../i18n'
import { foldFilePaths } from '../utils/replaceConfirm'
import type { ReplaceConfirm } from '../composables/useSidebarSearch'

const props = defineProps<{
  confirm: ReplaceConfirm
  /** 全库范围时，是否展开完整清单（长清单默认折叠） */
  expanded?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'toggle'): void
}>()

const { t } = useI18n()
const L = t.ui

/** 超过此数则默认折叠（清单太长会让确认框本身变成滚动地狱） */
const FOLD_AT = 8
const shouldFold = computed(() => props.confirm.files.length > FOLD_AT)
const shown = computed(() =>
  shouldFold.value && !props.expanded ? foldFilePaths(props.confirm.files, FOLD_AT) : props.confirm.files,
)
</script>

<template>
  <div class="rc" role="alertdialog" :aria-label="L.replaceConfirmTitle">
    <p class="rc__head">
      <strong>{{ L.replaceConfirmTitle }}</strong>
    </p>

    <!-- 范围：影响面完全不同，必须先说 -->
    <p class="rc__scope" :class="{ 'rc__scope--vault': !confirm.scoped }">
      {{ confirm.scoped ? L.replaceScopeDoc : L.replaceScopeVault }}
    </p>

    <!-- 规模：改几处、涉及几个文件 -->
    <p class="rc__scale">
      {{ L.replaceConfirm.replace('{n}', String(confirm.hits)) }}
      · {{ L.replaceFiles.replace('{n}', String(confirm.files.length)) }}
    </p>

    <!-- 清单：具体哪些文件 -->
    <ul v-if="shown.length" class="rc__files">
      <li v-for="p in shown" :key="p" class="rc__file" :title="p">{{ p }}</li>
    </ul>
    <button
      v-if="shouldFold"
      class="rc__toggle"
      type="button"
      @click="emit('toggle')"
    >
      {{
        expanded
          ? L.replaceFilesCollapse
          : L.replaceFilesMore.replace('{n}', String(confirm.files.length - FOLD_AT))
      }}
    </button>

    <p class="rc__note">{{ L.replaceUndoHint }}</p>

    <div class="rc__acts">
      <button class="rc__ok" type="button" @click="emit('confirm')">{{ L.replaceConfirmOk }}</button>
      <button class="rc__cancel" type="button" @click="emit('cancel')">{{ L.replaceCancel }}</button>
    </div>
  </div>
</template>

<style scoped>
.rc {
  margin-top: 6px;
  padding: 9px 10px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  /* ⚠️ 只能用具名令牌：曾写 --hue-surface-1（不存在）→ 整条声明被静默丢弃、
     确认框变成无背景。`check-design` 的「伪令牌」规则抓到过一次，不会再有第二次。 */
  background: var(--hue-active);
}
.rc__head {
  margin: 0 0 4px;
  font-size: var(--fs-12);
  color: var(--hue-text-1);
}
/* 范围是「危险度」信息，用 mark 色（warn 级）而非普通文字 —— 影响面必须显眼 */
.rc__scope {
  margin: 0 0 4px;
  font-size: var(--fs-11);
  color: var(--hue-text-2);
}
.rc__scope--vault {
  color: var(--hue-mark);
  font-weight: 600;
}
.rc__scale {
  margin: 0 0 6px;
  font-size: var(--fs-11);
  color: var(--hue-text-3);
}
.rc__files {
  list-style: none;
  margin: 0 0 6px;
  padding: 4px 0 0;
  border-top: 1px solid var(--hue-border-subtle);
  max-height: 168px;
  overflow-y: auto;
}
.rc__file {
  font-size: var(--fs-11);
  color: var(--hue-text-2);
  line-height: 1.65;
  font-family: var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rc__toggle {
  border: 0;
  background: transparent;
  padding: 0;
  margin-bottom: 4px;
  font-size: var(--fs-11);
  color: var(--hue-accent);
  cursor: pointer;
}
.rc__note {
  margin: 0 0 8px;
  font-size: var(--fs-11);
  color: var(--hue-text-3);
  line-height: 1.5;
}
.rc__acts {
  display: flex;
  gap: 6px;
}
.rc__ok {
  padding: 3px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--hue-accent);
  color: var(--hue-base);
  font-size: var(--fs-12);
  font-weight: 600;
  cursor: pointer;
}
.rc__ok:hover {
  filter: brightness(1.08);
}
.rc__cancel {
  padding: 3px 12px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-2);
  font-size: var(--fs-12);
  cursor: pointer;
}
.rc__cancel:hover {
  color: var(--hue-text-1);
  background: var(--bg-hover);
}
</style>
