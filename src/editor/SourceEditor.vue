<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let applying = false

onMounted(() => {
  if (!host.value) return

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applying) return
          emit('update:modelValue', update.state.doc.toString())
        })
      ]
    })
  })
})

/** 外部替换内容（切换模式时），不触发 update 事件 */
watch(
  () => props.modelValue,
  (next) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === next) return
    applying = true
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next }
    })
    applying = false
  }
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

/** 跳转到指定行（全文搜索结果点击时调用）：选中该行并滚动到视图中央 */
function revealLine(line: number): void {
  if (!view) return
  const total = view.state.doc.lines
  const target = Math.min(Math.max(line, 1), total)
  const lineObj = view.state.doc.line(target)
  view.dispatch({
    selection: { anchor: lineObj.from },
    effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' })
  })
  view.focus()
}

defineExpose({ revealLine })
</script>

<template>
  <div ref="host" class="source-host" />
</template>

<style scoped>
.source-host {
  height: 100%;
  overflow: hidden;
}
</style>
