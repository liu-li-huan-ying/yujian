/**
 * 回收站 —— 唯一需要 Electron 的「删除」环节，做成可注入的薄模块。
 *
 * 【为什么单独抽出来】
 * 项目数据安全铁律之一是「删除一律走系统回收站，绝不直接 rm」。实现这件事必须用
 * Electron 的 `shell.trashItem`，但**顶层** `import { shell } from 'electron'` 会让
 * 整个模块在 Node 里无法导入——于是 `vault.ts`（删除 / 移动 / 改名 / 迁移关联数据）
 * 这一片风险最高的代码长期零自动化覆盖（typecheck 管不到运行期顺序，而删除顺序错了
 * 就是不可逆的数据丢失）。
 *
 * 这里把 electron 改成**惰性** import：只有真的调 `trashItem()` 时才加载 electron。
 * 模块本身零顶层 Electron 依赖，故 `vault.ts` / `snapshots.ts` 可以被 esbuild 打包后
 * 在 Node 里直接跑测试。
 *
 * 测试里用 `setTrashImpl()` 注入假实现（如移进一个临时回收站目录），
 * 即可在不启动 Electron 的情况下覆盖「删除 / 移动是否把关联数据一起带走」。
 */

/** 回收站实现签名（测试可替换） */
export type TrashFn = (absPath: string) => Promise<void>

let override: TrashFn | null = null

/** 注入回收站实现；传 null 恢复真实实现（走 Electron shell.trashItem） */
export function setTrashImpl(fn: TrashFn | null): void {
  override = fn
}

/**
 * 把路径移入系统回收站（可恢复）。**绝不**退化成 `rm`——那是数据不可逆丢失。
 * 回收站不可用时（网络盘 / U 盘 / 某些 Linux 环境）由调用方决定是否降级，本函数只负责抛。
 */
export async function trashItem(absPath: string): Promise<void> {
  if (override) return override(absPath)
  // 惰性加载：让本模块在 Node 测试环境里可导入
  const { shell } = await import('electron')
  await shell.trashItem(absPath)
}
