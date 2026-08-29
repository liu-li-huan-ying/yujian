import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import type { FileNode, SearchFileResult, SearchLineHit, VaultChange, VaultChangeKind, ReplaceResult } from '../shared/ipc-channels'

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

/** 新建文件夹（目录）。同名自动追加序号，绝不覆盖已有目录 */
export async function createFolder(parentDir: string, baseName = '未命名文件夹'): Promise<string> {
  await mkdir(parentDir, { recursive: true })

  let candidate = join(parentDir, baseName)
  let n = 1
  while (await exists(candidate)) {
    candidate = join(parentDir, `${baseName} ${n}`)
    n += 1
  }

  await mkdir(candidate)
  return candidate
}

/** 重命名文件或文件夹。会顺带搬运同名的 `.assets` 资源目录（文档图片存储约定） */
export async function renameItem(oldPath: string, newName: string): Promise<string> {
  const name = (newName ?? '').trim()
  if (!name) throw new Error('名称不能为空')
  // 不允许用路径分隔符伪造多级目录
  if (/[\\/]/.test(name)) throw new Error('名称不能包含路径分隔符')
  if (name === '.' || name === '..') throw new Error('名称无效')

  const parent = dirname(oldPath)
  const newPath = join(parent, name)
  if (newPath === oldPath) return oldPath
  if (await exists(newPath)) throw new Error(`已存在同名项目：${name}`)

  await rename(oldPath, newPath)

  // 尽力同步同名 .assets（仅文档文件、且文件名确实变了时才搬）
  try {
    const oldBase = basename(oldPath)
    const newBase = basename(newPath)
    if (isMarkdown(oldBase)) {
      const oldNoExt = oldBase.slice(0, oldBase.toLowerCase().lastIndexOf('.'))
      const newNoExt = newBase.slice(0, newBase.toLowerCase().lastIndexOf('.'))
      if (oldNoExt && newNoExt && oldNoExt !== newNoExt) {
        const oldAssets = join(parent, `${oldNoExt}.assets`)
        const newAssets = join(parent, `${newNoExt}.assets`)
        if ((await exists(oldAssets)) && !(await exists(newAssets))) {
          await rename(oldAssets, newAssets)
        }
      }
    }
  } catch {
    // .assets 同步失败不应让主流程报错
  }

  return newPath
}

/** 删除文件或文件夹（递归）。删除文档时一并清理同名的 `.assets` 资源目录 */
export async function deleteItem(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true })

  try {
    const base = basename(targetPath)
    if (isMarkdown(base)) {
      const noExt = base.slice(0, base.toLowerCase().lastIndexOf('.'))
      const assets = join(dirname(targetPath), `${noExt}.assets`)
      if (await exists(assets)) await rm(assets, { recursive: true, force: true })
    }
  } catch {
    // 资源目录清理失败不影响删除结果
  }
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

/* ── 全文搜索 ───────────────────────────────── */

const MAX_HITS_PER_FILE = 20
const MAX_RESULT_FILES = 80

/** 单文件内按行匹配（不区分大小写），返回命中行（已截断） */
async function searchInFile(file: string, query: string): Promise<SearchLineHit[]> {
  let content: string
  try {
    content = await readFile(file, 'utf-8')
  } catch {
    return []
  }
  const lower = query.toLowerCase()
  const hits: SearchLineHit[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lower)) {
      hits.push({ line: i + 1, text: lines[i].trim().slice(0, 240) })
      if (hits.length >= MAX_HITS_PER_FILE) break
    }
  }
  return hits
}

/**
 * 递归全文搜索。规则与 listTree 一致：跳过点目录、node_modules、同名 `.assets`，
 * 仅搜索 Markdown 文档。为控制开销，单文件最多 20 个命中、总共最多 80 个文件。
 */
export async function searchVault(root: string, query: string): Promise<SearchFileResult[]> {
  const q = query.trim()
  if (!q) return []

  const results: SearchFileResult[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        await walk(full)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        const hits = await searchInFile(full, q)
        if (hits.length) results.push({ path: full, name: entry.name, hits })
      }
      if (results.length >= MAX_RESULT_FILES) return
    }
  }

  await walk(root)
  return results
}

/**
 * 全局替换：在「当前搜索命中文件」范围内，把 query（字面量、不区分大小写，与 searchVault 一致）
 * 全部替换为 replacement，写回磁盘（仅内容真正变化时落盘）。返回替换总数与被修改文件数。
 * 范围限定为搜索命中的文件，避免误伤无关文档；绝不触碰图片/资源，只处理 Markdown 源文本。
 */
export async function replaceInVault(
  root: string,
  query: string,
  replacement: string,
  caseSensitive: boolean
): Promise<ReplaceResult> {
  const q = query.trim()
  if (!q) return { replaced: 0, files: 0, paths: [] }

  const results = await searchVault(root, q)
  const targets = results.map((r) => r.path)

  const flags = caseSensitive ? 'g' : 'gi'
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

  let replaced = 0
  let files = 0
  const paths: string[] = []
  for (const p of targets) {
    let content: string
    try {
      content = await readFile(p, 'utf-8')
    } catch {
      continue
    }
    const next = content.replace(re, replacement)
    if (next === content) continue
    try {
      await writeFile(p, next, 'utf-8')
      replaced += content.match(re)?.length ?? 0
      files++
      paths.push(p)
    } catch {
      // 单文件写失败不影响其余文件（如只读文件）
    }
  }
  return { replaced, files, paths }
}
