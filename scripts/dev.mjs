import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 宿主 IDE（WorkBuddy、VS Code 等）本身是 Electron 应用，
 * 会向派生的 shell 注入 ELECTRON_RUN_AS_NODE=1。
 *
 * 该变量会让 electron.exe 退化成纯 Node 运行：
 *   - process.type 变成 undefined（而不是 'browser'）
 *   - require('electron') 返回二进制路径字符串，而不是 API 对象
 *   - 结果：应用不报错但永远不创建窗口
 *
 * 因此在启动 electron-vite 之前必须清除它。
 */
delete process.env.ELECTRON_RUN_AS_NODE

const here = dirname(fileURLToPath(import.meta.url))
const binDir = join(here, '..', 'node_modules', '.bin')
const isWin = process.platform === 'win32'
const bin = join(binDir, isWin ? 'electron-vite.cmd' : 'electron-vite')

const args = process.argv.slice(2)

const child = spawn(bin, args, {
  stdio: 'inherit',
  shell: isWin,
  env: process.env
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[dev] 启动失败：', err.message)
  process.exit(1)
})
