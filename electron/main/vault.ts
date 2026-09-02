import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { shell } from 'electron'
import type {
  FileNode,
  SearchFileResult,
  SearchLineHit,
  VaultChange,
  VaultChangeKind,
  ReplaceResult,
  BrokenLinkItem,
  BrokenLinkReport,
  SearchOptions,
  SearchResult,
} from '../shared/ipc-channels'
import * as Idx from './vaultIndex'
import * as Snap from './snapshots'

// 与 vault 索引层收拢同源判定（避免重复实现）
const shouldSkipDir = Idx.shouldSkipDir
const isMarkdown = Idx.isMarkdown

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 当前笔记库根（由 watchVault 写入）。移动 / 删除文档时需要它来定位
 * `<root>/.yujian-history/<sha1(文档绝对路径)>` 历史目录，使历史随文档一起迁移 / 清理。
 */
let vaultRoot: string | null = null

/**
 * 程序化改动抑制窗：主进程自己执行 create / rename / move / delete 时置位，
 * 让 watchVault 的 addDir/unlinkDir 不再触发昂贵的全量 reconcileIndex（每文件 add/unlink
 * 事件已增量维护索引，全量 reconcile 纯属冗余且在大库上很重）。仅抑制「程序化」改动，
 * 外部改动（资源管理器里建/删）仍会照常 reconcile，不丢索引一致性。
 */
let progSuppressUntil = 0
function markProgrammaticChange(windowMs = 1500): void {
  progSuppressUntil = Date.now() + windowMs
}

/** 递归收集目录树下全部 Markdown 文档绝对路径（与 listTree 同跳过规则，跳过 .yujian-history 等） */
async function collectMarkdownPaths(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        await walk(full)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(dir)
  return out
}

/** 递归清除目标树内所有只读属性（Windows 上目录/文件只读会让 rm/scandir 抛 EPERM，外部盘/云同步常见） */
async function clearReadOnlyRecursive(p: string): Promise<void> {
  let st
  try {
    st = await stat(p)
  } catch {
    return
  }
  try {
    await chmod(p, 0o777)
  } catch {
    // 单条失败忽略，继续处理其他条目
  }
  if (!st.isDirectory()) return
  let entries
  try {
    entries = await readdir(p, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    await clearReadOnlyRecursive(join(p, e.name))
  }
}

/** 删除：优先进系统回收站（可恢复、且能规避多数 Windows 只读/外部盘 EPERM），失败回退 rm（清只读后） */
async function trashOrRemove(targetPath: string): Promise<void> {
  try {
    await shell.trashItem(targetPath)
    return
  } catch {
    // 回收站不可用（网络盘 / U 盘 / 沙箱）→ 回退 rm
  }
  if (process.platform === 'win32') {
    await clearReadOnlyRecursive(targetPath).catch(() => {})
  }
  await rm(targetPath, { recursive: true, force: true })
}

/** 是否为权限类错误（Windows 上建目录/删目录常被只读属性或云盘驱动以 EPERM/EACCES 形式拦截） */
function isPermError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EACCES'
}

/** 递归扫描，产出「目录在前、名称升序」的树；空目录也会保留（否则新建文件夹后侧栏看不到） */
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
      // 保留空目录：新建文件夹后侧栏需立即可见，且空目录在 PKM 场景下是常态
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
  markProgrammaticChange()
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
  markProgrammaticChange()
  await mkdir(parentDir, { recursive: true })

  let candidate = join(parentDir, baseName)
  let n = 1
  while (await exists(candidate)) {
    candidate = join(parentDir, `${baseName} ${n}`)
    n += 1
  }

  await mkdirRobust(candidate, parentDir)
  return candidate
}

/**
 * 建目录并兼容 Windows 特有的「父目录只读属性」拦截：
 * 某些 Git / 云盘 / 从光盘复制来的文件夹会被打上只读 DOS 属性，导致 Node 的
 * fs.mkdir 建子目录时抛 EPERM（但建文件正常）。先清除父目录只读属性再重试一次。
 * 若仍失败，抛出清晰可执行的报错，而非把底层 EPERM 直接甩给用户。
 */
async function mkdirRobust(target: string, parent: string): Promise<void> {
  try {
    await mkdir(target)
  } catch (e) {
    if (isPermError(e) && process.platform === 'win32') {
      try {
        await chmod(parent, 0o777)
        await mkdir(target)
        return
      } catch {
        // 落到下方清晰报错
      }
    }
    if (isPermError(e)) {
      throw new Error(
        `无法创建文件夹（权限不足或被云同步 / 杀软拦截）：${target}。` +
          `请确认该位置非只读，或暂时退出 OneDrive / 坚果云等同步、以管理员身份运行后重试。`,
      )
    }
    throw e
  }
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

  markProgrammaticChange()

  // 移动前先记录「是否为目录 / 目录内各 md 的相对路径」，以便把历史一并迁移
  let oldIsDir = false
  let oldMdRels: string[] = []
  try {
    const st = await stat(oldPath)
    oldIsDir = st.isDirectory()
    if (oldIsDir) {
      oldMdRels = (await collectMarkdownPaths(oldPath)).map((p) => relative(oldPath, p))
    }
  } catch {
    // 取不到则跳过历史迁移
  }

  await rename(oldPath, newPath)

  // 把历史目录一并迁移到新绝对路径（内容不含绝对路径，整目录搬走即可）
  if (vaultRoot) {
    try {
      if (oldIsDir) {
        for (const rel of oldMdRels) {
          await Snap.moveHistory(vaultRoot, join(oldPath, rel), join(newPath, rel))
        }
      } else {
        await Snap.moveHistory(vaultRoot, oldPath, newPath)
      }
    } catch {
      // 历史迁移失败不阻断主流程
    }
  }

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
  markProgrammaticChange()

  // 删除前先记录是否为目录 / 目录内各 md 路径，便于随后清理其历史
  let deletingDir = false
  let mdPaths: string[] = []
  try {
    const st = await stat(targetPath)
    deletingDir = st.isDirectory()
    if (deletingDir) mdPaths = await collectMarkdownPaths(targetPath)
  } catch {
    // 取不到则跳过历史清理
  }

  // Windows 上目标或父目录的只读属性会让 rm 失败；先尽力清除只读属性再删
  if (process.platform === 'win32') {
    try {
      await chmod(targetPath, 0o777)
    } catch {
      // 目标可能已不存在或权限极高，rm 的 force 会兜底
    }
    try {
      await chmod(dirname(targetPath), 0o777)
    } catch {
      // 忽略
    }
  }

  // 优先进系统回收站（可恢复、且能规避多数 Windows 只读/外部盘 EPERM），失败回退 rm（清只读后）
  await trashOrRemove(targetPath)

  try {
    const base = basename(targetPath)
    if (isMarkdown(base)) {
      const noExt = base.slice(0, base.toLowerCase().lastIndexOf('.'))
      const assets = join(dirname(targetPath), `${noExt}.assets`)
      if (await exists(assets)) await trashOrRemove(assets)
    }
  } catch {
    // 资源目录清理失败不影响删除结果
  }

  // 清理对应的版本历史（走回收站）；文件夹则清理其中每篇文档的历史
  if (vaultRoot) {
    try {
      if (deletingDir) {
        for (const p of mdPaths) await Snap.deleteHistory(vaultRoot, p)
      } else {
        await Snap.deleteHistory(vaultRoot, targetPath)
      }
    } catch {
      // 历史清理失败不影响删除结果
    }
  }
}

/**
 * 递归复制（跨卷移动回退用：同卷 rename 偶发 EXDEV 时，先复制整棵子树再删源）。
 * 既处理文件也处理目录；失败向上抛，由调用方决定是否拆掉半成品。
 */
async function copyRecursive(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true })
}

/**
 * 移动文件或文件夹到目标目录。
 * - 校验：目标必须存在且为目录；不能移动到自身或其子孙目录；
 * - 同名冲突自动追加序号（绝不覆盖已有内容）；
 * - 同目录移动降级为重命名（复用 renameItem，含同名 `.assets` 同步）；
 * - 跨卷（EXDEV）回退为「复制 + 删源」，对文件夹同样适用；
 * - Windows 只读属性 / 云盘拦截：先清除目标父目录只读属性再试；
 * - 即时维护统一索引层：文件精确「移除旧 + 登记新」，目录触发防抖 reconcile，
 *   避免依赖 watcher 的 1s 延迟窗口造成搜索 / 双链读到陈旧路径。
 */
export async function moveItem(
  oldPath: string,
  destDir: string,
  newName?: string,
): Promise<string> {
  const name = (newName ?? '').trim() || basename(oldPath)
  if (/[\\/]/.test(name)) throw new Error('名称不能包含路径分隔符')
  if (name === '.' || name === '..') throw new Error('名称无效')

  markProgrammaticChange()

  // 目标必须是已存在的目录
  let destStat
  try {
    destStat = await stat(destDir)
  } catch {
    throw new Error(`目标文件夹不存在：${destDir}`)
  }
  if (!destStat.isDirectory()) throw new Error(`目标不是文件夹：${destDir}`)

  const normOld = oldPath.replace(/[\\/]$/, '')
  const normDest = destDir.replace(/[\\/]$/, '')
  if (normOld === normDest) throw new Error('不能移动到自身')
  // 不能移动到子孙目录（否则会把自己挂到自己里面，破坏整棵子树）
  const sep = normOld.includes('\\') ? '\\' : '/'
  if (normDest.startsWith(normOld + sep)) throw new Error('不能移动到其子文件夹内')

  const parent = dirname(oldPath)
  if (normDest === parent.replace(/[\\/]$/, '')) {
    // 落到原父目录 = 纯重命名，复用既有逻辑（含 .assets 同步）
    return renameItem(oldPath, name)
  }

  // 同名冲突：追加序号，绝不覆盖
  let target = join(destDir, name)
  let n = 1
  while (await exists(target)) {
    const ext = extname(name)
    const base = name.slice(0, name.length - ext.length)
    target = join(destDir, `${base} ${n}${ext}`)
    n += 1
  }

  // Windows 只读属性 / 云盘拦截：先清除目标父目录只读属性再试
  if (process.platform === 'win32') {
    try {
      await chmod(destDir, 0o777)
    } catch {
      // 清不掉也无妨，交给下面的 rename 报错
    }
  }

  try {
    await rename(oldPath, target)
  } catch (e) {
    // 跨卷（EXDEV 等）rename 不支持 → 递归复制后删源
    if ((e as NodeJS.ErrnoException)?.code === 'EXDEV') {
      await copyRecursive(oldPath, target)
      await rm(oldPath, { recursive: true, force: true })
    } else {
      throw e
    }
  }

  // 移动前先记录「是否为目录 / 目录内各 md 的相对路径」，以便把历史一并迁移
  let oldIsDir = false
  let oldMdRels: string[] = []
  try {
    const st = await stat(oldPath)
    oldIsDir = st.isDirectory()
    if (oldIsDir) {
      oldMdRels = (await collectMarkdownPaths(oldPath)).map((p) => relative(oldPath, p))
    }
  } catch {
    // 取不到则跳过历史迁移（跨卷回退场景下 oldPath 已被删，下面用 target 兜底）
    try {
      const st2 = await stat(target)
      oldIsDir = st2.isDirectory()
      if (oldIsDir) {
        oldMdRels = (await collectMarkdownPaths(target)).map((p) => relative(target, p))
      }
    } catch {
      // 忽略
    }
  }

  // 把历史目录一并迁移到新绝对路径（内容不含绝对路径，整目录搬走即可）
  if (vaultRoot) {
    try {
      if (oldIsDir) {
        for (const rel of oldMdRels) {
          await Snap.moveHistory(vaultRoot, join(oldPath, rel), join(target, rel))
        }
      } else {
        await Snap.moveHistory(vaultRoot, oldPath, target)
      }
    } catch {
      // 历史迁移失败不阻断主流程
    }
  }

  // 文件：顺带搬运同名的 `.assets` 资源目录（与 renameItem 同约定）
  try {
    if (isMarkdown(basename(oldPath))) {
      const oldNoExt = basename(oldPath, extname(oldPath))
      const newNoExt = basename(target, extname(target))
      if (oldNoExt && newNoExt) {
        const oldAssets = join(parent, `${oldNoExt}.assets`)
        const newAssets = join(dirname(target), `${newNoExt}.assets`)
        if ((await exists(oldAssets)) && !(await exists(newAssets))) {
          try {
            if (process.platform === 'win32') await chmod(oldAssets, 0o777).catch(() => {})
            await rename(oldAssets, newAssets)
          } catch {
            // 复制回退场景下 .assets 也走复制删除
            try {
              await copyRecursive(oldAssets, newAssets)
              await rm(oldAssets, { recursive: true, force: true })
            } catch {
              // 资源目录搬运失败不阻断主流程
            }
          }
        }
      }
    }
  } catch {
    // 资源目录同步失败不应让主流程报错
  }

  // 即时维护统一索引层，避免依赖 watcher 的延迟窗口
  syncIndexForMove(normOld, target)

  return target
}

/** 移动后即时维护索引：文件精确移除+登记；目录触发防抖全量 reconcile */
function syncIndexForMove(oldPath: string, newPath: string): void {
  if (!idx || idxRoot === null) return
  const root = idxRoot
  if (isMarkdown(basename(newPath))) {
    Idx.removeFileFromIndex(idx, oldPath)
    // 登记新位置（异步读取正文，不阻塞 move 返回）
    void (async () => {
      try {
        const content = await readFile(newPath, 'utf-8')
        const mtime = (await stat(newPath)).mtimeMs
        Idx.indexFile(idx!, root, newPath, content, mtime, getMaps(root))
      } catch {
        // 读不到则等 watcher 兜底
      }
      invalidateMaps()
      scheduleSave(root)
    })()
  } else {
    // 目录：旧路径条目随 reconcile 被纠正；先让路径映射失效并立即排一次全量对齐
    invalidateMaps()
    scheduleReconcile(root)
  }
}

/* ── 统一 vault 索引层（批次零地基，供搜索 / 双链 / 标签 / 图谱消费） ── */

let idx: Idx.VaultIndex | null = null
let idxRoot: string | null = null
/** 路径解析映射缓存：增删 / 目录变动时失效，内容变更事件复用，避免每次编辑 O(n) 重建 */
let pathMaps: { byBase: Map<string, string>; byRel: Map<string, string> } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let reconcileTimer: ReturnType<typeof setTimeout> | null = null

function invalidateMaps(): void {
  pathMaps = null
}

function getMaps(root: string): { byBase: Map<string, string>; byRel: Map<string, string> } {
  if (!pathMaps) {
    pathMaps = Idx.buildPathMaps(idx ? Object.keys(idx.files) : [], root)
  }
  return pathMaps
}

/** 索引变更后防抖落盘（沿用项目 temp+rename 原子写，缓存丢失静默重建） */
function scheduleSave(root: string): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (idx && idxRoot === root) void Idx.saveIndex(root, idx).catch(() => {})
  }, 800)
}

/** 目录级变动（新建/删除文件夹）后防抖全量对齐：仅重解析 mtime 变化者，禁周期重算 */
function scheduleReconcile(root: string): void {
  // 程序化改动（create/rename/move/delete）已由每文件 add/unlink 事件增量维护索引，
  // 全量 reconcile 纯属冗余且在大库上极重，跳过它避免「建个空文件夹都要走一遍全库」
  if (Date.now() < progSuppressUntil) return
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    if (!idx || idxRoot !== root) return
    void (async () => {
      idx = await Idx.reconcileIndex(root, idx)
      invalidateMaps()
      scheduleSave(root)
    })()
  }, 1000)
}

/**
 * 取得（或惰性构建）当前库索引。磁盘已有且版本匹配直接载入，否则一次性全量构建后落盘。
 * 绝不抛错中断主流程。
 */
async function ensureIndex(root: string): Promise<Idx.VaultIndex> {
  if (idx && idxRoot === root && idx.version === Idx.INDEX_VERSION) return idx
  const loaded = await Idx.loadIndex(root)
  if (loaded) {
    idx = loaded
  } else {
    idx = await Idx.buildIndex(root)
    void Idx.saveIndex(root, idx).catch(() => {})
  }
  idxRoot = root
  invalidateMaps()
  return idx
}

/** 单文件内容变动（add / change）：读正文 + mtime，增量重解析并修正反向链接 */
async function reindexFile(root: string, absPath: string): Promise<void> {
  if (!idx || idxRoot !== root || !isMarkdown(basename(absPath))) return
  let content: string
  let mtime: number
  try {
    content = await readFile(absPath, 'utf-8')
    mtime = (await stat(absPath)).mtimeMs
  } catch {
    return
  }
  Idx.indexFile(idx, root, absPath, content, mtime, getMaps(root))
  scheduleSave(root)
}

/** 单文件删除（unlink）：增量移除并清理反向链接 */
function deindexFile(root: string, absPath: string): void {
  if (!idx || idxRoot !== root || !isMarkdown(basename(absPath))) return
  Idx.removeFileFromIndex(idx, absPath)
  scheduleSave(root)
}

/* ── 目录监听 ───────────────────────────────── */

let watcher: FSWatcher | null = null

/**
 * 监听笔记库变化。外部改动（别的编辑器保存、Git 切分支、资源管理器里改名）
 * 都会推送给渲染层，让文件树始终与磁盘一致；同时增量维护统一索引层。
 */
export function watchVault(root: string, onChange: (change: VaultChange) => void): void {
  stopWatching()
  vaultRoot = root

  // 惰性建立 / 载入索引（不阻塞监听启动；搜索与后续维护会用到）
  void ensureIndex(root).catch(() => {})

  watcher = chokidarWatch(root, {
    // 根目录自身不能被自己的忽略规则排除掉
    ignored: (p: string) => p !== root && shouldSkipDir(basename(p)),
    ignoreInitial: true,
    // 保存是「写临时文件 + rename」，等落盘稳定再上报，避免读到半截内容
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  })

  const emit =
    (kind: VaultChangeKind) =>
    (path: string): void => {
      onChange({ kind, path })
      // 增量维护索引：增改重解析、删除移除、目录变动防抖全量对齐（禁任何全库周期重算）
      if (kind === 'add' || kind === 'change') {
        void reindexFile(root, path)
      } else if (kind === 'unlink') {
        deindexFile(root, path)
      } else if (kind === 'addDir' || kind === 'unlinkDir') {
        invalidateMaps()
        scheduleReconcile(root)
      }
    }

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

/* ── 全文搜索（消费统一索引层，解除 80 文件硬上限） ──────────────── */

/** 单文件内命中行上限：防止单个超大文件（如字典）撑爆结果列表；达到即标记 truncated */
const PER_FILE_HIT_CAP = 500
/** 命中文件软上限：超过则截断并标记 truncated，提示用户收窄查询（取代原 80 文件硬上限） */
const SOFT_FILE_CAP = 1000

/** 单文件内按行匹配（默认不区分大小写；支持区分大小写 / 全词匹配），返回命中行（已截断至 PER_FILE_HIT_CAP） */
async function searchInFile(
  file: string,
  query: string,
  opts?: SearchOptions,
): Promise<SearchLineHit[]> {
  let content: string
  try {
    content = await readFile(file, 'utf-8')
  } catch {
    return []
  }
  const hits: SearchLineHit[] = []
  const lines = content.split('\n')
  const re = buildSearchRegex(query, opts)
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      hits.push({ line: i + 1, text: lines[i].trim().slice(0, 240) })
      if (hits.length >= PER_FILE_HIT_CAP) break
    }
  }
  return hits
}

/**
 * 构造匹配正则。默认仅判定命中（非全局标志）；global=true 时带 'g' 供 replaceInVault 整文替换。
 * - 默认模式：转义 query + 全词边界 + 大小写开关；
 * - regex 模式：query 直接作为正则表达式（非法时降级为转义字面量，避免整次搜索失败）。
 */
function buildSearchRegex(query: string, opts?: SearchOptions, global = false): RegExp {
  const flags = (opts?.caseSensitive ? '' : 'i') + (global ? 'g' : '')
  if (opts?.regex) {
    try {
      return new RegExp(query, flags)
    } catch {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(escaped, flags)
    }
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = opts?.wholeWord ? `\\b${escaped}\\b` : escaped
  try {
    return new RegExp(pattern, flags)
  } catch {
    return new RegExp(escaped, flags)
  }
}

/**
 * 递归全文搜索。规则与 listTree 一致：跳过点目录、node_modules、同名 `.assets`，
 * 仅搜索 Markdown 文档。为控制开销，单文件最多 20 个命中、总共最多 80 个文件。
 */
/**
 * 全文搜索。两种范围共用同一套逻辑，仅范围不同：
 * - 全库：递归 root 下全部 Markdown 文档（默认）；
 * - 单文档：传入 file 时只搜该文件（即左侧「本文档」范围），不递归。
 * 选项（区分大小写 / 全词匹配）与命中行结构两种范围完全一致。
 */
/**
 * 全文搜索。两种范围共用同一套逻辑，仅范围不同：
 * - 全库：经统一索引枚举全部 Markdown 文档（免递归扫描），逐文件做正文匹配；
 * - 单文档：传入 file 时只搜该文件（左侧「本文档」范围）。
 * 已解除原 80 文件 / 20 命中硬上限，改用 PER_FILE_HIT_CAP 与 SOFT_FILE_CAP 软上限，
 * 超过即截断并以 `truncated` 提示前端。
 */
export async function searchVault(
  root: string,
  query: string,
  opts?: SearchOptions,
  file?: string,
): Promise<SearchResult> {
  const q = query.trim()
  if (!q) return { results: [], truncated: false }

  // 单文档范围：只检索引导文件，避免无谓的整库递归
  if (file) {
    const hits = await searchInFile(file, q, opts)
    const truncated = hits.length >= PER_FILE_HIT_CAP
    return {
      results: hits.length ? [{ path: file, name: basename(file), hits }] : [],
      truncated,
    }
  }

  // 全库范围：经索引枚举文件（免递归扫描），逐文件做正文匹配
  const index = await ensureIndex(root)
  const results: SearchFileResult[] = []
  let truncated = false
  for (const path of Object.keys(index.files)) {
    const hits = await searchInFile(path, q, opts)
    if (hits.length) {
      results.push({ path, name: basename(path), hits })
      if (hits.length >= PER_FILE_HIT_CAP) truncated = true
    }
    if (results.length >= SOFT_FILE_CAP) {
      truncated = true
      break
    }
  }
  return { results, truncated }
}

/**
 * 全局替换：在「当前搜索命中文件」范围内，把 query（字面量，匹配规则与 searchVault 一致：
 * 支持区分大小写 / 全词匹配）全部替换为 replacement，写回磁盘（仅内容真正变化时落盘）。
 * 返回替换总数与被修改文件数。范围限定为搜索命中的文件，避免误伤无关文档；
 * 绝不触碰图片/资源，只处理 Markdown 源文本。
 */
export async function replaceInVault(
  root: string,
  query: string,
  replacement: string,
  opts?: SearchOptions,
  file?: string,
): Promise<ReplaceResult> {
  const q = query.trim()
  if (!q) return { replaced: 0, files: 0, paths: [] }

  // 决定替换范围：单文档只取该文件，全库取搜索命中的文件（两种范围复用同一套匹配规则）
  let targets: string[]
  if (file) {
    const hits = await searchInFile(file, q, opts)
    targets = hits.length ? [file] : []
  } else {
    const results = await searchVault(root, q, opts)
    targets = results.results.map((r) => r.path)
  }

  // 复用主搜索正则构造（含 regex 模式支持），全局标志供整文替换
  const re = buildSearchRegex(q, opts, true)

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

/**
 * 链接健康检查（Phase 2 批次三 §3.7）。扫描 vault 内失效链接，规则与 listTree/searchVault 一致：
 * 跳过点目录、node_modules、同名 `.assets`，仅检查 Markdown 文档。
 *
 * 识别三类链接：
 *  - [[wikilink]]（支持 `[[X|别名]]`、`[[X#标题]]`）：按「基名（去扩展名）」或「相对库的去扩展名路径」解析；
 *  - Markdown 链接 `[text](target)`：相对当前文档目录解析后检查目标是否存在；
 *  - 图片 `![alt](target)`：同上，检查图片文件是否存在。
 * 外部链接（http(s)/mailto/tel/data/ftp、协议相对 //、www. 域名）与纯锚点（#标题）跳过，不计入断链。
 * 为控制开销，断链条目最多收集 2000 条即提前返回。
 */
export async function checkLinks(root: string): Promise<BrokenLinkReport> {
  const allMd: string[] = []
  // 第一遍：收集全部 Markdown 文档，建立「基名 / 相对路径」索引（小写、去扩展名）
  const byBase = new Map<string, string>()
  const byRel = new Map<string, string>()

  async function collect(dir: string): Promise<void> {
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
        await collect(full)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        allMd.push(full)
        const base = basename(full, extname(full)).toLowerCase()
        if (!byBase.has(base)) byBase.set(base, full)
        const rel = relative(root, full)
          .replace(/\.(md|markdown)$/i, '')
          .split(/[\\/]/)
          .join('/')
          .toLowerCase()
        if (!byRel.has(rel)) byRel.set(rel, full)
      }
    }
  }

  await collect(root)

  const items: BrokenLinkItem[] = []
  const MAX_ITEMS = 2000
  const wikiRe = /\[\[([^\]\n]+?)\]\]/g
  const mdRe = /!?\[[^\]\n]*\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g

  const isExternal = (t: string): boolean =>
    /^(https?:|mailto:|tel:|data:|ftp:)/i.test(t) || t.startsWith('//')

  for (const file of allMd) {
    let content: string
    try {
      content = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNo = i + 1

      // ── wikilinks ──
      wikiRe.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = wikiRe.exec(line)) !== null) {
        let target = m[1].trim().split('|')[0].split('#')[0].trim()
        if (!target) continue
        const key = target.replace(/^\.\//, '').replace(/\.(md|markdown)$/i, '')
        const match = key.includes('/')
          ? byRel.get(key.toLowerCase())
          : byBase.get(basename(key).toLowerCase())
        if (!match) {
          items.push({ file, line: lineNo, raw: m[0], target, kind: 'wikilink', context: line })
          if (items.length >= MAX_ITEMS)
            return { scanned: allMd.length, total: items.length, items }
        }
      }

      // ── md / image links ──
      mdRe.lastIndex = 0
      while ((m = mdRe.exec(line)) !== null) {
        let target = m[1].trim()
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim()
        target = target.split('#')[0].trim()
        if (!target) continue
        if (isExternal(target) || target.startsWith('#') || /^www\./i.test(target)) continue
        let decoded: string
        try {
          decoded = decodeURIComponent(target)
        } catch {
          decoded = target
        }
        const resolved = resolve(dirname(file), decoded)
        if (!(await exists(resolved))) {
          const isImage = m[0].startsWith('!')
          items.push({
            file,
            line: lineNo,
            raw: m[0],
            target,
            kind: isImage ? 'image' : 'mdlink',
            context: line,
          })
          if (items.length >= MAX_ITEMS)
            return { scanned: allMd.length, total: items.length, items }
        }
      }
    }
  }

  return { scanned: allMd.length, total: items.length, items }
}
