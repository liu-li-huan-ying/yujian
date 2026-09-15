/**
 * 文件树读写：列表 / 新建 / 重命名 / 删除 / 移动。
 *
 * 本模块是「关联数据随迁」铁律的唯一落点：.md 的移动/删除必须连 .assets 附件与
 * .yujian-history/<sha1> 历史一起带走，文件夹对内部每篇递归。改写引用后即时刷新索引
 * （顺序不可换，见 indexStore）。
 */

import { chmod, cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import type { FileNode, MoveResult } from '../../shared/ipc-channels'
import { isMarkdown, shouldSkipDir } from '../vaultIndex'
import * as Snap from '../snapshots'
import { reportSoftError } from '../softError'
import { markProgrammaticChange, resolveVaultRoot } from './context'
import { collectMarkdownPaths, exists, isPermError, trashOrRemove } from './fsUtils'
import { humanCompare } from './naturalSort'
import { rewriteLinksThenRefreshIndex } from './indexStore'

/** 递归扫描，产出「目录在前、自然排序」的树；空目录也会保留（否则新建文件夹后侧栏看不到） */
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
    return humanCompare(a.name, b.name)
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
      } catch (e) {
        reportSoftError('vault.chmod', e, 'debug')
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

/**
 * 重命名文件或文件夹。会顺带搬运同名的 `.assets` 资源目录（文档图片存储约定），
 * 并**自动更新全库指向旧路径的 `[[引用]]`**（文件名/路径变化时）。
 */
export async function renameItem(oldPath: string, newName: string): Promise<MoveResult> {
  const name = (newName ?? '').trim()
  if (!name) throw new Error('名称不能为空')
  // 不允许用路径分隔符伪造多级目录
  if (/[\\/]/.test(name)) throw new Error('名称不能包含路径分隔符')
  if (name === '.' || name === '..') throw new Error('名称无效')

  const parent = dirname(oldPath)
  const newPath = join(parent, name)
  if (newPath === oldPath) return { path: oldPath, filesUpdated: 0, linksUpdated: 0 }
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
  } catch (e) {
    reportSoftError('history.scan', e)
    // 取不到则跳过历史迁移
  }

  await rename(oldPath, newPath)

  // 把历史目录一并迁移到新绝对路径（内容不含绝对路径，整目录搬走即可）
  const historyRoot = await resolveVaultRoot(oldPath)
  if (historyRoot) {
    try {
      if (oldIsDir) {
        for (const rel of oldMdRels) {
          await Snap.moveHistory(historyRoot, join(oldPath, rel), join(newPath, rel))
        }
      } else {
        await Snap.moveHistory(historyRoot, oldPath, newPath)
      }
    } catch (e) {
      reportSoftError('history.move', e)
      // 历史迁移失败不阻断主流程
    }
  } else {
    reportSoftError('history.noRoot', new Error('vaultRoot 尚未初始化（watchVault 未执行），已跳过关联数据随迁'), 'warn')
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
  } catch (e) {
    reportSoftError('assets.move', e)
    // .assets 同步失败不应让主流程报错
  }

  // 自动更新全库指向旧路径的 [[引用]]（需求确认 2026-09-10），并即时维护索引
  const movePairs = oldIsDir
    ? oldMdRels.map((rel) => ({ from: join(oldPath, rel), to: join(newPath, rel) }))
    : isMarkdown(basename(newPath))
      ? [{ from: oldPath, to: newPath }]
      : []
  const { files, links } = await rewriteLinksThenRefreshIndex(movePairs)

  return { path: newPath, filesUpdated: files, linksUpdated: links }
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
  } catch (e) {
    reportSoftError('history.scan', e, 'debug')
    // 取不到则跳过历史清理
  }

  // Windows 上目标或父目录的只读属性会让 rm 失败；先尽力清除只读属性再删
  if (process.platform === 'win32') {
    try {
      await chmod(targetPath, 0o777)
    } catch (e) {
      reportSoftError('vault.chmod', e, 'debug')
      // 目标可能已不存在或权限极高，rm 的 force 会兜底
    }
    try {
      await chmod(dirname(targetPath), 0o777)
    } catch (e) {
      reportSoftError('vault.chmod', e, 'debug')
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
  } catch (e) {
    reportSoftError('assets.delete', e)
    // 资源目录清理失败不影响删除结果
  }

  // 清理对应的版本历史（走回收站）；文件夹则清理其中每篇文档的历史
  const historyRoot = await resolveVaultRoot(targetPath)
  if (historyRoot) {
    try {
      if (deletingDir) {
        for (const p of mdPaths) await Snap.deleteHistory(historyRoot, p)
      } else {
        await Snap.deleteHistory(historyRoot, targetPath)
      }
    } catch (e) {
      reportSoftError('history.delete', e)
      // 历史清理失败不影响删除结果
    }
  } else {
    reportSoftError('history.noRoot', new Error('vaultRoot 尚未初始化（watchVault 未执行），已跳过关联数据随迁'), 'warn')
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
): Promise<MoveResult> {
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
    } catch (e) {
      reportSoftError('vault.chmod', e, 'debug')
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
    } catch (e) {
      reportSoftError('history.scan', e)
      // 忽略
    }
  }

  // 把历史目录一并迁移到新绝对路径（内容不含绝对路径，整目录搬走即可）
  const historyRoot = await resolveVaultRoot(oldPath)
  if (historyRoot) {
    try {
      if (oldIsDir) {
        for (const rel of oldMdRels) {
          await Snap.moveHistory(historyRoot, join(oldPath, rel), join(target, rel))
        }
      } else {
        await Snap.moveHistory(historyRoot, oldPath, target)
      }
    } catch (e) {
      reportSoftError('history.move', e)
      // 历史迁移失败不阻断主流程
    }
  } else {
    reportSoftError('history.noRoot', new Error('vaultRoot 尚未初始化（watchVault 未执行），已跳过关联数据随迁'), 'warn')
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
            } catch (e) {
              reportSoftError('assets.move', e)
              // 资源目录搬运失败不阻断主流程
            }
          }
        }
      }
    }
  } catch (e) {
    reportSoftError('assets.move', e)
    // 资源目录同步失败不应让主流程报错
  }

  // 自动更新全库指向旧路径的 [[引用]]，并即时维护索引（避免 watcher 延迟窗口）
  const movePairs = oldIsDir
    ? oldMdRels.map((rel) => ({ from: join(oldPath, rel), to: join(target, rel) }))
    : isMarkdown(basename(target))
      ? [{ from: normOld, to: target }]
      : []
  const { files, links } = await rewriteLinksThenRefreshIndex(movePairs)

  return { path: target, filesUpdated: files, linksUpdated: links }
}
