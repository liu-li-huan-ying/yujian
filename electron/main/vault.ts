import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import type { FileNode, VaultChange, VaultChangeKind } from '../shared/ipc-channels'

const MD_EXT = new Set(['.md', '.markdown'])

/**
 * 不该出现在笔记库树里的目录：
 * - 点开头的（.git / .mdeditor / .vscode / .obsidian 等）
 * - node_modules
 * - 与文档同名的 `xx.assets` 图片目录（那是资源，不是笔记）
 */
function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules' || name.endsWith('.assets')
}

function isMarkdown(name: string): boolean {
  // 点开头的一律不算笔记（编辑器配置、临时文件、.DS_Store 之类）。
  // 注意不能只靠 lastIndexOf('.') > 0 判断 —— 「.hidden.md」最后一个点在第 7 位，会被误收。
  if (name.startsWith('.')) return false

  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot > 0 && MD_EXT.has(lower.slice(dot))
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** 递归扫描，产出「目录在前、名称升序」的树；不含 md 的目录会被剪掉 */
async function scan(dir: string): Promise<FileNode[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // 权限不足、或目录已被外部删除 —— 静默跳过，不打断整棵树的构建
    return []
  }

  const out: FileNode[] = []

  for (const entry of entries) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue
      const children = await scan(full)
      if (children.length === 0) continue
      out.push({ name: entry.name, path: full, type: 'dir', children })
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      out.push({ name: entry.name, path: full, type: 'file' })
    }
  }

  return out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

export function listTree(root: string): Promise<FileNode[]> {
  return scan(root)
}

/** 新建文档。同名自动追加序号，绝不覆盖已有内容 */
export async function createDoc(dir: string, baseName = '未命名'): Promise<string> {
  await mkdir(dir, { recursive: true })

  let candidate = join(dir, `${baseName}.md`)
  let n = 1
  while (await exists(candidate)) {
    candidate = join(dir, `${baseName} ${n}.md`)
    n += 1
  }

  await writeFile(candidate, '', 'utf-8')
  return candidate
}

/* ── 目录监听 ───────────────────────────────── */

let watcher: FSWatcher | null = null

/**
 * 监听笔记库变化。外部改动（别的编辑器保存、Git 切分支、资源管理器里改名）
 * 都会推送给渲染层，让文件树始终与磁盘一致。
 */
export function watchVault(root: string, onChange: (change: VaultChange) => void): void {
  stopWatching()

  watcher = chokidarWatch(root, {
    // 根目录自身不能被自己的忽略规则排除掉
    ignored: (p: string) => p !== root && shouldSkipDir(basename(p)),
    ignoreInitial: true,
    // 保存是「写临时文件 + rename」，等落盘稳定再上报，避免读到半截内容
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
  })

  const emit =
    (kind: VaultChangeKind) =>
    (path: string): void =>
      onChange({ kind, path })

  watcher
    .on('add', emit('add'))
    .on('unlink', emit('unlink'))
    .on('addDir', emit('addDir'))
    .on('unlinkDir', emit('unlinkDir'))
    .on('change', emit('change'))
    .on('error', () => {
      // 监听失败（例如库所在磁盘被拔出）不该让应用崩掉
    })
}

export function stopWatching(): void {
  if (!watcher) return
  void watcher.close().catch(() => {})
  watcher = null
}
