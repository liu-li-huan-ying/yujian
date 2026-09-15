/**
 * 链接健康体检：扫描失效的 wikilink / Markdown 链接 / 图片链接，规则与文件树遍历一致。
 * 只读操作，不修改任何文件。
 */

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import type { BrokenLinkItem, BrokenLinkReport } from '../../shared/ipc-channels'
import { isMarkdown, shouldSkipDir } from '../vaultIndex'
import { reportSoftError } from '../softError'
import { exists } from './fsUtils'

/**
 * 链接健康检查（Phase 2 批次三 §3.7）。扫描 vault 内失效链接，规则与 listTree/searchVault 一致：
 * 跳过点目录、node_modules、同名 `.assets`，仅检查 Markdown 文档。
 *
 * 识别三类链接：
 *  - [[wikilink]]（支持 `[[X|别名]]`、`[[X#标题]]`）：按「基名（去扩展名）」或「相对库的去扩展名路径」解析；
 *  - Markdown 链接 `[text](target)`：相对当前文档目录解析后检查目标是否存在；
 *  - 图片 `![alt](target)`：同上，检查图片文件是否存在。
 * 外部链接（http(s)/mailto/tel/data/ftp、协议相对 //、www. 域名）与纯锚点（#标题）跳过，不计入断链。
 * 为控制开销，断链条目最多收集 2000 条即提前返回。
 */
export async function checkLinks(root: string): Promise<BrokenLinkReport> {
  const allMd: string[] = []
  // 第一遍：收集全部 Markdown 文档，建立「基名 / 相对路径」索引（小写、去扩展名）
  const byBase = new Map<string, string>()
  const byRel = new Map<string, string>()

  async function collect(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (e) {
      reportSoftError('vault.walk', e, 'debug')
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        await collect(full)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        allMd.push(full)
        const base = basename(full, extname(full)).toLowerCase()
        if (!byBase.has(base)) byBase.set(base, full)
        const rel = relative(root, full)
          .replace(/\.(md|markdown)$/i, '')
          .split(/[\\/]/)
          .join('/')
          .toLowerCase()
        if (!byRel.has(rel)) byRel.set(rel, full)
      }
    }
  }

  await collect(root)

  const items: BrokenLinkItem[] = []
  const MAX_ITEMS = 2000
  const wikiRe = /\[\[([^\]\n]+?)\]\]/g
  const mdRe = /!?\[[^\]\n]*\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g

  const isExternal = (t: string): boolean =>
    /^(https?:|mailto:|tel:|data:|ftp:)/i.test(t) || t.startsWith('//')

  for (const file of allMd) {
    let content: string
    try {
      content = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNo = i + 1

      // ── wikilinks ──
      wikiRe.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = wikiRe.exec(line)) !== null) {
        let target = m[1].trim().split('|')[0].split('#')[0].trim()
        if (!target) continue
        const key = target.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '')
        const match = key.includes('/')
          ? byRel.get(key.toLowerCase())
          : byBase.get(basename(key).toLowerCase())
        if (!match) {
          items.push({ file, line: lineNo, raw: m[0], target, kind: 'wikilink', context: line })
          if (items.length >= MAX_ITEMS)
            return { scanned: allMd.length, total: items.length, items }
        }
      }

      // ── md / image links ──
      mdRe.lastIndex = 0
      while ((m = mdRe.exec(line)) !== null) {
        let target = m[1].trim()
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim()
        target = target.split('#')[0].trim()
        if (!target) continue
        if (isExternal(target) || target.startsWith('#') || /^www\./i.test(target)) continue
        let decoded: string
        try {
          decoded = decodeURIComponent(target)
        } catch {
          decoded = target
        }
        const resolved = resolve(dirname(file), decoded)
        if (!(await exists(resolved))) {
          const isImage = m[0].startsWith('!')
          items.push({
            file,
            line: lineNo,
            raw: m[0],
            target,
            kind: isImage ? 'image' : 'mdlink',
            context: line,
          })
          if (items.length >= MAX_ITEMS)
            return { scanned: allMd.length, total: items.length, items }
        }
      }
    }
  }

  return { scanned: allMd.length, total: items.length, items }
}
