<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useI18n } from '../i18n'
import type { BacklinkItem, UnlinkedMention } from '../../electron/shared/ipc-channels'

const { t } = useI18n()
const L = t.ui

const props = defineProps<{
  vaultPath: string | null
  /** 当前激活文档绝对路径；反链都指向它。未打开文档时面板提示先打开一篇 */
  activePath: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open', item: BacklinkItem): void
}>()

const items = ref<BacklinkItem[]>([])
/** 未链接提及：正文里以纯文本提到本笔记名、却没加 [[ ]] 的地方 */
const mentions = ref<UnlinkedMention[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
/** 正在包裹的条目 key（path:line:start），用于单行转圈、避免连点 */
const wrapping = ref<string | null>(null)
const wrapError = ref<string | null>(null)

const count = computed(() => items.value.length)
const mentionCount = computed(() => mentions.value.length)
/** 两个分组只要有一个非空，面板就有内容可展示 */
const hasAny = computed(() => count.value > 0 || mentionCount.value > 0)

function fileBase(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}
function fileDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

/** 当前没有可反查的目标（未开库 / 未打开文档）时，给一个温和提示而非空列表 */
const idle = computed(
  () => !!props.vaultPath && !props.activePath && !loading.value && error.value === null
)

async function run(): Promise<void> {
  error.value = null
  wrapError.value = null
  if (!props.vaultPath || !props.activePath) {
    items.value = []
    mentions.value = []
    return
  }
  loading.value = true
  try {
    // 反链走索引直查、未链接提及需回读正文扫词，两者互不依赖，并行发起省一半等待
    const [back, unlinked] = await Promise.all([
      window.api.getBacklinks(props.vaultPath, props.activePath),
      window.api.getUnlinkedMentions(props.vaultPath, props.activePath)
    ])
    items.value = back
    mentions.value = unlinked
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function mentionKey(m: UnlinkedMention): string {
  return `${m.path}:${m.line}:${m.start}`
}

/**
 * 一键包裹：把该处纯文本替换成 [[笔记名]]。
 * 主进程落笔前会回验原文，若文件在「查询」到「点击」之间已被改动则返回 false ——
 * 此时只提示、绝不覆盖，符合批次一立的「绝不静默覆盖」红线。
 * 包裹成功后重查全量：该处会从「未链接」转为真正的反链，两个分组同时自洽。
 */
async function wrap(m: UnlinkedMention): Promise<void> {
  if (!props.vaultPath || wrapping.value) return
  wrapping.value = mentionKey(m)
  wrapError.value = null
  try {
    const ok = await window.api.wrapMention(props.vaultPath, m)
    if (!ok) {
      wrapError.value = L.unlinkedStale
      return
    }
    await run()
  } catch (e) {
    wrapError.value = e instanceof Error ? e.message : L.unlinkedFail
  } finally {
    wrapping.value = null
  }
}

/** 切到另一篇文档时静默刷新反链（不闪 loading，保持面板连贯） */
watch(
  () => props.activePath,
  () => {
    if (props.vaultPath && props.activePath) void run()
    else {
      items.value = []
      mentions.value = []
      error.value = null
      wrapError.value = null
    }
  }
)

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  void run()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="bl glass" role="dialog" aria-label="反链面板">
    <div class="bl__head">
      <Icon name="backlink" :size="15" class="bl__icon" />
      <span class="bl__title">{{ L.backlinks }}</span>
      <span v-if="count > 0" class="bl__count">{{ count }}</span>
      <button
        class="bl__rerun"
        type="button"
        :title="L.backlinksRerun"
        :disabled="loading || !vaultPath || !activePath"
        @click="run"
      >
        <Icon name="history" :size="13" />
      </button>
      <button class="bl__x" type="button" :title="L.backlinksClose" @click="emit('close')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <p v-if="!vaultPath" class="bl__empty">
      <Icon name="backlink" :size="16" />
      {{ L.backlinksNoVault }}
    </p>
    <p v-else-if="idle" class="bl__empty">
      <Icon name="file" :size="16" />
      {{ L.backlinksEmpty }}
    </p>
    <!-- 刷新时保留旧内容（loading && !hasAny），避免包裹成功后面板闪一下空白 -->
    <p v-else-if="loading && !hasAny" class="bl__empty">
      <Icon name="loader" :size="16" class="bl__spin" />
      {{ L.backlinksScanning }}
    </p>
    <p v-else-if="error" class="bl__empty bl__empty--err">
      <Icon name="unlink" :size="16" />
      {{ error }}
    </p>
    <p v-else-if="!hasAny" class="bl__empty">
      <Icon name="check" :size="16" />
      {{ L.backlinksEmpty }}
    </p>

    <template v-else>
      <div class="bl__list">
        <!-- 反链：已成链的引用 -->
        <div v-for="(it, i) in items" :key="i" class="row">
          <button
            type="button"
            class="row__main"
            :title="`${fileBase(it.path)}:${it.line}\n${it.snippet}`"
            @click="emit('open', it)"
          >
            <span class="row__top">
              <span class="row__file">{{ fileBase(it.path) }}</span>
              <span class="row__line">:{{ it.line }}</span>
            </span>
            <span class="row__ctx">{{ it.snippet }}</span>
            <span class="row__dir">{{ fileDir(it.path) }}</span>
          </button>
        </div>

        <!-- 未链接提及：提到本笔记名但没加 [[ ]]，可一键包裹 -->
        <template v-if="mentionCount > 0">
          <div class="bl__sec">
            <span class="bl__sec-name">{{ L.unlinked }}</span>
            <span class="bl__sec-n">{{ mentionCount }}</span>
          </div>
          <div v-for="m in mentions" :key="mentionKey(m)" class="row">
            <button
              type="button"
              class="row__main"
              :title="`${fileBase(m.path)}:${m.line}\n${m.snippet}`"
              @click="emit('open', m)"
            >
              <span class="row__top">
                <span class="row__file">{{ fileBase(m.path) }}</span>
                <span class="row__line">:{{ m.line }}</span>
              </span>
              <span class="row__ctx">{{ m.snippet }}</span>
              <span class="row__dir">{{ fileDir(m.path) }}</span>
            </button>
            <button
              type="button"
              class="row__act"
              :class="{ 'row__act--busy': wrapping === mentionKey(m) }"
              :title="L.unlinkedWrap"
              :disabled="wrapping !== null"
              @click="wrap(m)"
            >
              <Icon
                :name="wrapping === mentionKey(m) ? 'loader' : 'link'"
                :size="13"
                :class="{ bl__spin: wrapping === mentionKey(m) }"
              />
            </button>
          </div>
        </template>
      </div>
      <p v-if="wrapError" class="bl__hint bl__hint--err">{{ wrapError }}</p>
      <p class="bl__hint">{{ L.backlinksHint }}</p>
    </template>
  </div>
</template>

<style scoped>
.bl {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 30;
  width: 372px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  padding: 12px;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: bl-in 0.18s var(--ease, ease) both;
}
@keyframes bl-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bl__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bl__icon {
  color: var(--hue-accent);
}
.bl__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--hue-text-1);
}
.bl__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hue-on-accent);
  background: var(--hue-accent);
  border-radius: 999px;
  padding: 1px 7px;
  min-width: 18px;
  text-align: center;
}
.bl__rerun,
.bl__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--hue-text-3);
  cursor: pointer;
}
.bl__rerun {
  margin-left: auto;
}
.bl__x {
  margin-left: 2px;
}
.bl__rerun:hover:not(:disabled),
.bl__x:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.14));
  color: var(--hue-text-1);
}
.bl__rerun:disabled {
  opacity: 0.4;
  cursor: default;
}

.bl__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12px;
  color: var(--hue-text-3);
  text-align: center;
  padding: 22px 8px;
  line-height: 1.6;
}
.bl__empty--err {
  color: var(--hue-danger, #f34f45);
}
.bl__spin {
  animation: bl-spin 0.9s linear infinite;
}
@keyframes bl-spin {
  to {
    transform: rotate(360deg);
  }
}

.bl__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: var(--hue-surface);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-fast, 0.12s) var(--ease, ease),
    border-color var(--dur-fast, 0.12s) var(--ease, ease);
}
.row:hover {
  background: var(--hue-surface-2);
  border-color: var(--hue-accent);
}

.row__top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.row__file {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--hue-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__line {
  font-size: 11px;
  color: var(--hue-accent);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.row__ctx {
  flex-basis: 100%;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--hue-text-3);
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-left: 2px solid var(--hue-border-subtle);
  padding-left: 6px;
}
.row__dir {
  flex: 0 0 auto;
  max-width: 36%;
  font-size: 10.5px;
  color: var(--hue-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  align-self: center;
}

.bl__hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--hue-text-3);
}
</style>
