<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { i18n } from '../i18n'

/**
 * 复杂元素临时编辑界面 · 共用玻璃浮层外壳（UI-DESIGN §4.4）。
 *
 * 三种元素（表格 / 代码块 / 公式）共用同一套外壳与交互契约：
 *  - `Esc` 与「点击外部」=**关闭并应用**；右上角 `×` 与「取消」=**关闭且不应用**；
 *  - `.glass` 材质、圆角 `--radius-lg`、padding 16px、阴影 `--hue-shadow-2`；
 *  - 打开时目标块加 2px accent 描边（由调用方负责，见 `.yj-editing-target`）。
 *
 * 本外壳**只做呈现与关闭裁决，不持有任何编辑值**——值的所有权在各元素面板里
 * （面板监听 `dismiss` 决定「应用时交出草稿」还是「取消时丢弃」），
 * 这样新增一种元素不必改外壳。
 */
const props = withDefaults(
  defineProps<{
    title: string
    /**
     * 目标块元素（用于定位）。传元素而非矩形：滚动 / 缩放时可重新测量，
     * 避免用打开那一刻的过期坐标把浮层甩到屏幕外。
     */
    anchor?: HTMLElement | null
    /** 浮层宽度（窄屏自动收敛到视口内） */
    width?: number
  }>(),
  { anchor: null, width: 560 },
)

const emit = defineEmits<{
  (e: 'dismiss', reason: 'apply' | 'cancel'): void
}>()

const card = ref<HTMLDivElement | null>(null)
const style = ref({ left: '0px', top: '0px', width: `${props.width}px` })

/** 定位：优先落在目标块下方；下方放不下翻上方；上下都不够则贴底并夹进视口 */
function place(): void {
  const el = card.value
  if (!el) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(props.width, vw - 24)
  const h = el.offsetHeight
  const rect = props.anchor?.getBoundingClientRect() ?? null

  let left = rect ? rect.left : (vw - w) / 2
  let top = rect ? rect.bottom + 8 : 96
  left = Math.max(12, Math.min(left, vw - w - 12))

  if (top + h > vh - 12) {
    if (rect && rect.top - h - 8 >= 12) top = rect.top - h - 8
    else top = Math.max(12, vh - h - 12)
  }
  style.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${w}px`,
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('dismiss', 'apply')
}

let ro: ResizeObserver | null = null

onMounted(() => {
  // rAF 等一帧：首帧卡片高度尚未确定，直接量会得到 0 而定位偏移
  requestAnimationFrame(place)
  window.addEventListener('resize', place)
  // 捕获阶段：编辑区内部容器滚动也要跟随，否则浮层会脱离目标块
  window.addEventListener('scroll', place, true)
  document.addEventListener('keydown', onKey, true)
  if (card.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => place())
    ro.observe(card.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
  document.removeEventListener('keydown', onKey, true)
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <Teleport to="body">
    <div class="yj-elem-pop-root">
      <!-- 透明背板：只用来接「点击外部」→ 应用并关闭；不拦截视觉 -->
      <div class="yj-elem-pop-backdrop" @pointerdown="emit('dismiss', 'apply')" />
      <div ref="card" class="glass yj-elem-pop" :style="style">
        <div class="yj-ep-head">
          <span class="yj-ep-title">{{ title }}</span>
          <button
            type="button"
            class="yj-ep-x"
            :title="i18n.mathEdit.cancel"
            @click="emit('dismiss', 'cancel')"
          >
            ×
          </button>
        </div>

        <div class="yj-ep-body">
          <slot />
        </div>

        <div class="yj-ep-foot">
          <slot name="footer">
            <button type="button" class="yj-ep-btn" @click="emit('dismiss', 'cancel')">
              {{ i18n.mathEdit.cancel }}
            </button>
            <button type="button" class="yj-ep-btn primary" @click="emit('dismiss', 'apply')">
              {{ i18n.mathEdit.apply }}
            </button>
          </slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 70：高于右键菜单 / WikiSuggest(60)、低于命令面板(80)——它是编辑区内的临时浮层 */
.yj-elem-pop-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}
.yj-elem-pop-backdrop {
  position: absolute;
  inset: 0;
}
.yj-elem-pop {
  position: absolute;
  border-radius: var(--radius-lg);
  padding: 16px;
  color: var(--hue-text-1);
}
.yj-ep-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.yj-ep-title {
  font-size: var(--fs-14);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.yj-ep-x {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  /* 与编辑区各处药丸托盘同款：图标 t2 / 0.9，hover 走 --hue-active + accent，
     不再用更暗的 t3 与硬编码灰兜底（那正是「同屏像两个软件」的来源）。 */
  color: var(--hue-text-2);
  opacity: 0.9;
  font-size: var(--fs-16);
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.yj-ep-x:hover {
  background: var(--hue-active);
  color: var(--hue-accent);
  opacity: 1;
}
.yj-ep-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.yj-ep-btn {
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--hue-border-subtle);
  /* 次级按钮底走 --bg-hover（与全局 hover 同一来源），不再硬编码白 8% */
  background: var(--bg-hover);
  color: var(--hue-text-1);
  font-size: var(--fs-13);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.yj-ep-btn:hover {
  background: var(--hue-active);
}
.yj-ep-btn.primary {
  background: var(--hue-accent);
  border-color: transparent;
  color: var(--hue-on-accent);
  font-weight: 600;
}
.yj-ep-btn.primary:hover {
  filter: brightness(1.06);
}
</style>
