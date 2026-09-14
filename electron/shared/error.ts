/**
 * 错误归一化 —— **三进程共享的单一来源**。
 *
 * 为什么需要它：`e instanceof Error ? e.message : String(e)` 这个惯用法此前被抄了
 * 31 遍（另加 3 处同名函数定义），散落在渲染层与主进程。它是「错误提示文案」的唯一来源，
 * 真要调整（例如剥掉 Electron IPC 包装前缀）就得改 31 处且必然漏。
 *
 * 为什么放在 `electron/shared/`：主进程（`vaultIntegrity` / `imghost` / `index`）与
 * 渲染层都需要它，而渲染层的 `src/` 是主进程不得触碰的层。`electron/shared/` 是
 * 双方都够得着、且互不依赖的中立位置 —— 本目录**既是跨进程契约（ipc-channels、
 * wikilink-syntax、regex）的所在，也是跨进程通用工具的所在**。
 */

/**
 * 把任意抛出物归一为可读消息。
 *
 * `catch` 捕获到的值在 TS 里是 `unknown`：可能是 `Error`，也可能是字符串、对象、
 * 甚至 `null`。直接取 `.message` 会在非 Error 场景抛二次异常，故一律走本函数。
 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
