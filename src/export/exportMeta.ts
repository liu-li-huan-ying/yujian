import { parseFrontmatter } from '../markdown/frontmatter'

/** 导出元信息（与 `buildExport.ExportMeta` 结构一致，此处独立声明以免测试时拉进整条导出管线） */
export interface PickedExportMeta {
  title?: string
  author?: string
  date?: string
}

/**
 * 取导出元信息：优先用属性面板写入的 frontmatter，回退到文档名。
 *
 * 单独成文件（而非塞在 `useExport` 里）是为了**可测**：本模块只依赖 `frontmatter`，
 * 而 `useExport` 会牵出整条导出管线（docTemplate / mermaid / latex / serialize），
 * 那些在 Node 测试环境下既重又带浏览器依赖。纯逻辑放纯模块，测试才能只打包它。
 *
 * - 键按优先级依次尝试（`title`；`author`/`authors`；`date`/`updated`/`created`）；
 * - YAML 解析出的 `Date` 统一取年月日，与字符串形态对齐；
 * - 标题缺失时回退 `base`（调用方通常传文档基名），作者 / 日期缺失则留空。
 */
export function pickExportMeta(md: string, base: string): PickedExportMeta {
  const { data } = parseFrontmatter(md)
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = data[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (v instanceof Date) return v.toISOString().slice(0, 10)
    }
    return undefined
  }
  return {
    title: pick('title') ?? base,
    author: pick('author', 'authors'),
    date: pick('date', 'updated', 'created'),
  }
}
