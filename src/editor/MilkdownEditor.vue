<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { languages } from '@codemirror/language-data'
import { Crepe } from '@milkdown/crepe'
import { replaceAll } from '@milkdown/utils'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import '../styles/editor.css'
import { renderPreview } from './features/mermaid'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
  }>(),
  { readonly: false }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'ready'): void
}>()

const host = ref<HTMLDivElement | null>(null)
let crepe: Crepe | null = null
let mounted = false

async function init(): Promise<void> {
  if (!host.value || mounted) return
  mounted = true

  crepe = new Crepe({
    root: host.value,
    defaultValue: props.modelValue,
    features: {
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.ImageBlock]: true,
      [Crepe.Feature.BlockEdit]: true,
      [Crepe.Feature.Toolbar]: true,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: true,
      // 顶部常驻工具条与 AI 暂不启用
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.AI]: false
    },
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        // languages 默认是空数组 —— 不传就没有语法高亮
        languages,
        // 接管预览区：mermaid 渲染成图表，其余语言保持无预览
        renderPreview,
        previewLabel: '预览',
        previewLoading: '渲染中…',
        searchPlaceholder: '搜索语言',
        noResultText: '无匹配语言',
        copyText: '复制'
      }
    }
  })

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      emit('update:modelValue', markdown)
    })
  })

  await crepe.create()
  crepe.setReadonly(props.readonly)
  emit('ready')
}

onMounted(() => {
  void init()
})

onBeforeUnmount(() => {
  void crepe?.destroy()
  crepe = null
  mounted = false
})

/** 供父组件在切回 WYSIWYG 时灌入源码文本 */
function setMarkdown(markdown: string): void {
  if (!crepe) return
  crepe.editor.action(replaceAll(markdown))
}

function getMarkdown(): string {
  return crepe?.getMarkdown() ?? props.modelValue
}

function setReadonly(value: boolean): void {
  crepe?.setReadonly(value)
}

defineExpose({ setMarkdown, getMarkdown, setReadonly })
</script>

<template>
  <div ref="host" class="milkdown-host" />
</template>

<style scoped>
.milkdown-host {
  height: 100%;
  overflow: hidden;
}
</style>
