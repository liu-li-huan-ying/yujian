/**
 * 关系图谱纯函数（节点 = 文件，边 = 已解析出链）。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
import { basename, extname } from 'node:path'
import type { GraphNode, GraphEdge, GraphData, GraphRequest } from '../../shared/ipc-channels'
import type { VaultIndex } from './types'

/** 全局视图默认节点上限（超出按度降序截断；见 UI-DESIGN §4.3 性能护栏） */
export const GRAPH_MAX_NODES = 300

/**
 * 由索引派生态图谱（纯函数）。
 *
 *  - **边** = 索引里已解析为绝对路径的出链；只有两端都在展示集合内才保留。
 *    由于两端都在集合内，反链方向（w→u）会在处理 w 时被自然补上，无需额外并集。
 *  - **本地子图**：以 center 为根，沿「出链 ∪ 反链」的**无向邻接**做 BFS，取 maxHops 跳内全部节点，
 *    `depth` 记录跳数（0=中心）。center 不在库内时退化为全局图。
 *  - **全局视图**：节点数超过 maxNodes 时，按节点**度**（邻接数）降序取前 maxNodes —— 保留「最连通」
 *    的核心子图，是最具信息量的**确定性**采样（不依赖随机，可复现、可单测）。
 */
export function buildGraph(index: VaultIndex, req: GraphRequest = {}): GraphData {
  const { center, maxHops = 2, maxNodes = GRAPH_MAX_NODES } = req
  const files = index.files
  const total = Object.keys(files).length
  if (total === 0) return { total: 0, shown: 0, truncated: false, nodes: [], edges: [] }

  // 无向邻接表：两端都在库内才纳入，避免指向已删文件的悬空边污染图谱
  const adj = new Map<string, Set<string>>()
  for (const p of Object.keys(files)) adj.set(p, new Set())
  for (const [from, entry] of Object.entries(files)) {
    for (const to of entry.outLinks) {
      if (adj.has(to)) {
        adj.get(from)!.add(to)
        adj.get(to)!.add(from)
      }
    }
  }

  let chosen: Set<string>
  let depthOf: Map<string, number> | null = null

  if (center && adj.has(center)) {
    // 本地子图：以 center 为根的 BFS（无向邻接，故出链与反链一并纳入邻居）
    chosen = new Set<string>([center])
    depthOf = new Map<string, number>([[center, 0]])
    const queue: string[] = [center]
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head]
      const d = depthOf.get(node)!
      if (d >= maxHops) continue
      for (const nb of adj.get(node)!) {
        if (chosen.has(nb)) continue
        chosen.add(nb)
        depthOf.set(nb, d + 1)
        queue.push(nb)
      }
    }
  } else {
    // 全局视图：全量；超出上限时按度降序截断（确定性采样）
    chosen = new Set(Object.keys(files))
    if (chosen.size > maxNodes) {
      const ranked = [...chosen].sort((a, b) => adj.get(b)!.size - adj.get(a)!.size)
      chosen = new Set(ranked.slice(0, maxNodes))
    }
  }

  const nodes: GraphNode[] = []
  for (const p of chosen) {
    const entry = files[p]
    nodes.push({
      path: p,
      title: entry.title || basename(p, extname(p)),
      depth: depthOf ? (depthOf.get(p) ?? 0) : 0,
      center: p === center,
      tags: entry.tags,
      moc: entry.moc
    })
  }

  // 边：仅两端都在展示集合内的出链；按「无向对」去重（双向同一条线只画一次）
  const edgeKeys = new Set<string>()
  const edges: GraphEdge[] = []
  for (const from of chosen) {
    for (const to of files[from].outLinks) {
      if (!chosen.has(to)) continue
      const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({ source: from, target: to })
    }
  }

  return { total, shown: nodes.length, truncated: nodes.length < total, nodes, edges }
}
