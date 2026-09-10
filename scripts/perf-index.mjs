#!/usr/bin/env node
/**
 * Index performance baseline.
 *
 * Why this exists: the project's hard constraint is "5000 notes, no perceptible
 * lag, index memory < 100MB, strictly incremental (no periodic full-vault
 * recompute)". That constraint is the most expensive thing to regress and the
 * easiest to break silently -- a refactor can turn an O(1) incremental update
 * into an O(n) rebuild and every functional test still passes.
 *
 * Design notes:
 *  - Thresholds are deliberately LOOSE (they catch catastrophic regressions,
 *    not 10% drift), because CI runners are shared and variable. The relative
 *    checks (incremental must be orders of magnitude cheaper than full build)
 *    are the ones with real teeth.
 *  - Output is ASCII-only on purpose: this project's CJK text gets re-encoded
 *    by some log pipelines, and a mangled report is worse than none.
 *  - Does NOT run as part of `npm test` (keeps the main gate fast and
 *    deterministic). Run it via `npm run perf:index`.
 *
 * Env:
 *  - YJ_PERF_FILES   note count (default 3000)
 *
 * Exit code: 0 = within budget, 1 = regression / budget exceeded.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleTs } from './lib/bundle.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const N = Number(process.env.YJ_PERF_FILES || 3000)

const BUDGET = {
  fullBuildMs: 30_000, // full walk + read + parse of N notes
  perFileIncrementalMs: 5, // single-note re-parse (local ~0.05ms -> 100x headroom)
  incrementalSpeedup: 20, // incremental must be >= 50x cheaper than full/N
  indexBytes: 15 * 1024 * 1024, // serialized index for N notes
  heapDeltaMb: 100 // hard constraint: index memory < 100MB
}

const results = []
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    results.push(`  PASS ${name}${detail ? ' -- ' + detail : ''}`)
  } else {
    failed++
    results.push(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`)
  }
}

function note(i) {
  const lines = [
    '---',
    `title: Note ${i}`,
    `tags: [topic${i % 20}, area${i % 7}]`,
    i % 50 === 0 ? 'moc: true' : '',
    '---',
    `# Note ${i}`,
    '',
    '## Section A',
    '',
    `See [[note-${(i + 1) % N}]] and [[note-${(i + 37) % N}]] for context.`,
    `Inline #tag${i % 40} plus #parent/child.`,
    '',
    '## Section B',
    '',
    'Some *emphasis*, `code`, and a [link](https://example.com).',
    '',
    '```js',
    'const x = 1 // #notatag',
    '```'
  ]
  return lines.filter((l) => l !== '').join('\n') + '\n'
}

console.log(`\n[index perf] files=${N} budget=${JSON.stringify(BUDGET)}\n`)

const Idx = await import((await bundleTs({ root, entry: 'electron/main/vaultIndex.ts', outName: 'vaultIndex.mjs' })).url)

/* Build a vault with N notes spread over nested folders (realistic walk cost). */
const vault = mkdtempSync(join(tmpdir(), 'yj-perf-'))
{
  const FOLDERS = 30
  for (let f = 0; f < FOLDERS; f++) mkdirSync(join(vault, `folder${f}`), { recursive: true })
  const t0 = Date.now()
  for (let i = 0; i < N; i++) {
    writeFileSync(join(vault, `folder${i % FOLDERS}`, `note-${i}.md`), note(i), 'utf-8')
  }
  const genMs = Date.now() - t0
  console.log(`  generated ${N} notes in ${genMs}ms\n`)
}

try {
  /* T1: full build */
  const heapBefore = process.memoryUsage().heapUsed
  const t1 = Date.now()
  const index = await Idx.buildIndex(vault)
  const fullMs = Date.now() - t1
  const heapAfter = process.memoryUsage().heapUsed
  const heapDeltaMb = (heapAfter - heapBefore) / 1024 / 1024

  const fileCount = Object.keys(index.files).length
  check('all notes indexed', fileCount === N, `${fileCount}/${N}`)
  check(`full build < ${BUDGET.fullBuildMs}ms`, fullMs < BUDGET.fullBuildMs, `${fullMs}ms`)
  check(
    `index heap delta < ${BUDGET.heapDeltaMb}MB`,
    heapDeltaMb < BUDGET.heapDeltaMb,
    `${heapDeltaMb.toFixed(1)}MB`
  )

  const bytes = JSON.stringify(index).length
  check(
    `serialized index < ${(BUDGET.indexBytes / 1024 / 1024).toFixed(0)}MB`,
    bytes < BUDGET.indexBytes,
    `${(bytes / 1024 / 1024).toFixed(2)}MB`
  )

  /* T2: single-file incremental re-parse (the hot path: watcher event -> reindex one note) */
  const sample = Object.keys(index.files).sort()
  const target = sample[Math.floor(sample.length / 2)]
  const maps = Idx.buildPathMaps(sample, vault)
  const ITER = 200
  const t2 = Date.now()
  for (let k = 0; k < ITER; k++) {
    Idx.indexFile(index, vault, target, note(k), Date.now(), maps)
  }
  const perFileMs = (Date.now() - t2) / ITER
  check(`per-file incremental < ${BUDGET.perFileIncrementalMs}ms`, perFileMs < BUDGET.perFileIncrementalMs, `${perFileMs.toFixed(3)}ms`)

  /* T3: strict incrementality -- incremental must be far cheaper than touching everything */
  const fullPerFileMs = fullMs / N
  const speedup = fullPerFileMs / Math.max(perFileMs, 0.0001)
  check(
    `incremental >= ${BUDGET.incrementalSpeedup}x cheaper than full/N (strictly incremental)`,
    speedup >= BUDGET.incrementalSpeedup,
    `${speedup.toFixed(0)}x (full/N=${fullPerFileMs.toFixed(3)}ms)`
  )

  /* T4: incremental must not perturb unrelated entries (no hidden full recompute) */
  {
    const other = sample.find((p) => p !== target)
    const before = JSON.stringify(index.files[other])
    Idx.indexFile(index, vault, target, note(999), Date.now(), maps)
    check('incremental leaves unrelated entries untouched', JSON.stringify(index.files[other]) === before)
  }

  /* T5: backlink resolution on the hot path must not rebuild the whole map each call */
  {
    check('resolveTargetWithMaps resolves a known target', Idx.resolveTargetWithMaps(maps, 'note-1') !== null)
    const ITER2 = 2000
    const t = Date.now()
    for (let k = 0; k < ITER2; k++) Idx.resolveTargetWithMaps(maps, `note-${k % N}`)
    const perCallMs = (Date.now() - t) / ITER2
    check('resolveTargetWithMaps < 0.2ms per call (no per-call O(n) map rebuild)', perCallMs < 0.2, `${perCallMs.toFixed(4)}ms`)
  }

  console.log(results.join('\n'))
  console.log(
    `\n  measured: fullBuild=${fullMs}ms  fullPerFile=${fullPerFileMs.toFixed(3)}ms  incremental=${perFileMs.toFixed(3)}ms  index=${(bytes / 1024 / 1024).toFixed(2)}MB  heap=${heapDeltaMb.toFixed(1)}MB\n`
  )
} finally {
  rmSync(vault, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`==== perf:index FAILED (${failed} check(s) out of budget) ====\n`)
  process.exit(1)
}
console.log('==== perf:index OK ====\n')
process.exit(0)
