/**
 * 重命名 / 移动时自动改写全库 [[wikilink]]。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname, relative } from 'node:path'
import { wikiLinkRegex, parseWikiLink, buildWikiLink } from '../../shared/wikilink-syntax'
import { atomicWrite } from '../atomicWrite'
import { reportSoftError } from '../softError'
import { resolveTargetWithMaps } from './links'
import { buildPathMaps } from './paths'
import type { VaultIndex, MovePair, LinkRewriteSummary } from './types'

/**
 * 纯函数：把正文里所有「解析结果属于被移动集合」的 `[[wikilink]]` 目标改写为新写法。
 *
 * 设计要点：
 *  - 逐链接拆分 `target` / `#锚点` / `|别名`，**只替换 target 片段**，锚点与别名原样保留；
 *  - 新写法沿用原链接「形态」：原目标含 `/` 视为路径式 → 用新相对路径；否则用新基名；
 *  - 保留原目标的 `./` 前缀与 `.md` / `.markdown` 扩展名写法，尊重用户书写习惯；
 *  - 新写法与旧写法相同时不计入 changed、也不改动（避免无谓写盘与 Git 全量 diff）；
 *  - 断链（resolve 返回 null）一律不动——改名不该把断掉的链接「猜」到别处；
 *  - 非链接文本逐字节保留（含 CRLF），改写后除目标片段外原文不变。
 *
 * @param content 正文
 * @param resolve 目标 → 绝对路径（**必须用重命名前的映射**，否则解析不到旧目标）
 * @param newTargetOf (解析出的旧绝对路径, 原目标写法) → 新目标写法；返回 null 表示不属于本次移动
 */
export function rewriteWikiLinksInText(
  content: string,
  resolve: (target: string) => string | null,
  newTargetOf: (resolvedAbs: string, originalTarget: string) => string | null
): { text: string; changed: number } {
  let changed = 0
  const text = content.replace(wikiLinkRegex(), (full: string, inner: string) => {
    const parts = parseWikiLink(inner)
    if (!parts.target) return full
    const resolved = resolve(parts.target)
    if (!resolved) return full
    const next = newTargetOf(resolved, parts.target)
    if (!next || next === parts.target) return full
    changed++
    // 只换 target 段；锚点与别名的原始拼写逐字节沿用（buildWikiLink 内部处理）
    return buildWikiLink(parts, next)
  })
  return { text, changed }
}

/** 依据移动清单生成「新目标写法」推导器：沿用原链接形态，保留 `./` 前缀与扩展名写法 */
function makeNewTargetOf(
  root: string,
  toNew: Map<string, string>
): (resolvedAbs: string, originalTarget: string) => string | null {
  return (resolvedAbs, originalTarget) => {
    const to = toNew.get(resolvedAbs.toLowerCase())
    if (!to) return null
    const raw = originalTarget.trim()
    const extMatch = /\.(md|markdown)$/i.exec(raw)
    const ext = extMatch ? raw.slice(-extMatch[0].length) : ''
    const body = raw.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '')
    const next = body.includes('/')
      ? relative(root, to)
          .replace(/\.(md|markdown)$/i, '')
          .split(/[\\/]/)
          .join('/')
      : basename(to, extname(to))
    return (raw.startsWith('./') ? './' : '') + next + ext
  }
}

/**
 * 重命名 / 移动后，改写全库指向旧路径的 `[[wikilink]]`（fs 层编排）。
 *
 * ⚠️ 调用时机不可换：必须在「文件系统已迁移完成、但 `index` 仍是旧路径」的窗口内调用。
 * 此时索引里还留着旧条目，才能把 `[[旧基名]]` 解析回旧绝对路径；一旦索引同步过，
 * 旧条目消失，解析就无从下手。本函数**不修改索引**，索引刷新由调用方接着做。
 *
 * 受影响来源直接取索引已派生的 `backLinks`（零额外全库扫描，只读命中文件）；
 * 只改写「能解析到被移动文档」的链接，断链不动。单文件写失败不影响其余（与 replaceInVault 同款容错）。
 */
export async function rewriteLinksForMoves(
  root: string,
  index: VaultIndex,
  moves: MovePair[]
): Promise<LinkRewriteSummary> {
  const summary: LinkRewriteSummary = { sources: [], files: 0, links: 0 }
  if (moves.length === 0) return summary

  const toNew = new Map<string, string>()
  for (const m of moves) toNew.set(m.from.toLowerCase(), m.to)
  /** 来源文件自身可能也在移动之列（目录移动）→ 落到新位置；否则原地不动 */
  const newPathOf = (p: string): string => toNew.get(p.toLowerCase()) ?? p

  // 反链键大小写可能与路径不一致（Windows 大小写不敏感文件系统的常见坑），统一小写建表再查
  const backLower = new Map<string, string[]>()
  for (const [k, v] of Object.entries(index.backLinks)) backLower.set(k.toLowerCase(), v)
  const sources = new Set<string>()
  for (const m of moves) {
    for (const src of backLower.get(m.from.toLowerCase()) ?? []) sources.add(src)
  }
  if (sources.size === 0) return summary

  // 用「重命名前」的映射解析，才能把链接目标指回旧绝对路径
  const maps = buildPathMaps(Object.keys(index.files), root)
  const resolve = (t: string): string | null => resolveTargetWithMaps(maps, t)
  const newTargetOf = makeNewTargetOf(root, toNew)

  for (const src of sources) {
    const target = newPathOf(src)
    let raw: string
    try {
      raw = await readFile(target, 'utf-8')
    } catch {
      continue
    }
    const { text, changed } = rewriteWikiLinksInText(raw, resolve, newTargetOf)
    if (changed === 0) continue
    try {
      await atomicWrite(target, text)
      summary.files++
      summary.links += changed
      summary.sources.push(target)
    } catch (e) {
      reportSoftError('linkRewrite.write', e)
      // 单文件写失败不影响其余文件（如只读文件）
    }
  }
  return summary
}

/* ── 持久化（原子写，沿用项目 temp+rename 优势，避免多文件非原子写） ── */
