/**
 * 全文搜索 / 全局替换：消费统一索引枚举文件（免递归扫描），逐文件正文匹配。
 * 正则构造收敛到渲染层单一来源 electron/shared/regex，避免库级搜索与编辑器内搜索行为分叉。
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  SearchFileResult,
  SearchLineHit,
  SearchOptions,
  SearchResult,
  ReplaceResult,
} from '../../shared/ipc-channels'
import { buildRegex } from '../../shared/regex'
import { reportSoftError } from '../softError'
import { backupBeforeBulkWrite } from '../autoBackup'
import { notifySafety } from '../safetyEvents'
import { planBulkReplace, safeWriteMany } from '../safeWrite'
import { mergeFailed, summarizeReplace } from '../safeWriteCore'
import { ensureIndex } from './indexStore'

/* ── 全文搜索（消费统一索引层，解除 80 文件硬上限） ──────────────── */

/** 单文件内命中行上限：防止单个超大文件（如字典）撑爆结果列表；达到即标记 truncated */
const PER_FILE_HIT_CAP = 500
/** 命中文件软上限：超过则截断并标记 truncated，提示用户收窄查询（取代原 80 文件硬上限） */
const SOFT_FILE_CAP = 1000

/** 单文件内按行匹配（默认不区分大小写；支持区分大小写 / 全词匹配），返回命中行（已截断至 PER_FILE_HIT_CAP） */
async function searchInFile(
  file: string,
  query: string,
  opts?: SearchOptions,
): Promise<SearchLineHit[]> {
  let content: string
  try {
    content = await readFile(file, 'utf-8')
  } catch (e) {
    reportSoftError('search.readFile', e, 'debug')
    return []
  }
  const hits: SearchLineHit[] = []
  const lines = content.split('\n')
  // buildRegex 始终返回带 'g' 的正则；用 String.search()（忽略 g 标志、每次从行首匹配）
  // 而非 re.test()，避免全局正则 lastIndex 在多行复用时残留导致漏匹配。
  const re = buildRegex(query, opts?.caseSensitive ?? false, opts?.wholeWord ?? false, opts?.regex ?? false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].search(re) !== -1) {
      hits.push({ line: i + 1, text: lines[i].trim().slice(0, 240) })
      if (hits.length >= PER_FILE_HIT_CAP) break
    }
  }
  return hits
}

/**
 * 递归全文搜索。规则与 listTree 一致：跳过点目录、node_modules、同名 `.assets`，
 * 仅搜索 Markdown 文档。为控制开销，单文件最多 20 个命中、总共最多 80 个文件。
 */
/**
 * 全文搜索。两种范围共用同一套逻辑，仅范围不同：
 * - 全库：递归 root 下全部 Markdown 文档（默认）；
 * - 单文档：传入 file 时只搜该文件（即左侧「本文档」范围），不递归。
 * 选项（区分大小写 / 全词匹配）与命中行结构两种范围完全一致。
 */
/**
 * 全文搜索。两种范围共用同一套逻辑，仅范围不同：
 * - 全库：经统一索引枚举全部 Markdown 文档（免递归扫描），逐文件做正文匹配；
 * - 单文档：传入 file 时只搜该文件（左侧「本文档」范围）。
 * 已解除原 80 文件 / 20 命中硬上限，改用 PER_FILE_HIT_CAP 与 SOFT_FILE_CAP 软上限，
 * 超过即截断并以 `truncated` 提示前端。
 */
export async function searchVault(
  root: string,
  query: string,
  opts?: SearchOptions,
  file?: string,
): Promise<SearchResult> {
  const q = query.trim()
  if (!q) return { results: [], truncated: false }

  // 单文档范围：只检索引导文件，避免无谓的整库递归
  if (file) {
    const hits = await searchInFile(file, q, opts)
    const truncated = hits.length >= PER_FILE_HIT_CAP
    return {
      results: hits.length ? [{ path: file, name: basename(file), hits }] : [],
      truncated,
    }
  }

  // 全库范围：经索引枚举文件（免递归扫描），逐文件做正文匹配
  const index = await ensureIndex(root)
  const results: SearchFileResult[] = []
  let truncated = false
  for (const path of Object.keys(index.files)) {
    const hits = await searchInFile(path, q, opts)
    if (hits.length) {
      results.push({ path, name: basename(path), hits })
      if (hits.length >= PER_FILE_HIT_CAP) truncated = true
    }
    if (results.length >= SOFT_FILE_CAP) {
      truncated = true
      break
    }
  }
  return { results, truncated }
}

/**
 * 全局替换：在「当前搜索命中文件」范围内，把 query（字面量，匹配规则与 searchVault 一致：
 * 支持区分大小写 / 全词匹配）全部替换为 replacement，写回磁盘（仅内容真正变化时落盘）。
 * 返回替换总数与被修改文件数。范围限定为搜索命中的文件，避免误伤无关文档；
 * 绝不触碰图片/资源，只处理 Markdown 源文本。
 */
export async function replaceInVault(
  root: string,
  query: string,
  replacement: string,
  opts?: SearchOptions,
  file?: string,
): Promise<ReplaceResult> {
  const q = query.trim()
  if (!q) return { replaced: 0, files: 0, paths: [] }

  // 决定替换范围：单文档只取该文件，全库取搜索命中的文件（两种范围复用同一套匹配规则）
  let targets: string[]
  if (file) {
    const hits = await searchInFile(file, q, opts)
    targets = hits.length ? [file] : []
  } else {
    const results = await searchVault(root, q, opts)
    targets = results.results.map((r) => r.path)
  }

  // 复用主搜索正则构造（含 regex 模式支持）；buildRegex 始终带 'g'，正好供整文替换
  const re = buildRegex(q, opts?.caseSensitive ?? false, opts?.wholeWord ?? false, opts?.regex ?? false)

  // ── 阶段 1 · 全量预检（不动任何文件）─────────────────────────────
  // 替换是本项目唯一「不可撤销 + 可批量改写全库」的操作，故必须先把
  // 「能不能改、哪些要改」算清楚再动手。否则中途才发现某些文件读不到时，
  // 用户已处在一个「一半改了、一半没改」的中间态且难以回退。
  const { plan, unreadable } = await planBulkReplace(targets, (content) => content.replace(re, replacement))

  if (plan.length === 0) {
    // 没有任何文件内容会变 → 不留档、不写盘；但读不到的文件仍要如实报告
    const failed = mergeFailed(unreadable, [])
    return {
      replaced: 0,
      files: 0,
      paths: [],
      failed: failed.length ? failed : undefined,
    }
  }

  // ── 阶段 2 · 批量留档（一次性，独立配额池，不触发 prune）──────────
  // 绝不逐文件调 backupBeforeSave：那会 3 读 2 写 × N、可能弹 N 次系统回收站，
  // 还会偷跑掉每个文档 50 份自动备份的份额。详见 autoBackup.backupBeforeBulkWrite 注释。
  const bulk = await backupBeforeBulkWrite(plan.map((p) => ({ path: p.path, content: p.before })))

  // ── 阶段 3 · 顺序写 + 精确回报（失败不中断）────────────────────────
  // 写必须走 atomicWrite 而非 writeFile：裸写崩溃会留下截断文件。
  // 不中断的目的是让用户拿到**完整**的失败清单，而不是"改到一半卡住、状态不明"。
  const res = await safeWriteMany(plan.map((p) => ({ path: p.path, content: p.after })))

  // 计数与路径**只统计成功写入的文件** —— 否则会出现「A 文件没改成，
  // 但提示说全库已替换 3 处」这种比静默更糟的假成功。逻辑在纯逻辑层，可直测。
  const stats = summarizeReplace(
    plan,
    res.failed.map((f) => f.path),
    (before) => before.match(re)?.length ?? 0,
  )
  const failed = mergeFailed(unreadable, res.failed)

  // 部分失败必须让用户知道：静默的部分替换是「用户以为全改完了」的最坏情形
  if (failed.length > 0) {
    notifySafety('replace-partial', failed.map((f) => f.path), `${failed.length} 个文件未替换成功`)
  }

  return {
    replaced: stats.replaced,
    files: stats.files,
    paths: stats.paths,
    failed: failed.length ? failed : undefined,
    degraded: bulk.degraded,
  }
}
