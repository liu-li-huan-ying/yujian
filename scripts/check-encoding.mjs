#!/usr/bin/env node
/**
 * 文本编码体检 —— 拦截「静默的字符损坏」。
 *
 * 【为什么需要它】
 * 这类损坏最阴险的地方是**完全无声**：文件仍是「合法 UTF-8」，typecheck / lint /
 * 测试 / 构建统统通过，只是注释或字符串里的中文被替换成了 U+FFFD。
 * 等有人真的去读那段文字时，原文已经找不回来了。
 * 本项目就踩过一次：一次文本编辑往返把 80 个字符写成了 U+FFFD。
 *
 * 【判据】
 * 合法的 UTF-8 解码**永远不会**产出 U+FFFD；一旦出现，必然是原始字节非法或
 * 上游做过有损转换。因此 U+FFFD 是「已损坏」的高置信信号。
 *
 * 【为何输出刻意全 ASCII】
 * 本仓库路径与内容含中文，而终端/日志管道可能对 CJK 做二次编码；若体检报告本身
 * 被显示管道改写，就会出现「看着像乱码、其实是好的」的误判。故只打印码点计数与
 * 行号，不打印可疑原文。
 *
 * 用法：npm run check:encoding
 * 退出码：0 = 干净；1 = 存在损坏（打印 文件 + 行号 + 计数）
 */
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|jsx|vue|json|jsonc|md|markdown|css|scss|less|html|htm|yml|yaml|txt|sh)$/i
const MAX_BYTES = 4 * 1024 * 1024 // 超过 4MB 的文本文件跳过（避免体检本身变慢）
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'release', '.vite', 'coverage'])

/** 优先用 git 索引（只体检真正纳入版本管理的文件）；不可用时退化为遍历 */
function listFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\0').filter(Boolean)
  } catch {
    const acc = []
    walk('.', acc)
    return acc
  }
}

function walk(dir, acc) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(join(dir, e.name), acc)
    } else {
      acc.push(relative('.', join(dir, e.name)).split(sep).join('/'))
    }
  }
}

const findings = []
let scanned = 0

for (const file of listFiles()) {
  if (!TEXT_EXT.test(file)) continue
  let buf
  try {
    if (statSync(file).size > MAX_BYTES) continue
    buf = readFileSync(file)
  } catch {
    continue // 已被删除 / 无权限（如 git 索引里的悬空项），跳过
  }
  scanned++

  const text = buf.toString('utf8')
  let count = 0
  const lines = []
  text.split('\n').forEach((line, i) => {
    const hits = (line.match(/\uFFFD/g) || []).length
    if (hits > 0) {
      count += hits
      if (lines.length < 20) lines.push(i + 1)
    }
  })
  if (count > 0) findings.push({ file, count, lines })
}

if (findings.length === 0) {
  console.log(`encoding check: OK (${scanned} text files scanned, 0 corrupted chars)`)
  process.exit(0)
}

let total = 0
for (const f of findings) total += f.count
console.error(`encoding check: FAILED — ${total} corrupted char(s) in ${findings.length} file(s)\n`)
console.error('U+FFFD means the original bytes were already lost. Restore from git or re-enter the text.\n')
for (const f of findings) {
  console.error(`  ${f.file}  x${f.count}  lines: ${f.lines.join(',')}`)
}
process.exit(1)
