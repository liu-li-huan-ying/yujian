import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

export interface SavedAsset {
  /** 磁盘绝对路径（用于读取/显示） */
  absPath: string
  /**
   * 相对文档目录的路径（如 `笔记.assets/foo.png`）。
   * 无文档路径时退化为绝对 file:// 路径，便于直接显示。
   */
  relPath: string
}

/**
 * 把粘贴/拖入的图片字节（base64）落盘到文档同级同名 `.assets` 目录。
 * 遵循项目图片约定：文档真源在 .md，同名 `.assets` 文件夹作为镜像，引用一律相对路径。
 */
export async function saveAsset(
  docPath: string | null,
  vaultPath: string | null,
  base64: string,
  ext: string
): Promise<SavedAsset> {
  const safeExt = (ext || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
  const stamp = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  const fileName = `${stamp}-${rand}.${safeExt}`

  let assetsDir: string
  let relPath: string

  if (docPath) {
    const dir = dirname(docPath)
    const base = basename(docPath, extname(docPath))
    assetsDir = join(dir, `${base}.assets`)
    relPath = `${base}.assets/${fileName}`
  } else if (vaultPath) {
    // 尚未保存成文件，但有笔记库：落到库根隐藏资源目录
    assetsDir = join(vaultPath, '.yujian-assets')
    relPath = join(assetsDir, fileName)
  } else {
    // 既没有文档也没有库：落系统临时目录，用绝对路径保证可显示
    assetsDir = tmpdir()
    relPath = join(assetsDir, fileName)
  }

  await mkdir(assetsDir, { recursive: true })
  const absPath = join(assetsDir, fileName)
  const buffer = Buffer.from(base64, 'base64')
  await writeFile(absPath, buffer)
  return { absPath, relPath }
}

/**
 * 从 Markdown 文本里收集本地图片引用（相对路径或 file:// 绝对路径），
 * 解析为磁盘绝对路径，供图床上传使用。
 * 返回每项包含原始引用 `ref`（用于回写 Markdown）与解析后的绝对路径 `abs`。
 */
export function collectLocalImages(
  markdown: string,
  docPath: string | null
): Array<{ ref: string; abs: string }> {
  const items: Array<{ ref: string; abs: string }> = []
  const seen = new Set<string>()
  const mdRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const htmlRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi
  let m: RegExpExecArray | null

  const push = (raw: string): void => {
    if (/^(https?:|data:|blob:)/i.test(raw)) return
    let abs: string
    if (raw.startsWith('file://')) abs = decodeURIComponent(raw.slice('file://'.length))
    else if (docPath) abs = join(dirname(docPath), raw)
    else return // 无 docPath 的相对引用无法解析，跳过
    if (seen.has(abs)) return
    seen.add(abs)
    items.push({ ref: raw, abs })
  }

  while ((m = mdRe.exec(markdown))) push(m[1])
  while ((m = htmlRe.exec(markdown))) push(m[1])
  return items
}

/** 把 Markdown 文本中命中的本地图片引用替换为远程 URL（图床镜像） */
export function rewriteImageUrls(
  markdown: string,
  replacements: Map<string, string>
): string {
  if (replacements.size === 0) return markdown
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = markdown
  for (const [local, remote] of replacements) {
    // 处理相对路径与 file:// 绝对路径两种写法
    const variants = [esc(local), esc('file://' + local)]
    for (const v of variants) {
      out = out.replace(new RegExp(v, 'g'), () => remote)
    }
  }
  return out
}
