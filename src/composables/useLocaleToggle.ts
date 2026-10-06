import { computed, ref, type Ref } from 'vue'
import { getLocale, setLocale, type LocaleKey } from '../i18n'

/**
 * 语言切换（2026-10-04 从 App.vue 抽出）。
 *
 * ## 为什么抽出来
 *
 * App.vue 当时 **1499/1500 行**（`check-structure` 硬上限），只剩 1 行余量，
 * 任何新增接入点都会破线。这块逻辑自洽（含一个**易漏的副作用**：切换前必须
 * 捕获滚动位置），却散在 App.vue 里 —— 正符合行数告警说的「又有该抽的块了」。
 *
 * ## 关键副作用：先存滚动位置再切
 *
 * 语言切换会 `langVer++` 让 Vue **销毁旧 MilkdownEditor、挂载新实例**。
 * 若不先 `captureScroll()`，用户正看到文档中段时切个语言，
 * 新实例挂载后会回到文档开头 —— 内容没丢，但阅读位置丢了，
 * 对长文档是明显的体验断裂。
 */
export function useLocaleToggle(host: {
  value: { captureScroll?: () => void } | null
}) {
  /** 语言版本号：自增即触发编辑器重挂（让构造期固化的标签按新语言生成） */
  const langVer: Ref<number> = ref(0)

  const localeLabel = computed(() => (getLocale() === 'zh-CN' ? '中' : 'EN'))

  function toggleLocale(): void {
    const next: LocaleKey = getLocale() === 'zh-CN' ? 'en-US' : 'zh-CN'
    // ⚠️ 必须先存滚动位置：下面 setLocale 会导致编辑器实例重挂，位置随之丢失
    host.value?.captureScroll?.()
    setLocale(next)
    langVer.value++
  }

  return { langVer, localeLabel, toggleLocale }
}
