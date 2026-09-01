// 清理构建产生的临时 / 产物文件。
// - electron-vite 编译 TS 配置时会生成带时间戳的 electron.vite.config.*.mjs，
//   已被 .gitignore 覆盖（不污染 git），但会随每次构建在磁盘累积。
// - out / out2 为 electron-vite 构建产物；本项目 emptyOutDir:false，
//   二次构建前需先清空 stale out/ 以规避 EPERM（见 docs/ARCHITECTURE.md）。
import { rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function safeRemove(path) {
  try {
    rmSync(path, { recursive: true, force: true })
    console.log('removed', path)
  } catch (e) {
    console.warn('skip (cannot remove)', path, '-', e.message)
  }
}

// 1. 带时间戳的临时 vite 配置
for (const f of readdirSync(root)) {
  if (/^electron\.vite\.config\.\d+\.mjs$/.test(f)) safeRemove(join(root, f))
}

// 2. 构建产物
for (const dir of ['out', 'out2']) safeRemove(join(root, dir))

console.log('clean done')
