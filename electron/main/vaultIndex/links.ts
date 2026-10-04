/**
 * 双链解析与反链上下文（消费索引已派生的 backLinks，不重扫全库）。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { BacklinkItem } from '../../shared/ipc-channels'
import { wikiLinkRegex } from '../../shared/wikilink-syntax'
import { reportSoftError } from '../softError'
import { targetKey } from './metadata'
import { buildPathMaps } from './paths'
import { ensureIndex, indexFile } from './store'
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
export async function resolveWikiTarget(
  root: string,
  target: string,
  liveIndex?: VaultIndex,
): Promise<string | null> {
  const index = liveIndex ?? (await ensureIndex(root))
  return resolveTarget(index, root, target)
}

/**
 * 反链面板数据：哪些笔记链接到 `absPath`，并附引用所在行的上下文片段。
 * 直接消费索引已派生的 `backLinks`（目标已是绝对路径），再回读来源文件抽取引用行。
 *
 * @param liveIndex 由调用方注入 watcher 维护的内存索引（见 ipc/pkm.ts）。
 *   **不注入会读到 800ms 滞后的磁盘快照** —— 表现为「刚改完双链、反链面板仍显示
 *   没有笔记链接到这里」，且 `?? []` 会把「索引里还没这条」静默显示成「真的没有反链」。
 *   与 `pkm.listTags` 等同一签名模式，非新发明。
 */
export async function getBacklinksWithContext(
  root: string,
  absPath: string,
  liveIndex?: VaultIndex,
): Promise<BacklinkItem[]> {
  const index = liveIndex ?? (await ensureIndex(root))
  // ⚠️ 不在索引里的文档（刚新建 / 刚改名）不能直接当「无反链」：
  // 那会让新文档的反链面板永远空白。先确认它是否真的不在库里，
  // 在库但未索引（映射过期）则补一次解析，再返回真实结果。
  if (!(absPath in index.files)) {
    // 文档确实在库内但索引未收录（刚新建 / 刚改名，映射未刷新）→ 补一次解析。
    // 读不到（已被删除）则保持原样，此时返回空数组是正确的。
    try {
      const content = await readFile(absPath, 'utf-8')
      const mtime = (await stat(absPath)).mtimeMs
      indexFile(index, root, absPath, content, mtime, buildPathMaps(Object.keys(index.files), root))
    } catch (e) {
      reportSoftError('index.backlinkEnsure', e, 'debug')
    }
  }
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
