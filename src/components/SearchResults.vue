<script setup lang="ts">
import { computed } from 'vue'
import { escapeXml } from '../utils/html'
import { escapeRegExp } from '../utils/regex'
import type { SearchFileResult } from '../../electron/shared/ipc-channels'
import { useI18n } from '../i18n'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  results: SearchFileResult[]
  query: string
  activePath: string | null
  /** 是否区分大小写（高亮规则与搜索保持一致） */
  caseSensitive?: boolean
  /** 是否正则模式（高亮按正则匹配，与搜索一致；默认 false 按字面量） */
  regex?: boolean
  /** 单文件范围（左侧「本文档」）：隐藏文件名分组头，只列出命中行 */
  singleFile?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', path: string, line: number): void
}>()

/** 文件名不显示 md 扩展名，与文件树一致 */
function displayName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

/** 转义后再高亮，防止文件内容里的 HTML 标签造成 XSS */
function highlight(text: string): string {
  const safe = escapeXml(text)
  const q = escapeXml(props.query).trim()
  if (!q) return safe
  const flags = props.caseSensitive ? 'g' : 'gi'
  let re: RegExp
  if (props.regex) {
    // 正则模式：用原始 query 构造正则（匹配片段 m 来自已转义文本 safe，XSS 仍被阻止）；
    // 若用户正则非法则降级为字面量匹配，避免整次高亮失败
    try {
      re = new RegExp(props.query, flags)
    } catch {
      re = new RegExp(escapeRegExp(q), flags)
    }
  } else {
    re = new RegExp(escapeRegExp(q), flags)
  }
  return safe.replace(re, (m) => `<mark>${m}</mark>`)
}

const totalHits = computed(() => props.results.reduce((n, f) => n + f.hits.length, 0))

/** 命中计数文案：单文件范围只报命中数，全库范围附带文件数 */
const metaText = computed(() =>
  props.singleFile
    ? L.searchHits.replace('{n}', String(totalHits.value))
    : L.searchHitsFiles.replace('{n}', String(totalHits.value)).replace('{f}', String(props.results.length))
)
</script>

<template>
  <div class="results">
    <div class="results__meta">{{ metaText }}</div>

    <template v-for="file in results" :key="file.path">
      <button
        v-if="!singleFile"
        class="file__head"
        :class="{ 'file__head--active': file.path === activePath }"
        type="button"
        :title="file.path"
        @click="emit('open', file.path, file.hits[0]?.line ?? 1)"
      >
        <span class="file__name">{{ displayName(file.name) }}</span>
        <span class="file__count">{{ file.hits.length }}</span>
      </button>

      <ul class="hits" :class="{ 'hits--bare': singleFile }">
        <li v-for="hit in file.hits" :key="hit.line">
          <button class="hit" type="button" @click="emit('open', file.path, hit.line)">
            <span class="hit__line">{{ hit.line }}</span>
            <span class="hit__text" v-html="highlight(hit.text)" />
          </button>
        </li>
      </ul>
    </template>
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

/* 单文件范围（本文档）：无文件名分组头，左缩进收敛，视觉更紧凑 */
.hits--bare {
  padding-left: 2px;
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
