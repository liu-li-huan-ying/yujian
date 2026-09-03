<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import { parseFrontmatter, serializeFrontmatter } from '../editor/frontmatter'

const props = defineProps<{
  /** 当前文档全文（用于解析 frontmatter），打开时快照一次 */
  currentText: string
  /** 是否已有打开的文档（决定是否允许编辑） */
  canEdit: boolean
}>()

const emit = defineEmits<{
  (e: 'apply', text: string): void
  (e: 'insert', text: string): void
  (e: 'close'): void
}>()

const { t: L } = useI18n()
const wa = L.ui.writingAids

type Tab = 'props' | 'snippets'
const activeTab = ref<Tab>('props')

/** 表单字段（字符串形态，便于输入框双向绑定） */
const form = reactive({
  title: '',
  author: '',
  description: '',
  tags: '',
  date: '',
  moc: false
})

/** 解析结果缓存：正文与未知字段在 apply 时原样透传 */
let parsed = { data: {} as Record<string, unknown>, content: '' }

function setOrDelete(data: Record<string, unknown>, key: string, value: string): void {
  const v = value.trim()
  if (v) data[key] = v
  else delete data[key]
}

function loadFrom(text: string): void {
  parsed = parseFrontmatter(text)
  const d = parsed.data
  form.title = typeof d.title === 'string' ? d.title : d.title != null ? String(d.title) : ''
  form.author = typeof d.author === 'string' ? d.author : d.author != null ? String(d.author) : ''
  form.description =
    typeof d.description === 'string' ? d.description : d.description != null ? String(d.description) : ''
  const tags = Array.isArray(d.tags)
    ? d.tags.map((x) => (typeof x === 'string' ? x : String(x))).filter(Boolean)
    : []
  form.tags = tags.join(', ')
  form.moc = d.moc === true || d.moc === 'true' || d.moc === 'yes' || d.moc === 'on' || d.moc === '1'
  // 日期：YAML 可能解析成 Date 或字符串，统一取 YYYY-MM-DD
  if (d.date != null) {
    const dt = d.date instanceof Date ? d.date : new Date(String(d.date))
    form.date = isNaN(dt.getTime()) ? String(d.date) : dt.toISOString().slice(0, 10)
  } else {
    form.date = ''
  }
}

onMounted(() => {
  if (props.canEdit) loadFrom(props.currentText)
})

function applyFrontmatter(): void {
  const data: Record<string, unknown> = { ...parsed.data }
  setOrDelete(data, 'title', form.title)
  setOrDelete(data, 'author', form.author)
  setOrDelete(data, 'description', form.description)
  const tags = form.tags
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (tags.length) data.tags = tags
  else delete data.tags
  setOrDelete(data, 'date', form.date)
  if (form.moc) data.moc = true
  else delete data.moc
  const next = serializeFrontmatter(data, parsed.content)
  emit('apply', next)
  emit('close')
}

/** 片段模板：点击在光标处插入（保留正文，不改模式） */
interface Snippet {
  label: string
  body: string
}
const snippets: Snippet[] = [
  { label: wa.snipDoc, body: '# 标题\n\n> 摘要：\n\n## 1. 引言\n\n## 2. 正文\n\n## 3. 结论\n' },
  { label: wa.snipCode, body: '```ts\n// code\n```\n' },
  { label: wa.snipTable, body: '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n' },
  { label: wa.snipCallout, body: '> [!NOTE]\n> 提示内容\n' },
  { label: wa.snipTask, body: '- [ ] 任务一\n- [ ] 任务二\n' },
  { label: wa.snipFoot, body: '[^1]: 脚注说明\n' },
  { label: wa.snipMermaid, body: '```mermaid\nflowchart TD\n  A[开始] --> B[处理] --> C[结束]\n```\n' },
  { label: wa.snipMath, body: '$$\nE = mc^2\n$$\n' }
]

function insertSnippet(s: Snippet): void {
  emit('insert', s.body)
}
</script>

<template>
  <section class="glass wa" role="dialog" :aria-label="wa.title">
    <header class="wa__header">
      <span class="wa__title">{{ wa.title }}</span>
      <button class="wa__close" type="button" :title="wa.close" @click="emit('close')">
        <Icon name="x" :size="15" />
      </button>
    </header>

    <div class="wa__tabs">
      <button
        class="wa__tab"
        :class="{ 'wa__tab--on': activeTab === 'props' }"
        type="button"
        @click="activeTab = 'props'"
      >
        {{ wa.tabProps }}
      </button>
      <button
        class="wa__tab"
        :class="{ 'wa__tab--on': activeTab === 'snippets' }"
        type="button"
        @click="activeTab = 'snippets'"
      >
        {{ wa.tabSnippets }}
      </button>
    </div>

    <!-- 属性：frontmatter 表单 -->
    <div v-if="activeTab === 'props'" class="wa__body">
      <p v-if="!canEdit" class="wa__nodoc">{{ wa.noDoc }}</p>

      <template v-else>
        <div class="wa__field">
          <label class="wa__label" for="wa-title">{{ wa.labelTitle }}</label>
          <input id="wa-title" v-model="form.title" class="wa__input" :placeholder="wa.placeTitle" />
        </div>
        <div class="wa__field">
          <label class="wa__label" for="wa-author">{{ wa.labelAuthor }}</label>
          <input id="wa-author" v-model="form.author" class="wa__input" :placeholder="wa.placeAuthor" />
        </div>
        <div class="wa__field">
          <label class="wa__label" for="wa-desc">{{ wa.labelDesc }}</label>
          <input id="wa-desc" v-model="form.description" class="wa__input" :placeholder="wa.placeDesc" />
        </div>
        <div class="wa__field">
          <label class="wa__label" for="wa-tags">{{ wa.labelTags }}</label>
          <input id="wa-tags" v-model="form.tags" class="wa__input" :placeholder="wa.placeTags" />
          <span class="wa__hint">{{ wa.tagsHint }}</span>
        </div>
        <div class="wa__field">
          <label class="wa__label" for="wa-date">{{ wa.labelDate }}</label>
          <input id="wa-date" v-model="form.date" type="date" class="wa__input" />
        </div>
        <div class="wa__field wa__field--check">
          <label class="wa__check" for="wa-moc">
            <input id="wa-moc" v-model="form.moc" type="checkbox" class="wa__checkbox" />
            <span class="wa__check-label">{{ wa.labelMoc }}</span>
          </label>
          <span class="wa__hint">{{ wa.mocHint }}</span>
        </div>
      </template>
    </div>

    <!-- 片段：模板插入 -->
    <div v-else class="wa__body">
      <p v-if="!canEdit" class="wa__nodoc">{{ wa.noDoc }}</p>
      <div v-else class="wa__snips">
        <button
          v-for="s in snippets"
          :key="s.label"
          class="wa__snip"
          type="button"
          @click="insertSnippet(s)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <footer v-if="activeTab === 'props' && canEdit" class="wa__footer">
      <button class="wa__apply" type="button" @click="applyFrontmatter">{{ wa.apply }}</button>
    </footer>
  </section>
</template>

<style scoped>
.wa {
  position: absolute;
  top: calc(var(--h-titlebar) + 8px);
  right: 12px;
  z-index: 30;
  width: 300px;
  max-height: calc(100% - var(--h-titlebar) - 40px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.wa__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--hue-border-subtle);
}

.wa__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
}

.wa__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.wa__close:hover {
  background: var(--hue-active);
  color: var(--hue-text-1);
}

.wa__tabs {
  display: flex;
  gap: 2px;
  padding: 8px 10px 0;
}

.wa__tab {
  flex: 1;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 6px 0;
  background: transparent;
  color: var(--hue-text-3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.wa__tab:hover {
  color: var(--hue-text-1);
}
.wa__tab--on {
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font-weight: 500;
}

.wa__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.wa__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wa__label {
  font-size: 11px;
  color: var(--hue-text-3);
}

.wa__hint {
  font-size: 10.5px;
  color: var(--hue-text-3);
  opacity: 0.8;
}

.wa__input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--hue-highlight);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12.5px;
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.wa__input:focus {
  outline: none;
  border-color: var(--hue-accent);
  box-shadow: 0 0 0 2px rgba(var(--hue-tint-1), 0.25);
}

.wa__field--check {
  gap: 5px;
}

.wa__check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  user-select: none;
}

.wa__checkbox {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--hue-accent);
  cursor: pointer;
}

.wa__check-label {
  font-size: 12px;
  color: var(--hue-text-1);
}

.wa__nodoc {
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 18px 8px;
}

.wa__snips {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.wa__snip {
  padding: 9px 8px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--hue-highlight);
  color: var(--hue-text-1);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.wa__snip:hover {
  border-color: var(--hue-accent);
  color: var(--hue-accent);
  background: rgba(var(--hue-tint-1), 0.12);
}

.wa__footer {
  padding: 10px 12px;
  border-top: 1px solid var(--hue-border-subtle);
}

.wa__apply {
  width: 100%;
  padding: 7px 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--hue-accent);
  color: var(--hue-on-accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: filter var(--dur-fast) var(--ease);
}
.wa__apply:hover {
  filter: brightness(1.06);
}
</style>
