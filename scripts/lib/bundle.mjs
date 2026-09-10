/**
 * 把 TS/TSX 模块打成可在 Node 里直接 import 的 .mjs —— 测试脚本共用。
 *
 * 【为何不用子进程调 `node_modules/esbuild/bin/esbuild`】
 * 该路径不是可执行入口的稳定契约：它在 Windows 上是 JS 启动壳（须用 node 跑），
 * 在 Linux / macOS 上却是**原生二进制**（ELF / Mach-O，须直接 exec）。
 * 于是 `node <它>` 只在 Windows 能跑，CI（Linux）会直接炸：
 *   SyntaxError: Invalid or unexpected token
 *   ... 127 69 76 70   ← 即 \x7fELF
 * 走 esbuild 的官方 JS API 才真正跨平台，且不依赖 CLI 参数拼装。
 */
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

/**
 * 打包一个入口模块，返回可直接 `await import(url)` 的 file URL。
 *
 * @param {object} opts
 * @param {string} opts.root      项目根目录（绝对路径），同时作为 absWorkingDir
 * @param {string} opts.entry     相对 root 的入口文件，如 'electron/main/vaultIndex.ts'
 * @param {string} opts.outName   产物文件名，如 'vaultIndex.mjs'
 * @param {Record<string,string>} [opts.stubs] 包名 → 桩代码。用于把「不必在 Node 里真跑」的
 *                                依赖（Milkdown 的 $remark / $nodeSchema 等）换成最小替身，
 *                                从而对纯逻辑（remark 改写、toMarkdown 序列化）做断言。
 * @param {number} [opts.timeoutMs] 打包超时，默认 60s（防 esbuild 子进程卡死拖垮 CI）
 * @returns {Promise<{url: string, dir: string}>} url = 产物 file URL；dir = 临时目录（供清理）
 */
export async function bundleTs({ root, entry, outName, stubs = {}, timeoutMs = 60_000 }) {
  const tmp = mkdtempSync(join(tmpdir(), 'yj-bundle-'))
  const out = join(tmp, outName)

  /** @type {Record<string, string>} */
  const alias = {}
  for (const [pkg, code] of Object.entries(stubs)) {
    const stubPath = join(tmp, pkg.replace(/[^\w]/g, '_') + '.mjs')
    writeFileSync(stubPath, code, 'utf-8')
    alias[pkg] = stubPath
  }

  await withTimeout(
    esbuild.build({
      absWorkingDir: root,
      entryPoints: [join(root, entry)],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: out,
      logLevel: 'error',
      alias
    }),
    timeoutMs,
    `esbuild 打包 ${entry} 超时（${timeoutMs}ms）`
  )

  return { url: pathToFileURL(out).href, dir: tmp }
}

/** 给一个 Promise 加超时，避免任何一步静默挂死（CI 上会一直等到 job 超时） */
function withTimeout(promise, ms, message) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
      // 不阻止进程退出
      if (typeof timer.unref === 'function') timer.unref()
    })
  ])
}
