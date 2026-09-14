/**
 * 模块依赖图分析库 —— `analyze-structure.mjs`（诊断）与 `check-structure.mjs`（门禁）共用。
 *
 * 抽成共享库的理由：两处都需要「解析 import → 构图 → 找环 → 判越界」，
 * 若各写一份，规则一旦分叉就会出现「诊断说没问题、门禁说有问题」的荒谬局面。
 *
 * ⚠️ 关键实现细节：**提取 import 前必须先剥掉注释**。
 * 否则文档注释里出现的 `import type { X } from './y'`（用于解释某种错误做法）
 * 会被当成真实依赖，凭空造出依赖边甚至假循环——实测踩过。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(__dirname, '..', '..')

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'out',
  'release',
  'dist',
  'assets',
  'tmp',
  'tests',
])

/**
 * 剥掉代码注释，保留行号（注释内容替换为等长空白）。
 *
 * - 块注释 `/* … *\/` 整体置空（保留换行以维持行号）；
 * - 行注释 `// …` 仅在其前有空白时才算注释 —— 这样 `'jade-asset://…'`
 *   这类协议字符串不会被误切。
 */
export function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  s = s.replace(/(^|[^\S\n])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
  return s
}

/** 递归收集 `src/` + `electron/` 下的 ts / vue 文件（绝对路径） */
export function collectFiles(roots = ['src', 'electron']) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(ts|vue)$/.test(name)) out.push(p)
    }
  }
  for (const r of roots) {
    const abs = join(ROOT, r)
    try {
      if (statSync(abs).isDirectory()) walk(abs)
    } catch {
      /* 目录不存在则跳过 */
    }
  }
  return out
}

export const relOf = (p) => relative(ROOT, p).split(sep).join('/')

/** 抽取源码里的 import / export-from / import() / require 说明符（已剥注释） */
export function extractSpecs(src) {
  const clean = stripComments(src)
  const specs = new Set()
  const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(clean))) specs.add(m[1])
  return [...specs]
}

/** Tarjan 强连通分量（迭代版，避免深递归爆栈） */
export function stronglyConnected(graph) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const result = []
  let counter = 0

  for (const start of graph.keys()) {
    if (index.has(start)) continue
    const work = [[start, 0]]
    while (work.length) {
      const frame = work[work.length - 1]
      const [v, pi] = frame
      if (pi === 0) {
        index.set(v, counter)
        low.set(v, counter)
        counter++
        stack.push(v)
        onStack.add(v)
      }
      const succ = (graph.get(v) ?? []).filter((w) => graph.has(w))
      if (pi < succ.length) {
        frame[1]++
        const w = succ[pi]
        if (!index.has(w)) work.push([w, 0])
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
      } else {
        work.pop()
        if (work.length) {
          const parent = work[work.length - 1][0]
          low.set(parent, Math.min(low.get(parent), low.get(v)))
        }
        if (low.get(v) === index.get(v)) {
          const comp = []
          let w
          do {
            w = stack.pop()
            onStack.delete(w)
            comp.push(w)
          } while (w !== v)
          result.push(comp)
        }
      }
    }
  }
  return result
}

/**
 * 分层规则：`from → to` 形式的禁止边。
 * 每条规则都是一句可读的架构约束；违反即失败，不做例外。
 *
 * **唯一的豁免：`.d.ts` 声明文件**。它是纯类型声明、编译后不产生任何运行时代码，
 * 故其中的 `import('x').Foo` 属于**类型引用**而非依赖。项目里唯一受此影响的是
 * `src/env.d.ts`（`window.api: import('../electron/preload').ElectronAPI`）——
 * 渲染层需要一个 `window.api` 的类型形状，而该类型由 preload 从实现对象 `typeof api`
 * 直接推导出来，硬搬到 shared 反而会引入「接口与实现漂移」的新风险。
 * 运行时边一律不给豁免。
 */
export const LAYER_RULES = [
  {
    id: 'no-main-impl-in-renderer',
    name: '渲染层不得 import 主进程实现（只能通过 window.api 与 electron/shared 契约）',
    from: (r) => r.startsWith('src/'),
    to: (r) => r.startsWith('electron/main/') || r.startsWith('electron/preload/'),
  },
  {
    id: 'no-renderer-in-main',
    name: '主进程不得 import 渲染层（共享代码须落在 electron/shared/）',
    from: (r) => r.startsWith('electron/'),
    to: (r) => r.startsWith('src/'),
  },
  {
    id: 'no-editor-in-pure',
    name: '纯逻辑层（utils / export / markdown / render）不得 import 编辑器层或 Vue 组件',
    from: (r) => /^src\/(utils|export|markdown|render)\//.test(r),
    to: (r) =>
      r.startsWith('src/components/') ||
      r.startsWith('src/editor/') ||
      r.startsWith('src/composables/'),
  },
]

/** 声明文件：无运行时代码，其 import 全属类型引用 */
export const isDeclaration = (r) => /\.d\.ts$/.test(r)

/** 构建依赖图与指标 */
export function buildGraph() {
  const files = collectFiles()
  const byRel = new Map(files.map((f) => [relOf(f), f]))
  const srcOf = new Map()
  const deps = new Map()
  const rdeps = new Map()

  const resolveSpec = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null
    const base = resolve(dirname(fromFile), spec)
    for (const c of [
      base,
      `${base}.ts`,
      `${base}.vue`,
      join(base, 'index.ts'),
      join(base, 'index.vue'),
    ]) {
      const r = relOf(c)
      if (byRel.has(r)) return r
    }
    return null
  }

  for (const f of files) {
    const r = relOf(f)
    const src = readFileSync(f, 'utf-8')
    srcOf.set(r, src)
    const set = new Set()
    for (const spec of extractSpecs(src)) {
      const t = resolveSpec(f, spec)
      if (t && t !== r) set.add(t)
    }
    deps.set(r, [...set])
  }
  for (const [r, ds] of deps) {
    for (const d of ds) {
      if (!rdeps.has(d)) rdeps.set(d, [])
      rdeps.get(d).push(r)
    }
  }

  const metrics = [...byRel.keys()].map((r) => {
    const src = srcOf.get(r)
    return {
      file: r,
      lines: src.split('\n').length,
      expCount: (
        src.match(/^export\s+(?:async\s+)?(?:default\s+)?(?:const|let|function|class|type|interface|enum)\s/gm) ??
        []
      ).length,
      fanIn: (rdeps.get(r) ?? []).length,
      fanOut: (deps.get(r) ?? []).length,
    }
  })

  const scc = stronglyConnected(deps)
  const cycles = scc.filter((c) => c.length > 1)
  const selfLoops = [...deps].filter(([r, ds]) => ds.includes(r)).map(([r]) => r)

  const violations = []
  for (const [r, ds] of deps) {
    if (isDeclaration(r)) continue // .d.ts 无运行时代码，不参与运行时分层约束
    for (const d of ds) {
      for (const rule of LAYER_RULES) {
        if (rule.from(r) && rule.to(d)) violations.push({ ruleId: rule.id, rule: rule.name, from: r, to: d })
      }
    }
  }

  return { files, deps, rdeps, metrics, cycles, selfLoops, violations }
}
