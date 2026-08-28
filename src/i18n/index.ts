import { reactive, ref, computed } from 'vue'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'
import type { Locale } from './locales/zh-CN'

export type LocaleKey = 'zh-CN' | 'en-US'

const locales: Record<LocaleKey, Locale> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

/** 当前激活的语言 key（响应式，供 computed / 模板双向响应） */
const localeKey = ref<LocaleKey>('zh-CN')

/**
 * 响应式语言包：切换时所有引用自动更新。
 * 必须用深拷贝：否则 t 与 zhCN 共享嵌套对象引用，setLocale 的
 * Object.assign 会污染原始中文源对象，导致切回中文时读到的是已变英文的值。
 */
const t = reactive<Locale>(structuredClone(zhCN))

/**
 * 获取当前语言 key（读取响应式 ref，在 computed 内调用可建立依赖）
 */
function getLocale(): LocaleKey {
  return localeKey.value
}

/**
 * 切换语言。返回新的 locale 对象（与 `t` 同一引用）。
 * 切换后所有使用 `useI18n()` 的组件会自动响应；
 * 但 Crepe 在构造时固化的标签（BlockEdit/Placeholder/ImageBlock/CodeMirror）
 * 需要由调用方重建编辑器实例才会生效。
 */
function setLocale(key: LocaleKey): Locale {
  localeKey.value = key
  const next = locales[key]
  // 逐层覆盖，保持 reactive 引用不变
  Object.assign(t.blockEdit.textGroup, next.blockEdit.textGroup)
  Object.assign(t.blockEdit.listGroup, next.blockEdit.listGroup)
  Object.assign(t.blockEdit.advancedGroup, next.blockEdit.advancedGroup)
  Object.assign(t.placeholder, next.placeholder)
  Object.assign(t.imageBlock, next.imageBlock)
  Object.assign(t.codeMirror, next.codeMirror)
  Object.assign(t.ui, next.ui)
  return t
}

/**
 * i18n composable —— 在组件中调用获取当前语言包。
 *
 * ```ts
 * const { t, locale, setLocale } = useI18n()
 * console.log(t.ui.save) // "保存" | "Save"
 * ```
 */
export function useI18n() {
  return {
    /** 响应式语言包对象 */
    t,
    /** 当前语言 key（响应式 computed，模板/computed 中可直接用） */
    locale: computed(() => localeKey.value),
    /** 切换语言 */
    setLocale,
    /** 获取当前语言 key（非响应式，用于传给非 Vue 上下文） */
    getLocale
  }
}

/** 导出单例供非组件上下文直接读取（如 Crepe config 构建时） */
export { t as i18n, setLocale, getLocale, localeKey }
export type { Locale }
