<script setup lang="ts">
import { computed } from 'vue'
import type { SearchFileResult } from '../../electron/shared/ipc-channels'

const props = defineProps<{
  results: SearchFileResult[]
  query: string
  activePath: string | null
  /** 是否区分大小写（高亮规则与搜索保持一致） */
  caseSensitive?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', path: string, line: number): void
}>()

/** 文件名不显示 md 扩展名，与文件树一致 */
function displayName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

/** 转义后再高亮，防止文件内容里的 HTML 标签造成 XSS */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(text: string): string {
  const safe = escapeHtml(text)
  const q = escapeHtml(props.query).trim()
  if (!q) return safe
  const flags = props.caseSensitive ? 'g' : 'gi'
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  return safe.replace(re, (m) => `<mark>${m}</mark>`)
}

const totalHits = computed(() => props.results.reduce((n, f) => n + f.hits.length, 0))
</script>

<template>
  <div class="results">
    <div class="results__meta">{{ totalHits }} 处命中 · {{ results.length }} 个文件</div>

    <div v-for="file in results" :key="file.path" class="file">
      <button
        class="file__head"
        :class="{ 'file__head--active': file.path === activePath }"
        type="button"
        :title="file.path"
        @click="emit('open', file.path, file.hits[0]?.line ?? 1)"
      >
        <span class="file__name">{{ displayName(file.name) }}</span>
        <span class="file__count">{{ file.hits.length }}</span>
      </button>

      <ul class="hits">
        <li v-for="hit in file.hits" :key="hit.line">
          <button class="hit" type="button" @click="emit('open', file.path, hit.line)">
            <span class="hit__line">{{ hit.line }}</span>
            <span class="hit__text" v-html="highlight(hit.text)" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.results {
  padding: 2px 2px 12px;
}

.results__meta {
  padding: 2px 8px 8px;
  font-size: 11px;
  color: var(--hue-text-3);
}

.file {
  margin-bottom: 2px;
}

.file__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--hue-text-1);
  transition: background var(--dur-fast) var(--ease);
}

.file__head:hover {
  background: var(--bg-hover);
}

.file__head--active {
  color: var(--hue-accent);
}

.file__count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--hue-accent);
  background: rgba(var(--hue-tint-2), 0.2);
  border-radius: 10px;
  padding: 1px 7px;
}

.hits {
  list-style: none;
  margin: 0;
  padding: 0 0 0 10px;
}

.hit {
  display: flex;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}

.hit:hover {
  background: var(--bg-hover);
}

.hit__line {
  flex-shrink: 0;
  width: 30px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--hue-text-3);
  user-select: none;
}

.hit__text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--hue-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(mark) {
  background: var(--hue-accent);
  color: #fff;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
