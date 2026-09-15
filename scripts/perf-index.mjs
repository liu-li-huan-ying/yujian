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
 *  - Absolute thresholds are deliberately LOOSE (they catch catastrophic
 *    regressions, not 10% drift), because CI runners are shared and variable.
 *  - "Strictly incremental" is asserted as SIZE-INDEPENDENCE, not as a timing
 *    ratio against the full build. Comparing the incremental cost against
 *    fullBuild/N is ill-posed: fullBuild is I/O-bound (N file reads) while the
 *    incremental path is pure CPU with a fixed floor, so on a fast-disk runner
 *    fullBuild/N shrinks and the ratio collapses even though nothing regressed
 *    (observed 48x locally vs 15x on CI -- a flaky gate). Instead we run the SAME
 *    operation against a small vault and a large one in the same process: O(1)
 *    keeps the ratio near 1, an accidental full recompute scales it roughly with N.
 *  - Micro-benchmarks use performance.now(): Date.now() has 1ms granularity,
 *    which is far too coarse for a ~0.01ms operation. Note texts are built
 *    OUTSIDE the timed loop so the measurement is index work, not string building.
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
import { performance } from 'node:perf_hooks'
import { bundleTs } from './lib/bundle.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const N = Number(process.env.YJ_PERF_FILES || 3000)
/** Smaller vault used to prove the incremental path does not scale with size. */
const N_SMALL = Math.max(50, Math.round(N / 10))

const BUDGET = {
  fullBuildMs: 30_000, // full walk + read + parse of N notes
  perFileIncrementalMs: 5, // single-note re-parse (local ~0.01ms -> 500x headroom)
  incrementalSizeRatio: 4, // per-update cost at N vs N/10; O(1) ~1x, O(n) ~10x
  indexBytes: 15 * 1024 * 1024, // serialized index for N notes
  heapDeltaMb: 100 // hard constraint: index memory < 100MB
}

const results = []
let failed = 0

function check(name, ok, detail = '') {
  if (ok) results.push(`  PASS ${name}${detail ? ' -- ' + detail : ''}`)
  else {
    failed++
    results.push(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`)
  }
}

/** Link targets stay inside [0, total) so they always resolve. */
function note(i, total) {
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
    `See [[note-${(i + 1) % total}]] and [[note-${(i + 37) % total}]] for context.`,
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

/** Build a vault of `count` notes spread over nested folders (realistic walk cost). */
function makeVault(count) {
  const dir = mkdtempSync(join(tmpdir(), 'yj-perf-'))
  const FOLDERS = 30
  for (let f = 0; f < FOLDERS; f++) mkdirSync(join(dir, `folder${f}`), { recursive: true })
  const t0 = Date.now()
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `folder${i % FOLDERS}`, `note-${i}.md`), note(i, count), 'utf-8')
  }
  console.log(`  generated ${count} notes in ${Date.now() - t0}ms`)
  return dir
}

console.log(`\n[index perf] files=${N} budget=${JSON.stringify(BUDGET)}\n`)

const Idx = await import(
  (await bundleTs({ root, entry: 'electron/main/vaultIndex/index.ts', outName: 'vaultIndex.mjs' })).url
)

const vault = makeVault(N)
const smallVault = makeVault(N_SMALL)
console.log('')

/** Pre-built note texts (built outside the timed loop) for both vault sizes. */
const TEXTS = Array.from({ length: 2000 }, (_, k) => note(k, N))
const SMALL_TEXTS = Array.from({ length: 2000 }, (_, k) => note(k, N_SMALL))

/** Mean ms per single-file update (the watcher hot path: reindex exactly one note). */
function benchIncremental(index, v, target, texts, maps) {
  const t = performance.now()
  for (const text of texts) Idx.indexFile(index, v, target, text, Date.now(), maps)
  return (performance.now() - t) / texts.length
}

try {
  /* T1: full build */
  const heapBefore = process.memoryUsage().heapUsed
  const t1 = performance.now()
  const index = await Idx.buildIndex(vault)
  const fullMs = performance.now() - t1
  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024

  const fileCount = Object.keys(index.files).length
  check('all notes indexed', fileCount === N, `${fileCount}/${N}`)
  check(`full build < ${BUDGET.fullBuildMs}ms`, fullMs < BUDGET.fullBuildMs, `${fullMs.toFixed(0)}ms`)
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

  /* T2: single-file incremental re-parse (absolute cost ceiling) */
  const sample = Object.keys(index.files).sort()
  const target = sample[Math.floor(sample.length / 2)]
  const maps = Idx.buildPathMaps(sample, vault)
  const perFileMs = benchIncremental(index, vault, target, TEXTS, maps)
  check(
    `per-file incremental < ${BUDGET.perFileIncrementalMs}ms`,
    perFileMs < BUDGET.perFileIncrementalMs,
    `${perFileMs.toFixed(4)}ms`
  )

  /* T3: strict incrementality == per-update cost does NOT scale with vault size.
     Same operation, same process, only the index size differs: O(1) keeps the
     ratio near 1; an accidental O(n) rebuild (e.g. dropping the precomputed
     `maps` argument so indexFile rebuilds path maps internally) scales it ~N/10. */
  const smallIndex = await Idx.buildIndex(smallVault)
  const smallSample = Object.keys(smallIndex.files).sort()
  const smallTarget = smallSample[Math.floor(smallSample.length / 2)]
  const smallMaps = Idx.buildPathMaps(smallSample, smallVault)
  const smallPerFileMs = benchIncremental(smallIndex, smallVault, smallTarget, SMALL_TEXTS, smallMaps)
  const sizeRatio = perFileMs / Math.max(smallPerFileMs, 0.0001)
  check(
    `incremental cost does not scale with vault size (${N_SMALL} vs ${N})`,
    sizeRatio < BUDGET.incrementalSizeRatio,
    `${sizeRatio.toFixed(2)}x (small=${smallPerFileMs.toFixed(4)}ms, large=${perFileMs.toFixed(4)}ms)`
  )

  /* T4: incremental must not perturb unrelated entries (no hidden full recompute) */
  {
    const other = sample.find((p) => p !== target)
    const before = JSON.stringify(index.files[other])
    Idx.indexFile(index, vault, target, note(999, N), Date.now(), maps)
    check('incremental leaves unrelated entries untouched', JSON.stringify(index.files[other]) === before)
  }

  /* T5: backlink resolution on the hot path must not rebuild the whole map each call */
  {
    check('resolveTargetWithMaps resolves a known target', Idx.resolveTargetWithMaps(maps, 'note-1') !== null)
    const ITER2 = 5000
    const t = performance.now()
    for (let k = 0; k < ITER2; k++) Idx.resolveTargetWithMaps(maps, `note-${k % N}`)
    const perCallMs = (performance.now() - t) / ITER2
    check(
      'resolveTargetWithMaps < 0.2ms per call (no per-call O(n) map rebuild)',
      perCallMs < 0.2,
      `${perCallMs.toFixed(4)}ms`
    )
  }

  console.log(results.join('\n'))
  console.log(
    `\n  measured: fullBuild=${fullMs.toFixed(0)}ms  incremental=${perFileMs.toFixed(4)}ms  sizeRatio=${sizeRatio.toFixed(2)}x  index=${(bytes / 1024 / 1024).toFixed(2)}MB  heap=${heapDeltaMb.toFixed(1)}MB\n`
  )
} finally {
  rmSync(vault, { recursive: true, force: true })
  rmSync(smallVault, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`==== perf:index FAILED (${failed} check(s) out of budget) ====\n`)
  process.exit(1)
}
console.log('==== perf:index OK ====\n')
process.exit(0)
