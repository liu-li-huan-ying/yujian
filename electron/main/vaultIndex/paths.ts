/**
 * 文件判定（跳过规则 / 是否 Markdown）与「基名·相对路径 → 绝对路径」映射构建。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { basename, extname, relative } from 'node:path'
import type { PathMaps } from './types'
import { MD_EXT } from './types'

/** 不应进入笔记库树的目录：点开头（.git/.mdeditor/.vscode 等）、node_modules、同名 .assets */
export function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith('.assets')
}

/** 是否为笔记 Markdown 文件（点开头的文件一律不算） */
export function isMarkdown(name: string): boolean {
  if (name.startsWith('.')) return false
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot > 0 && MD_EXT.has(lower.slice(dot))
}

/* ── 元数据解析（不缓存正文） ── */

export function buildPathMaps(filePaths: string[], root: string): PathMaps {
  const byBase = new Map<string, string>()
  const byRel = new Map<string, string>()
  for (const full of filePaths) {
    const base = basename(full, extname(full)).toLowerCase()
    if (!byBase.has(base)) byBase.set(base, full)
    const rel = relative(root, full)
      .replace(/\.(md|markdown)$/i, '')
      .split(/[\\/]/)
      .join('/')
      .toLowerCase()
    if (!byRel.has(rel)) byRel.set(rel, full)
  }
  return { byBase, byRel }
}

/* ── 索引构建 / 增量 / 持久化 ── */
