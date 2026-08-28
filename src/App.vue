<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import TitleBar from './components/TitleBar.vue'
import EditorHost from './editor/EditorHost.vue'
import type { EditorMode } from './editor/EditorHost.vue'

const filePath = ref<string | null>(null)
const requestedMode = ref<EditorMode>('wysiwyg')
const host = ref<InstanceType<typeof EditorHost> | null>(null)
const lastSavedAt = ref<number | null>(null)

const fileName = computed(() =>
  filePath.value ? filePath.value.split(/[\\/]/).pop() ?? '' : '未命名'
)

const modeLabel = computed(() => (requestedMode.value === 'wysiwyg' ? '所见即所得' : '源码'))

async function openFile(): Promise<void> {
  const picked = await window.api.openFileDialog()
  if (!picked) return
  filePath.value = picked
  await host.value?.load(picked)
  lastSavedAt.value = Date.now()
}

async function saveFile(): Promise<void> {
  if (!filePath.value) return void (await saveFileAs())
  await host.value?.save()
  lastSavedAt.value = Date.now()
}

async function saveFileAs(): Promise<void> {
  const picked = await window.api.saveFileDialog(filePath.value ?? undefined)
  if (!picked) return
  filePath.value = picked
  await host.value?.save()
  lastSavedAt.value = Date.now()
}

function onKeydown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 's') {
    e.preventDefault()
    void saveFile()
  } else if (k === 'o') {
    e.preventDefault()
    void openFile()
  } else if (e.key === '/') {
    e.preventDefault()
    requestedMode.value = requestedMode.value === 'wysiwyg' ? 'source' : 'wysiwyg'
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="shell">
    <TitleBar
      :file-name="fileName"
      :mode="requestedMode"
      :dirty="host?.dirty ?? false"
      @open="openFile"
      @save="saveFile"
      @update:mode="requestedMode = $event"
    />

    <div class="body">
      <main class="editor">
        <EditorHost
          ref="host"
          :file-path="filePath"
          :requested-mode="requestedMode"
          @saved="lastSavedAt = Date.now()"
        />
      </main>
    </div>

    <footer class="statusbar jade">
      <div class="statusbar__inner">
        <div class="statusbar__grp">
          <span>{{ filePath ?? '未选择文件' }}</span>
        </div>
        <div class="statusbar__grp">
          <span v-if="host?.willNormalize" class="warn">保存时将规范化排版</span>
          <span>
            <i class="dot" :class="host?.dirty ? 'dot--dirty' : 'dot--saved'" />
            {{ host?.dirty ? '未保存' : '已保存' }}
          </span>
          <span>{{ modeLabel }}</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hue-editor);
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.editor {
  flex: 1;
  min-width: 0;
  display: flex;
  background: var(--hue-editor);
}

.statusbar {
  height: var(--h-statusbar);
  flex-shrink: 0;
  border-top: 1px solid var(--hue-border-subtle);
}

.statusbar__inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 14px;
  font-size: 11px;
  color: var(--hue-text-3);
}

.statusbar__grp {
  display: flex;
  gap: 14px;
  align-items: center;
}

.warn {
  color: var(--hue-accent);
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: middle;
}

.dot--saved {
  background: var(--hue-success);
}

.dot--dirty {
  background: var(--hue-accent);
}
</style>
