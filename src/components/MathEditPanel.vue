<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ElementEditPopover from './ElementEditPopover.vue'
import { renderLatexContent, renderMathToSvg } from '../render/mathjax'
import { buildSymbolGroups, symbolTip, type MathSymbol } from '../utils/mathSymbols'
import { i18n } from '../i18n'

/**
 * 复杂元素临时编辑界面 · 公式（UI-DESIGN §4.4）。
 *
 * 上半 LaTeX 源码输入（等宽 14px）、下半实时预览、常用符号工具条（4 组，每组 ≤8）、
 * 底部显示 `\label` 与编号状态。
 *
 * 关键取舍：**渲染直接复用 `mathjax.ts`**（`renderMathToSvg` / `renderLatexContent`），
 * 于是「编辑时看到的预览」与「文档里最终渲染的公式」是同一个 MathJax 实例、同一套
 * `tags:'ams'` 编号语义——不另起预览渲染器，杜绝两套引擎结果打架（KaTeX 与 MathJax
 * 对 `\require` / `\ce` / `\label` 的支持本就不同）。
 *
 * 值的所有权在本面板：草稿先留在 `draft`，`dismiss('apply')` 时才 `emit('update')`；
 * 取消则直接丢弃，文档一个字节都不动。
 */
const props = withDefaults(
  defineProps<{
    /** 初始 LaTeX 源码 */
    value: string
    /** true = 行间公式（参与 \label 编号），false = 行内公式 */
    display?: boolean
    /** 目标块元素（定位 + 打开期间加强调描边） */
    anchor?: HTMLElement | null
  }>(),
  { display: false, anchor: null },
)

const emit = defineEmits<{
  (e: 'update', value: string): void
  (e: 'cancel'): void
}>()

const L = i18n.mathEdit
const draft = ref(props.value)
const input = ref<HTMLTextAreaElement | null>(null)
const preview = ref<HTMLDivElement | null>(null)

/* ── 符号工具条：4 组，每组 ≤8（规格 §4.4） ──
   表在 src/utils/mathSymbols.ts（纯数据，可被 test-core 断言「每个符号都有 label + tip」）。
   片段里写 `{}` 表示「插入后光标落进括号里」，见 insertSymbol。
   视觉与提示口径必须与编辑区另两处药丸托盘（块操作手柄 / 行内工具条）一致，
   见 styles/editor.css 注释。 */
const GROUPS = computed(() => buildSymbolGroups(L.groups))

/** 插入符号并把光标落到第一个 `{}` 内 —— 少一次手动移光标，手感差很多 */
function insertSymbol(s: MathSymbol): void {
  const snippet = s.cmd
  const ta = input.value
  if (!ta) return
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const slot = snippet.indexOf('{}')
  draft.value = draft.value.slice(0, start) + snippet + draft.value.slice(end)
  const caret = slot >= 0 ? start + slot + 1 : start + snippet.length
  // 等 Vue 把 draft 刷回 textarea 再设选区，否则 setSelectionRange 会被随后的一次渲染冲掉
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(caret, caret)
  })
  scheduleRender()
}

/* ── 实时预览 ──
   MathJax 体积大且渲染有开销，输入防抖 180ms；用自增令牌丢弃过期结果，
   避免慢渲染覆盖新渲染（与 mathjax.ts 的 nodeView 同一套守卫）。 */
let timer: number | undefined
let renderToken = 0

function scheduleRender(): void {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void runRender(), 180)
}

async function runRender(): Promise<void> {
  const src = draft.value.trim()
  const el = preview.value
  if (!el) return
  if (!src) {
    el.innerHTML = ''
    return
  }
  const mine = ++renderToken
  // 行间走 renderLatexContent（支持整篇 LaTeX 文档 / \label 编号），行内走 renderMathToSvg
  const html = props.display
    ? await renderLatexContent(src)
    : await renderMathToSvg(src, false)
  if (mine !== renderToken) return
  // MathJax 输出（SVG / 转义后的文本段）不含用户可控 HTML，直接写入与 nodeView 行为一致
  el.innerHTML = html
}

watch(draft, scheduleRender)

/* ── \label 状态 ── */
const labels = ref<string[]>([])
function refreshLabels(): void {
  const out: string[] = []
  for (const m of draft.value.matchAll(/\\label\s*\{([^{}]*)\}/g)) {
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  labels.value = out
}
watch(draft, refreshLabels, { immediate: true })

/* ── 打开期间给目标块加 2px accent 描边（规格 §4.4「打开时对应块加描边」）──
   存下旧 outline 再覆盖，关闭时原样还原，避免污染行内样式。 */
let savedOutline = ''
function markTarget(): void {
  const el = props.anchor
  if (!el) return
  savedOutline = el.style.outline
  el.style.outline = '2px solid var(--hue-accent)'
  el.style.outlineOffset = '1px'
}
function unmarkTarget(): void {
  const el = props.anchor
  if (!el) return
  el.style.outline = savedOutline
  el.style.outlineOffset = ''
}

function onDismiss(reason: 'apply' | 'cancel'): void {
  if (reason === 'apply') emit('update', draft.value)
  else emit('cancel')
}

onMounted(() => {
  markTarget()
  void runRender()
  requestAnimationFrame(() => {
    const ta = input.value
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  })
})

onBeforeUnmount(() => {
  window.clearTimeout(timer)
  unmarkTarget()
})
</script>

<template>
  <ElementEditPopover
    :title="display ? L.titleBlock : L.titleInline"
    :anchor="anchor"
    :width="560"
    @dismiss="onDismiss"
  >
    <div class="yj-me-syms" role="toolbar" :aria-label="L.symbols">
      <div v-for="g in GROUPS" :key="g.label" class="yj-me-group" :aria-label="g.label">
        <button
          v-for="s in g.items"
          :key="s.cmd"
          type="button"
          class="yj-me-sym"
          :title="symbolTip(s)"
          :aria-label="symbolTip(s)"
          @click="insertSymbol(s)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <div class="yj-me-row">
      <div class="yj-me-pane">
        <div class="yj-me-label">{{ L.source }}</div>
        <textarea ref="input" v-model="draft" class="yj-me-input" spellcheck="false" />
      </div>
      <div class="yj-me-pane">
        <div class="yj-me-label">{{ L.preview }}</div>
        <div ref="preview" class="yj-me-preview" />
      </div>
    </div>

    <div class="yj-me-status">
      <template v-if="labels.length">
        <span class="yj-me-labels">\label</span>
        <span v-for="l in labels" :key="l" class="yj-me-tag">{{ l }}</span>
      </template>
      <template v-else>
        <span class="yj-me-none">{{ L.noLabel }}</span>
        <span class="yj-me-tag dim">{{ L.noNumber }}</span>
      </template>
    </div>
  </ElementEditPopover>
</template>

<style scoped>
.yj-me-syms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 12px;
}
.yj-me-group {
  display: flex;
  gap: 4px;
  padding-right: 10px;
  border-right: 1px solid var(--hue-border-subtle);
}
.yj-me-group:last-child {
  border-right: none;
}
/* 符号药丸：视觉与编辑区另两处托盘（块操作手柄 / 行内工具条）同源 ——
   图标（这里是符号字形）用 --hue-text-2 / opacity .9，hover 一律 --hue-active 底
   且字色转 accent，active 沿用同一套，不再用 t3 灰与硬编码 rgba。
   规格 §4.4「工具条按钮 28×28」保持。 */
.yj-me-sym {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--hue-text-2);
  opacity: 0.9;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-13);
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.yj-me-sym:hover {
  background: var(--hue-active);
  color: var(--hue-accent);
  opacity: 1;
}
.yj-me-sym:active {
  background: var(--hue-active);
  color: var(--hue-accent);
  border-color: var(--hue-accent);
}

.yj-me-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.yj-me-label {
  margin-bottom: 6px;
  font-size: var(--fs-12);
  color: var(--hue-text-3);
}
.yj-me-input {
  width: 100%;
  min-height: 150px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--hue-surface-2);
  color: var(--hue-text-1);
  /* 等宽 14px（规格 §4.4） */
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-14);
  line-height: 1.6;
  outline: none;
}
.yj-me-input:focus {
  border-color: var(--hue-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hue-accent) 22%, transparent);
}
.yj-me-preview {
  min-height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--hue-border-subtle);
  border-radius: var(--radius-md);
  background: var(--hue-surface-2);
}
.yj-me-preview :deep(svg) {
  max-width: 100%;
  height: auto;
}

.yj-me-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  font-size: var(--fs-12);
  color: var(--hue-text-2);
}
.yj-me-labels {
  font-family: var(--font-mono, ui-monospace, monospace);
  color: var(--hue-text-3);
}
.yj-me-tag {
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--hue-accent) 18%, transparent);
  color: var(--hue-accent);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-11);
}
.yj-me-tag.dim {
  background: var(--hue-surface-2);
  color: var(--hue-text-3);
}
.yj-me-none {
  color: var(--hue-text-3);
}
</style>
