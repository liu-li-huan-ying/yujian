import { spawn } from 'node:child_process'
import { ensureMirrorEnv } from './mirror-env.mjs'

/**
 * 在注入镜像环境变量后，执行传入的命令（供 dist / release 等需要下载 electron-builder
 * 二进制的 npm script 使用），从而无需把这些镜像写进 .npmrc 而触发 npm 警告。
 *
 * 用法：node scripts/with-mirror.mjs <command> [args...]
 */
ensureMirrorEnv()

const [, , ...args] = process.argv
if (args.length === 0) {
  console.error('[with-mirror] 未提供要执行的命令')
  process.exit(1)
}

const isWin = process.platform === 'win32'
const [bin, ...rest] = args

// 用 cmd /c 直接执行 .cmd，避免 shell:true + args 触发的 DEP0190 弃用警告。
const child = isWin
  ? spawn('cmd', ['/c', bin, ...rest], { stdio: 'inherit', env: process.env })
  : spawn(bin, rest, { stdio: 'inherit', env: process.env })

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[with-mirror] 执行失败：', err.message)
  process.exit(1)
})
