<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../i18n'
import { loadAppearance, resolveMode } from '../appearance'

/**
 * 凝神 2.0 轻退栏（docs/FOCUS-MODE-2.0-DESIGN.md §6）。
 *
 * 「轻退」= 凝神中按 Esc 不退出，只掀起帘子看一眼：
 * 32px 玻璃胶囊悬浮于内容列上方（不占布局空间），显示文件名 · 字数 · 相对保存时间，
 * 右侧提供 凝神设置 / 切换文档 / 退出凝神。再按 Esc 或点击编辑区收起（状态机在 App）。
 */
const props = defineProps<{
  fileName: string
  han: number
  savedAt: number | null
  open: boolean
  tabs: Array<{ path: string }>
  activePath: string | null
}>()

const emit = defineEmits<{
  (e: 'settings'): void
  (e: 'exit'): void
  (e: 'activate', path: string): void
  (e: 'hide'): void
}>()

const { t } = useI18n()
const L = t.ui

const previewMode = resolveMode(loadAppearance().mode)

/* ── 相对保存时间：30s 自刷新，只在挂载期间（凝神中）跑 ── */
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const savedText = computed(() => {
  if (!props.savedAt) return L.statusSaved
  const diff = Math.max(0, now.value - props.savedAt)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return `${L.zenSavedPrefix} ${L.zenSavedJustNow}`
  if (min < 60) return `${L.zenSavedPrefix} ${L.zenSavedMinAgo.replace('{n}', String(min))}`
  const h = Math.floor(min / 60)
  return `${L.zenSavedPrefix} ${L.zenSavedHourAgo.replace('{n}', String(h))}`
})

/* ── 切换文档下拉 ── */
const showDocs = ref(false)

function toggleDocs(): void {
  showDocs.value = !showDocs.value
}

function pick(path: string): void {
  showDocs.value = false
  if (path !== props.activePath) emit('activate', path)
}

/** 标签显示名：去扩展名的文件名 */
function tabName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.(md|markdown)$/i, '')
}
</script>

<template>
  <div class="retreat glass" :class="{ 'retreat--on': open }" :data-mode="previewMode">
    <span class="retreat__name" :title="fileName">{{ fileName }}</span>
    <i class="retreat__dot" />
    <span class="retreat__count">{{ han.toLocaleString() }}</span>
    <i class="retreat__dot" />
    <span class="retreat__saved">{{ savedText }}</span>

    <span class="retreat__grow" />

    <div class="retreat__docs">
      <button class="retreat__btn" type="button" @click="toggleDocs">
        {{ L.zenSwitchDoc }} ▾
      </button>
      <Transition name="drop">
        <div v-if="showDocs" class="docs glass" :data-mode="previewMode">
          <button
            v-for="tab in tabs"
            :key="tab.path"
            class="docs__item"
            :class="{ 'docs__item--on': tab.path === activePath }"
            type="button"
            :title="tabName(tab.path)"
            @click="pick(tab.path)"
          >
            {{ tabName(tab.path) }}
          </button>
        </div>
      </Transition>
    </div>

    <button class="retreat__btn" type="button" @click="emit('settings')">
      ⚙ {{ L.zenSettings }}
    </button>
    <button class="retreat__btn retreat__btn--exit" type="button" @click="emit('exit')">
      {{ L.zenExit }}
    </button>
  </div>
</template>

<style scoped>
.retreat {
  position: fixed;
  top: 10px;
  left: 50%;
  z-index: 55;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 14px;
  border-radius: 10px;
  max-width: min(80vw, 640px);
  font-size: 12px;
  color: var(--hue-text-2);
  transform: translateX(-50%) translateY(-160%);
  opacity: 0;
  transition:
    transform 160ms var(--ease-zen),
    opacity 160ms var(--ease);
}

.retreat--on {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}

.retreat__name {
  color: var(--hue-text-1);
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.retreat__dot {
  opacity: 0.4;
}

.retreat__count {
  font-variant-numeric: tabular-nums;
}

.retreat__saved {
  white-space: nowrap;
}

.retreat__grow {
  flex: 1;
}

.retreat__btn {
  flex-shrink: 0;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--hue-text-2);
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.retreat__btn:hover {
  background: rgba(var(--hue-tint-1), 0.14);
  color: var(--hue-text-1);
}

.retreat__btn--exit {
  color: var(--hue-accent);
}

/* ── 切换文档下拉 ── */
.retreat__docs {
  position: relative;
}

.docs {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  max-width: 320px;
  max-height: 40vh;
  overflow-y: auto;
  border-radius: 10px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.docs__item {
  border: none;
  background: transparent;
  color: var(--hue-text-2);
  text-align: left;
  font-size: 12px;
  padding: 6px 9px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.docs__item:hover {
  background: rgba(var(--hue-tint-1), 0.14);
  color: var(--hue-text-1);
}

.docs__item--on {
  color: var(--hue-accent);
}

.drop-enter-active,
.drop-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}

.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
