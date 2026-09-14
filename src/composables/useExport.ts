import { ref } from 'vue'
import { i18n } from '../i18n'
import { inlineImages } from '../export/imageInline'
import { pickExportMeta } from '../export/exportMeta'
import type { ExportKind } from '../export/types'
import {
  buildExportContent,
  kindLabel,
  bytesToBase64,
  type BuiltExport,
  type ExportContext,
  type ExportHostApi,
  type ExportPrefs,
} from '../export/buildExport'
import type { ExportPayload, ExportResult } from '../../electron/shared/ipc-channels'
import { errMsg } from '../../electron/shared/error'

/** composer 需要的编辑器能力：除构建期读取正文外，合订导出还要 `markdownToHtml` */
export interface ExportHostLike extends ExportHostApi {
  markdownToHtml: (md: string) => string
}

export interface ExportHooks {
  /** 当前文档绝对路径（getter，保持响应式） */
  filePath: () => string | null
  /** 当前笔记库根（多文件合订用，getter） */
  vaultPath: () => string | null
  /** 编辑器宿主实例；null 表示编辑器尚未就绪 */
  host: () => ExportHostLike | null
  /** 轻量提示 */
  showToast: (msg: string, type?: 'ok' | 'err' | 'info', duration?: number) => void
  /** 清掉当前 toast（预览浮层已接管界面时，避免「导出中」提示悬在浮层之后） */
  clearToast: () => void
}

/**
 * 导出能力（单文档导出 + 多文件合订 + 导出前预览 + 写盘 / 打印）。
 *
 * 从 `App.vue` 抽出的动因有两个：
 * 1. **瘦身**：这块连同合订共约 220 行协调逻辑，此前全堆在 1797 行的 `App.vue` 里；
 * 2. **可测**：`readExportMeta` 里「frontmatter 取值 + 回退」是纯逻辑，抽到
 *    `export/exportMeta.ts` 后即可纳入 `test-core`（此前作为组件内部函数无法断言）。
 *
 * 依赖一律经 `hooks` 以 **getter** 注入（而非直接读组件 ref），保持与
 * `usePkmPanels` 一致的风格，也让本 composable 不反向依赖 `App.vue`。
 */
export function useExport(hooks: ExportHooks) {
  const U = i18n.ui

  /**
   * 导出选项（导出菜单里逐项切换）：
   * - toc 自动目录（PDF 恒为是——纸质阅读需要导航）
   * - cover 封面页（标题 / 作者 / 日期，取自 frontmatter）
   * - inline 图片与图表内联为 data URL（自包含、离线可读；PDF 恒为内联，代价是体积变大）
   * - selection 仅导出选中内容（无选区时回退整篇）
   * - preview 导出前先预览，确认后再落盘
   */
  const exportPrefs = ref<ExportPrefs>({
    toc: false,
    cover: false,
    inline: true,
    selection: false,
    preview: false,
  })

  /** 导出菜单切换一个选项（整体替换而非就地改，保证 ref 的响应式触发） */
  function toggleExportPref(key: keyof ExportPrefs): void {
    exportPrefs.value = { ...exportPrefs.value, [key]: !exportPrefs.value[key] }
  }

  /** 取导出元信息：走 `exportMeta` 的纯函数，日期与作者键的回退规则集中在那里 */
  function readExportMeta(base: string) {
    return pickExportMeta(hooks.host()?.getMarkdown?.() ?? '', base)
  }

  /** 读取绝对路径图片为 data URL（导出内联用）；失败返回 null，保留原 src 不破坏文档 */
  async function readAsDataUrl(absPath: string): Promise<string | null> {
    const res = await window.api.readFileBase64(absPath)
    return res.ok && res.dataUrl ? res.dataUrl : null
  }

  /** 导出前预览状态 */
  const showPreview = ref(false)
  const previewState = ref<BuiltExport | null>(null)

  /** 写盘 / 打印：与构建分离，预览确认后直接复用已构建的内容 */
  async function writeExport(built: BuiltExport): Promise<void> {
    const payload: ExportPayload = {
      content: built.content,
      defaultName: built.defaultName,
      filters: built.filters,
      binaryBase64: built.binary ? bytesToBase64(built.binary) : undefined,
      mime: built.mime,
    }
    let res: ExportResult
    try {
      res =
        built.kind === 'pdf'
          ? await window.api.exportPdf(payload)
          : await window.api.exportFile(payload)
    } catch (e) {
      console.error('[export] 写盘 IPC 失败：', e)
      hooks.showToast(`${U.toastExportErr}${errMsg(e)}`, 'err', 5000)
      return
    }
    if (res.ok && res.path) {
      // 成功：保留路径较长时间，让用户明确看到「导出到了哪里」
      hooks.showToast(`${U.toastExportHtmlOk}${res.path}`, 'ok', 4500)
    } else if (res.canceled) {
      hooks.showToast(U.toastExportCanceled, 'info')
    } else {
      hooks.showToast(`${U.toastExportErr}${res.error ?? ''}`, 'err', 5000)
    }
  }

  /** 把导出环境打包成 ExportContext，注入给纯构建逻辑 */
  function exportContext(): ExportContext {
    return {
      filePath: hooks.filePath(),
      exportPrefs: exportPrefs.value,
      host: hooks.host(),
      readExportMeta,
      readAsDataUrl,
      showToast: hooks.showToast,
      U,
    }
  }

  /**
   * 导出当前文档。三种产物共用一条管道：取正文 → 变换 → 预览（可选）→ 通用写盘 / 打印。
   * @param kind  html 网页 / pdf 文档 / latex 源文件
   * @param scope all 整篇 / selection 当前选中（无选区时回退整篇）
   */
  async function doExport(kind: ExportKind, scope: 'all' | 'selection' = 'all'): Promise<void> {
    if (!hooks.filePath()) {
      hooks.showToast(U.toastNoDoc, 'err')
      return
    }
    const label = kindLabel(kind, U)
    hooks.showToast(`${U.toastExporting}${label}…`, 'info')

    try {
      const built = await buildExportContent(kind, scope, undefined, exportContext())
      if (!built) return // buildExportContent 内部已给出原因提示（无内容 / 无选区等）

      // 开启「导出前预览」：先呈现产物，用户确认后再落盘（落盘时会弹出系统保存对话框）
      if (exportPrefs.value.preview) {
        previewState.value = built
        showPreview.value = true
        hooks.clearToast() // 预览界面已接管，清掉「导出中」提示
        return
      }
      await writeExport(built)
    } catch (e) {
      // 任何一步（取正文 / 内联图片 / 渲染图表 / 序列化）抛错都不该静默——明确告诉用户
      console.error('[export] 生成导出内容失败：', e)
      hooks.showToast(`${U.toastExportErr}${errMsg(e)}`, 'err', 5000)
    }
  }

  /** 预览面板确认：把已构建的内容落盘 / 打印 */
  async function confirmExport(): Promise<void> {
    const built = previewState.value
    showPreview.value = false
    previewState.value = null
    if (!built) return
    try {
      await writeExport(built)
    } catch (e) {
      console.error('[export] 写盘失败：', e)
      hooks.showToast(`${U.toastExportErr}${errMsg(e)}`, 'err', 5000)
    }
  }

  /** 预览面板取消：丢弃已构建内容 */
  function cancelExport(): void {
    showPreview.value = false
    previewState.value = null
  }

  /* ── 多文件合订（CompilePanel → 共用 buildExportContent override）── */

  const showCompile = ref(false)

  /**
   * 多文件合订：逐文件读取 → markdownToHtml 渲染 → 按各自文档目录内联图片 → 拼接，
   * 再交给与单文档完全相同的导出管道（含预览 / 写盘 / 自包含内联）。
   * 图片必须在拼接前按文档所在目录分别内联，合订后无法再用单一基准路径解析。
   */
  async function onCompile(payload: {
    files: string[]
    title: string
    newPagePerDoc: boolean
    kind: ExportKind
    preview: boolean
  }): Promise<void> {
    if (!hooks.vaultPath()) {
      hooks.showToast(U.toastNoDoc, 'err')
      return
    }
    if (!payload.files.length) {
      hooks.showToast(U.compileNoSelection, 'info')
      return
    }
    showCompile.value = false
    const label = kindLabel(payload.kind, U)
    hooks.showToast(`${U.toastExporting}${label}…`, 'info')

    try {
      let combinedHtml = ''
      let combinedMd = ''
      for (const file of payload.files) {
        const md = await window.api.readFile(file)
        if (!md.trim()) continue
        const html = hooks.host()?.markdownToHtml(md) ?? ''
        // 按该文档所在目录把相对图片内联为 data URL（合订后无法用单一基准）
        const inlined = await inlineImages(html, file, readAsDataUrl)
        combinedHtml += payload.newPagePerDoc
          ? `<section class="yj-compile-page">${inlined}</section>`
          : inlined
        combinedMd += `\n\n${md}\n`
      }
      if (!combinedHtml && !combinedMd.trim()) {
        hooks.showToast(U.toastNoContent, 'err')
        return
      }

      const built = await buildExportContent(
        payload.kind,
        'all',
        {
          title: payload.title,
          bodyHtml: combinedHtml,
          markdown: combinedMd,
          forceInline: true,
        },
        exportContext(),
      )
      if (!built) return

      if (payload.preview) {
        previewState.value = built
        showPreview.value = true
        hooks.clearToast()
        return
      }
      await writeExport(built)
    } catch (e) {
      console.error('[export] 合订导出失败：', e)
      hooks.showToast(`${U.toastExportErr}${errMsg(e)}`, 'err', 5000)
    }
  }

  return {
    exportPrefs,
    toggleExportPref,
    readExportMeta,
    readAsDataUrl,
    showPreview,
    previewState,
    doExport,
    confirmExport,
    cancelExport,
    showCompile,
    onCompile,
  }
}
