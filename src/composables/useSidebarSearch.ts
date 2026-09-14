/**
 * 侧栏「搜索 + 替换」能力（双范围：全库 / 当前文档共用一套）。
 *
 * 从 `Sidebar.vue` 抽出（该文件曾达 1611 行）。之所以值得抽，不只是为了行数：
 * 搜索是本项目**交互最密集**的链路之一（防抖、跨文件扁平化、循环导航、替换后
 * 行号重推导），埋在组件里既臃肿又无法断言。
 *
 * 两种范围共用同一个搜索框与「区分大小写 / 全词匹配 / 正则」选项，区别只在
 * `scopeFile()`：本文档范围把活动文档路径传给主进程（只搜该单文件、不递归），
 * 全库范围传 undefined（递归整个库）。结果统一渲染，点击跳转定位行。
 *
 * 依赖经 `hooks` 以 **getter** 注入（与 `usePkmPanels` / `useExport` 一致），
 * 本文件不反向 import 组件，也不持有文件树等无关状态。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { SearchFileResult, SearchResult } from '../../electron/shared/ipc-channels'
import { useI18n } from '../i18n'
import { nextIndex, pickCurrentLine, prevIndex, wrapIndex } from '../utils/searchNav'

export type FindHighlightPayload = {
  query: string
  opts: { caseSensitive: boolean; wholeWord: boolean; regex?: boolean }
  currentLine?: number
} | null

export interface SidebarSearchHooks {
  /** 当前打开的库路径（未开库为 null） */
  vaultPath: () => string | null
  /** 当前正在编辑的文档路径 */
  activePath: () => string | null
  /** 提示条（组件持有真实实现） */
  showToast: (msg: string) => void
  /**
   * 聚焦搜索框。刻意由组件注入而非本模块持有 DOM ref：输入框是模板里的实体，
   * 归属组件更自然，也让本模块保持与 DOM 无关（便于在 Node 下断言）。
   */
  focusInput: () => void
}

/** 对外抛出（替换成具名回调，避免本模块感知 Vue 的 emit 签名） */
export interface SidebarSearchEmit {
  findHighlight: (payload: FindHighlightPayload) => void
  openResult: (payload: { path: string; line: number }) => void
  replaced: (paths: string[]) => void
}

/** 输入防抖时长：连续输入不每次重扫整个库 */
const DEBOUNCE_MS = 300

export function useSidebarSearch(hooks: SidebarSearchHooks, emit: SidebarSearchEmit) {
  const L = useI18n().t.ui

  const searchScope = ref<'vault' | 'doc'>('vault')
  const searchQuery = ref('')
  const isSearching = ref(false)
  /** 搜索整体响应（命中列表 + 是否因过多被截断） */
  const searchResponse = ref<SearchResult>({ results: [], truncated: false })
  const searchResults = computed<SearchFileResult[]>(() => searchResponse.value.results)
  const searchTruncated = computed<boolean>(() => searchResponse.value.truncated)
  const caseSensitive = ref(false)
  const wholeWord = ref(false)
  const useRegex = ref(false)

  /** 当前结果高亮所在行（点结果时更新，用于源码模式强化当前命中）；undefined 表示无 */
  const currentFindLine = ref<number | undefined>(undefined)
  /** 当前选中的命中序号（-1 表示未选）；导航与「第 N / 共 M」计数据此推进 */
  const currentIndex = ref(-1)

  /** 跨文件扁平化全部命中，供计数与循环导航 */
  const flatHits = computed<{ path: string; line: number }[]>(() =>
    searchResults.value.flatMap((f) => f.hits.map((h) => ({ path: f.path, line: h.line }))),
  )

  const showReplace = ref(false)
  const replaceQuery = ref('')
  const confirming = ref<number | null>(null)
  const replacing = ref(false)
  const totalHits = computed(() => searchResults.value.reduce((n, f) => n + f.hits.length, 0))

  let searchTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 驱动两端命中高亮：只要有查询且已打开文档，就把 query/选项/当前行抛给编辑器
   * （EditorHost 同时转发给源码模式 CodeMirror 装饰 + 所见即所得 ProseMirror 装饰）。
   * 其余情况抛 null 清空高亮。本地计算无需等 IPC 结果，即时生效。
   */
  function syncFindHighlight(): void {
    if (searchQuery.value.trim() && hooks.activePath()) {
      emit.findHighlight({
        query: searchQuery.value.trim(),
        opts: {
          caseSensitive: caseSensitive.value,
          wholeWord: wholeWord.value,
          regex: useRegex.value,
        },
        currentLine: currentFindLine.value,
      })
    } else {
      emit.findHighlight(null)
    }
  }

  /** 当前范围对应的检索文件：本文档范围传 activePath，全库范围不传（递归全库） */
  function scopeFile(): string | undefined {
    return searchScope.value === 'doc' ? (hooks.activePath() ?? undefined) : undefined
  }

  /** 执行真正的 IPC 搜索（无防抖，供输入防抖与替换后即时刷新复用） */
  async function executeSearch(): Promise<void> {
    const query = searchQuery.value.trim()
    if (!query || (searchScope.value === 'doc' && !hooks.activePath()) || !hooks.vaultPath()) {
      searchResponse.value = { results: [], truncated: false }
      isSearching.value = false
      return
    }
    isSearching.value = true
    try {
      searchResponse.value = await window.api.searchVault(
        hooks.vaultPath() as string,
        query,
        { caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, regex: useRegex.value },
        scopeFile(),
      )
    } catch (e) {
      hooks.showToast(e instanceof Error ? e.message : String(e))
      searchResponse.value = { results: [], truncated: false }
    } finally {
      isSearching.value = false
    }
  }

  function runSearch(): void {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void executeSearch(), DEBOUNCE_MS)
  }

  /** 搜索输入 / 选项 / 范围 / 当前文档 任一变化 → 重跑搜索并同步源码高亮 */
  watch(
    [searchQuery, caseSensitive, wholeWord, useRegex, searchScope, hooks.activePath, hooks.vaultPath],
    () => {
      currentIndex.value = -1
      runSearch()
      syncFindHighlight()
    },
  )

  /** 跳到指定命中并定位（打开文档 + 滚动到行 + 高亮当前命中） */
  function gotoHit(i: number): void {
    const list = flatHits.value
    if (!list.length) return
    const idx = wrapIndex(i, list.length)
    currentIndex.value = idx
    const hit = list[idx]
    currentFindLine.value = hit.line
    syncFindHighlight()
    onOpenResult(hit.path, hit.line)
  }

  /** 下一处 / 上一处（循环） */
  function nextHit(): void {
    if (!flatHits.value.length) return
    gotoHit(nextIndex(currentIndex.value, flatHits.value.length))
  }
  function prevHit(): void {
    if (!flatHits.value.length) return
    gotoHit(prevIndex(currentIndex.value, flatHits.value.length))
  }

  function onOpenResult(path: string, line: number): void {
    // 双范围都记录当前结果行，供源码模式 + 所见即所得对称高亮强化该命中
    currentFindLine.value = line
    syncFindHighlight()
    emit.openResult({ path, line })
  }

  /** 点击「替换全部」：先确认（展示将影响的匹配数），避免误伤 */
  function askReplace(): void {
    if (!replaceQuery.value || replacing.value) return
    confirming.value = totalHits.value
  }

  /** 确认执行：在搜索命中文件范围内做替换，写回磁盘；范围随 `scopeFile()` 走 */
  async function doReplace(): Promise<void> {
    const n = confirming.value
    confirming.value = null
    if (n == null || !hooks.vaultPath() || !replaceQuery.value) return
    replacing.value = true
    try {
      const res = await window.api.replaceInVault(
        hooks.vaultPath() as string,
        searchQuery.value,
        replaceQuery.value,
        { caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, regex: useRegex.value },
        scopeFile(),
      )
      hooks.showToast(
        L.replaceDone.replace('{n}', String(res.replaced)).replace('{files}', String(res.files)),
      )
      emit.replaced(res.paths)
      // 立即刷新结果（不走输入防抖），反映替换后状态
      await executeSearch()
      // 替换可能引发行号偏移 → 重新推导仍有效的命中行，避免残留过期位置
      currentFindLine.value = pickCurrentLine(searchResults.value, hooks.activePath())
      syncFindHighlight()
      replaceQuery.value = ''
      showReplace.value = false
    } catch {
      hooks.showToast(L.replaceFail)
    } finally {
      replacing.value = false
    }
  }

  function clearSearch(): void {
    searchQuery.value = ''
    searchResponse.value = { results: [], truncated: false }
    isSearching.value = false
    showReplace.value = false
    replaceQuery.value = ''
    confirming.value = null
    currentIndex.value = -1
    currentFindLine.value = undefined
    syncFindHighlight()
  }

  /** 聚焦搜索框（Ctrl+F 等快捷键调用）：有打开的文档则默认切到「本文档」范围，
      契合 Ctrl+F = 在当前文档查找的通用语义；否则落到「全部」 */
  function focusSearch(): void {
    searchScope.value = hooks.activePath() ? 'doc' : 'vault'
    void nextTick(() => hooks.focusInput())
  }

  /** 本文件内回车：有结果则跳到首个命中行 */
  function onSearchEnter(): void {
    const first = searchResults.value[0]
    if (first?.hits.length) onOpenResult(first.path, first.hits[0].line)
  }

  return {
    searchScope,
    searchQuery,
    isSearching,
    searchResponse,
    searchResults,
    searchTruncated,
    caseSensitive,
    wholeWord,
    useRegex,
    currentIndex,
    showReplace,
    replaceQuery,
    confirming,
    replacing,
    totalHits,
    nextHit,
    prevHit,
    clearSearch,
    askReplace,
    doReplace,
    onOpenResult,
    focusSearch,
    onSearchEnter,
  }
}
