/**
 * 双链解析与反链上下文（消费索引已派生的 backLinks，不重扫全库）。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { BacklinkItem } from '../../shared/ipc-channels'
import { wikiLinkRegex } from '../../shared/wikilink-syntax'
import { reportSoftError } from '../softError'
import { targetKey } from './metadata'
import { buildPathMaps } from './paths'
import { ensureIndex } from './store'
import type { VaultIndex, PathMaps } from './types'

/**
 * 用现成映射解析 wikilink 目标为 vault 内绝对路径；找不到返回 null。
 * 与 `resolveTarget` 同语义，但**不重建映射**——供批量解析的热路径复用（避免每次 O(n) 重建）。
 */
export function resolveTargetWithMaps(maps: PathMaps, target: string): string | null {
  const key = targetKey(target)
  if (!key) return null
  if (key.includes('/')) return maps.byRel.get(key.toLowerCase()) ?? null
  return maps.byBase.get(basename(key).toLowerCase()) ?? null
}

/** 把 wikilink 原始目标解析为 vault 内绝对路径；找不到返回 null */
export function resolveTarget(index: VaultIndex, root: string, target: string): string | null {
  // 复用 buildPathMaps（与 parseFile / checkLinks 同源），不再自建一份映射
  return resolveTargetWithMaps(buildPathMaps(Object.keys(index.files), root), target)
}

/** 解析 wikilink 目标为绝对路径（供编辑器点击跳转 / 一键创建目标笔记） */
export async function resolveWikiTarget(root: string, target: string): Promise<string | null> {
  const index = await ensureIndex(root)
  return resolveTarget(index, root, target)
}

/**
 * 反链面板数据：哪些笔记链接到 `absPath`，并附引用所在行的上下文片段。
 * 直接消费索引已派生的 `backLinks`（目标已是绝对路径），再回读来源文件抽取引用行。
 */
export async function getBacklinksWithContext(
  root: string,
  absPath: string
): Promise<BacklinkItem[]> {
  const index = await ensureIndex(root)
  const sources = index.backLinks[absPath] ?? []
  const out: BacklinkItem[] = []
  const re = wikiLinkRegex()
  for (const src of sources) {
    let content: string
    try {
      content = await readFile(src, 'utf-8')
    } catch (e) {
      reportSoftError('index.backlinkContext', e, 'debug')
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      let hit = false
      while ((m = re.exec(line)) !== null) {
        const t = m[1].trim().split('|')[0].split('#')[0].trim()
        if (resolveTarget(index, root, t) === absPath) {
          hit = true
          break
        }
      }
      if (hit) {
        out.push({ path: src, line: i + 1, snippet: line.trim().slice(0, 200) })
        break
      }
    }
  }
  return out
}
