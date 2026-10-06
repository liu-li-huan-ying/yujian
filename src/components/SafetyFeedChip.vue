<script setup lang="ts">
/**
 * 状态栏「安全」芯片 + 其展开的面板（2026-10-04）。
 *
 * ## 为什么不直接写进 App.vue
 *
 * App.vue 当时是 **1499/1500 行**（`check-structure` 硬上限），只剩 1 行余量。
 * 故把「芯片 + 浮层」整块收进本组件，App.vue 侧只留两处一行接入点。
 *
 * ## 为什么值得占掉那 1 行
 *
 * 上一轮把「备份失败 / 读不到原文 / 回收站降级」这些**静默失效**全部修成了
 * 「会上报」，但上报只到 IPC 边界 —— 渲染层没人在看。
 * 本组件是那条链路的**最后一跳**：出错即常驻红点，点击可看历史。
 *
 * 与右侧「完整性自检」芯片的分工：那颗是**用户主动触发**的诊断（vault 级扫描），
 * 本颗是**系统主动告知**的降级历史（零扫描、常驻）。两者不重复。
 */
import Icon from './Icon.vue'
import { computed, ref } from 'vue'
import SafetyFeedPanel from './SafetyFeedPanel.vue'
import { useI18n } from '../i18n'
import { useSafetyFeed } from '../composables/useSafetyFeed'

const { t } = useI18n()
const L = t.ui
const feed = useSafetyFeed()

/**
 * 展开态**由组件自管**（不再上提到 App.vue）。
 * 理由：App.vue 当时 1499/1500 行，只剩 1 行余量；上提 open 会多出 2 行（ref + v-model 绑定）。
 * 自管还有个好处：面板开合是纯局部 UI 状态，本就不该污染 App 的状态层。
 */
const open = ref(false)

// 芯片只关心「有没有未读」和「总数」，不必把整个 feed 透出模板。
// 但 notices 是 Ref —— 在 <script setup> 里需显式 .value，模板中才自动解包。
const unread = computed(() => feed.hasUnread.value)
const hasError = computed(() => feed.hasError.value)
const count = computed(() => feed.notices.value.length)

function toggle(): void {
  open.value = !open.value
  // 打开即视为已读：用户主动来看过了，红点不该还挂着
  if (open.value) feed.markRead()
}
</script>

<template>
  <button
    v-if="unread"
    class="warn-chip"
    type="button"
    :class="{ 'warn-chip--err': hasError }"
    :title="L.safetyFeed"
    @click="toggle"
  >
    <Icon name="shield" :size="12" />
    {{ count }}
  </button>

  <!--
    Teleport 到 body：面板挂在状态栏内会被 footer 的 overflow 裁切，
    且 App.vue 当时只剩 1 行余量（1500 上限），不能再加独立浮层挂载块。
  -->
  <Teleport to="body">
    <SafetyFeedPanel v-if="open" @close="open = false" />
  </Teleport>
</template>
