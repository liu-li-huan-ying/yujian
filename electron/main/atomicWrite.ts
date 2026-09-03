import { access, chmod, copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 原子写：先写临时文件，再 rename 成目标；写入中途崩溃也不会损坏原文。
 *
 * 针对 Windows 上「目标文件只读属性 / 云同步客户端（OneDrive、百度网盘、坚果云…）短时锁」
 * 导致 rename 直接返回 EPERM 的普遍问题，做多层兜底，并确保临时文件绝不残留：
 *   1) 清目标只读属性后重试 rename（含短暂延时重试以度过同步锁，最多 3 次）；
 *   2) 删除目标后重试 rename；
 *   3) copyFile 直接覆盖目标，再清临时文件。
 * 只有 rename / unlink / copyFile 全部失败才抛出；非 EPERM 的真实错误立即抛出。
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.yujian-${randomUUID()}.tmp`)
  await writeFile(tmp, content, 'utf-8')

  const removeTmp = () => unlink(tmp).catch(() => {})
  const tryRename = () => rename(tmp, filePath)

  // 第一层：清只读属性后重试（云同步锁通常很短，给 3 次短暂重试窗口）
  for (let i = 0; i < 3; i++) {
    try {
      await tryRename()
      return
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      // 非 EPERM（如路径非法）或目标本就不存在 → 这是真实错误，别重试
      if (err?.code !== 'EPERM' || !(await exists(filePath))) {
        await removeTmp()
        throw e
      }
      await chmod(filePath, 0o666).catch(() => {})
      if (i < 2) await sleep(60)
    }
  }

  // 第二层：删目标再 rename
  try {
    await unlink(filePath)
    await rename(tmp, filePath)
    return
  } catch {
    // 第三层：直接覆盖写目标，再清临时文件
    await copyFile(tmp, filePath)
    await removeTmp()
  }
}
