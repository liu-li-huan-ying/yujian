/**
 * 切换类操作前的「保存守卫」（2026-10-04 数据安全审计，清单外发现的最重回归点）。
 *
 * ## 要防的事故
 *
 * `save()` 改为「失败不抛、走事件通道」之后（见 EditorHost），原本依赖抛错来
 * 中止流程的调用方会**全部失效**，于是：
 *
 * ```
 * 用户改了 5 分钟内容 → 磁盘满 → 点另一个标签/切库/关标签
 *   → save() 失败但不再抛 → 继续切 → 保真层被新文档覆盖 → 编辑器清空
 *   → 内容只剩内存，编辑器一清就没了
 * ```
 *
 * 这**比改造前更糟**：旧实现虽然静默，但 `await save()` 至少会 reject 到 `void` 之外
 * 让人知道出过事；新实现若不显式处理，就变成了"安静地丢数据"。
 *
 * 故凡是「保存失败就应该停下来」的地方，一律走本守卫。
 *
 * ## 为什么独立成 composable
 *
 * App.vue 当时只剩 26 行余量（结构门禁上限 1500）。这类守卫要在 4 处调用点复用，
 * 内联会 4 份重复代码 —— 重复即漂移，漏一处就是一个新的数据丢失路径。
 */

export interface SaveGuardLike {
  /** 是否有未落盘改动 */
  readonly dirty: boolean
  /** 返回 false 表示保存失败（调用方必须中止后续流程） */
  save(): Promise<boolean>
}

export interface GuardedActions {
  /** 保存成功才继续；失败则中止（供 openPath / closeTab / openVault 复用） */
  saveOrAbort(): Promise<boolean>
}

/**
 * 构造「保存守卫」。host 为 null（编辑器未挂载）时视为无需保存，直接放行。
 */
export function useSaveGuardForSwitch(getHost: () => SaveGuardLike | null): GuardedActions {
  async function saveOrAbort(): Promise<boolean> {
    const host = getHost()
    // 无编辑器实例（首次启动 / 库为空）→ 无脏数据可言，放行
    if (!host || !host.dirty) return true
    const ok = await host.save()
    // 失败时 save() 已通过事件通道弹了 sticky 错误，这里只负责中止流程
    return ok !== false
  }

  return { saveOrAbort }
}
