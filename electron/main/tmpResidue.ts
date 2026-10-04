import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'

/**
 * 崩溃残留临时文件（`.yujian-*.tmp`）的识别与恢复。
 *
 * ## 这些残留是什么
 *
 * `atomicWrite` 走「写临时文件 → rename 成目标」。正常结束不留任何东西，
 * 但若进程在 rename 前被杀（崩溃 / 强杀 / 断电），临时文件会留在原地。
 *
 * **它不是垃圾，是完整的新版本。** 原实现对此毫无处理：
 *  - 注释 `atomicWrite.ts` 声称「确保临时文件绝不残留」，与实现不符（硬杀必然残留）；
 *  - 启动时无任何扫描（`main/index.ts` 只有 registerSchemes / registerIpc / createWindow）；
 *  - 后果一：残留会被整库备份打包（`vaultBackup` 只跳过 `.mdeditor`），撑大备份体积；
 *  - 后果二：用户上次没保存成功的内容躺在磁盘上，无人告知。
 *
 * ## 处置原则（主人裁定：恢复副本为默认、绝不覆盖）
 *
 * 三选项走 ConfirmDialog：**恢复为副本**（默认，同目录写 `<名>.recovered-<ts>.md`）/
 * 移入回收站 / 暂不处理。**绝不静默删、绝不覆盖同名 .md** —— tmp 里可能正是
 * 用户唯一一份新版本，静默删除等于丢数据，覆盖等于毁掉原文件。
 *
 * ## 有界扫描
 *
 * tmp 写在 `dirname(filePath)`，深度理论无界。故**深度 ≤ 2（库根 + 一层子目录）**、
 * 上限 `MAX_ITEMS` 个、2 秒预算：覆盖 99% 场景且成本可预测，
 * 不会让打开一个深目录结构的库时卡住启动。
 */

/** `.yujian-<uuid36>--<基名>.tmp` */
const TMP_RE = /^\.yujian-([0-9a-f-]{36})--(.+)\.tmp$/

export const MAX_ITEMS = 200
const DEPTH_LIMIT = 2

export type TmpState = 'pending' | 'orphan'

export interface TmpResidue {
  /** 临时文件绝对路径 */
  tmpPath: string
  /** 目标文档基名（从文件名解析；命名不含基名时为 null） */
  targetBase: string | null
  /** tmp 修改时间（判断新旧） */
  mtime: number
  size: number
  /**
   * - `pending`：目标 .md **不存在** → 崩溃发生在 unlink 与 rename 之间，
   *   这份 tmp 是**唯一副本**，必须恢复。
   * - `orphan`：目标存在 → rename 其实成功了、只是没清 tmp；内容大概率已被覆盖。
   */
  state: TmpState
}

/** 解析 tmp 文件名；不符合命名则返回 null */
export function parseTmpName(name: string): { uuid: string; base: string } | null {
  const m = TMP_RE.exec(name)
  if (!m) return null
  return { uuid: m[1], base: m[2] }
}

export interface ScanOptions {
  maxItems?: number
  depthLimit?: number
  /** 单项扫描器（注入便于测试与预算控制） */
  scanOne?: (dir: string) => Promise<TmpResidue[]>
}

/**
 * 有界扫描库内 tmp 残留。**只读**，不修改任何文件。
 */
export async function listTmpResidue(root: string, opts: ScanOptions = {}): Promise<TmpResidue[]> {
  const maxItems = opts.maxItems ?? MAX_ITEMS
  const depthLimit = opts.depthLimit ?? DEPTH_LIMIT
  const scanOne = opts.scanOne ?? scanDir

  const out: TmpResidue[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > depthLimit || out.length >= maxItems) return
    let found: TmpResidue[]
    try {
      found = await scanOne(dir)
    } catch {
      return
    }
    out.push(...found)
    if (depth === depthLimit) return
    // 只进一层子目录；跳过点目录（.yujian-history / .mdeditor 内部不会有残留，
    // 且进去会把历史快照全扫一遍，代价与收益完全不成比例）
    let entries: string[]
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= maxItems) return
      await visit(join(dir, name), depth + 1)
    }
  }
  await visit(root, 1)
  return out.slice(0, maxItems)
}

async function defaultExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function scanDir(dir: string): Promise<TmpResidue[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: TmpResidue[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const parsed = parseTmpName(e.name)
    if (!parsed) continue
    const tmpPath = join(dir, e.name)
    try {
      const st = await stat(tmpPath)
      const targetPath = join(dir, parsed.base)
      out.push({
        tmpPath,
        targetBase: parsed.base,
        mtime: st.mtimeMs,
        size: st.size,
        state: (await defaultExists(targetPath)) ? 'orphan' : 'pending',
      })
    } catch {
      // 竞态：扫到时已被清理 → 跳过，不算残留
    }
  }
  return out
}

/**
 * 恢复为副本：**绝不覆盖同名 .md**。
 *
 * 这是本模块最关键的不变量 —— tmp 里可能是用户唯一一份新版本，
 * 覆盖原文件等于毁掉唯一确定完好的那一份。
 */
export async function restoreAsCopy(res: TmpResidue, now = Date.now()): Promise<string> {
  const dir = dirname(res.tmpPath)
  const src = res.targetBase ?? 'untitled'
  const stem = src.replace(/\.md$/i, '')
  let target = join(dir, `${stem}.recovered-${now}.md`)
  // 极端情况下同名已存在（同一毫秒两次恢复）→ 追加序号，绝不覆盖
  let n = 2
  while (await defaultExists(target)) {
    target = join(dir, `${stem}.recovered-${now}-${n++}.md`)
  }
  const content = await readFile(res.tmpPath, 'utf-8')
  await writeFile(target, content, 'utf-8')
  return target
}

/** 供 UI 显示：残留的可读名（用于提示文案） */
export function residueLabel(res: TmpResidue): string {
  return res.targetBase ?? basename(res.tmpPath)
}
