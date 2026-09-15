import matter from 'gray-matter'
import { parseFrontmatter as sharedParse, type ParsedFrontmatter } from '@shared/frontmatter'

/**
 * 文档属性（frontmatter）解析与回写。
 *
 * **解析已统一到 `electron/shared/frontmatter`（gray-matter）**：索引层
 * （vaultIndex/metadata.ts）与渲染层共用同一套解析，彻底消除「双解析器分歧」——
 * 此前索引层用手写正则、渲染层用 gray-matter，对带 BOM 或复杂 YAML 的文件会各读各的，
 * 表现为「属性面板说 moc:true，MOC 面板却说不是内容地图」。现在两层解析必然一致。
 *
 * 红線：Markdown 往返保真 —— 本模块严禁改动正文。
 * - 解析：shared 模块用 gray-matter 把 YAML 元数据与正文分离，正文 `content` 一字不改返回。
 * - 回写（`serializeFrontmatter`，本文件保留，渲染层专用）：只对顶部 `---` 块做增删改，
 *   正文原样接回；未知字段（用户手写的其他 key）经 `data` 透传、由 gray-matter 原样保留。
 * - 若全部已知字段清空且无未知字段 → 直接去掉 frontmatter 块，返回纯正文。
 *
 * **为什么在 `src/markdown/` 而不在 `src/editor/`**：它处理的是 Markdown 语法本身
 * （顶部 `---` 块），与 ProseMirror / Milkdown 无关。使用方跨越三层——
 * 应用壳（`App.vue` 属性面板）、组件（`WritingAidsPanel.vue`）、导出管线
 * （`export/exportMeta.ts`）。若留在 `editor/` 下，导出层就会反向 import 编辑器层，
 * 把自己的 Node 可测性一起赔进去。
 */

/** 渲染层使用的类型别名（与 shared 的 ParsedFrontmatter 完全一致） */
export type FrontmatterParsed = ParsedFrontmatter

/** 解析 Markdown 文档为「属性 + 正文」（统一走 shared，见其注释） */
export const parseFrontmatter = sharedParse

/** 去掉「空值」字段：空字符串、空数组、null/undefined 一律剔除 */
function stripEmpty(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

/**
 * 把（可能修改后的）数据写回文档。
 * @param data 最终要写入的字段集合（已含未知字段透传）
 * @param content 正文（须为 parseFrontmatter 返回的 content，保证不被改写）
 * @returns 完整文档文本；若 data 为空则返回去除了 frontmatter 的纯正文
 */
export function serializeFrontmatter(
  data: Record<string, unknown>,
  content: string
): string {
  const clean = stripEmpty(data)
  if (Object.keys(clean).length === 0) {
    // 去掉 frontmatter 后，正文顶部可能残留一个多余的换行，归一化掉
    return content.replace(/^\r?\n/, '')
  }
  return matter.stringify(content, clean)
}
