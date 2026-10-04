/**
 * 保存合并器 —— 解决「在途保存时新内容被静默丢弃」。
 *
 * ## 要解决的 bug（2026-10-04 审计 P0-3）
 *
 * 旧逻辑是 `if (saving.value) return`：保存 A 在途时，自动保存定时器触发 → 直接早退 →
 * **新内容既没写、也没有任何东西会再触发保存**。用户最后几次编辑永久留在内存，
 * 直到他再敲一个字。手动 Ctrl+S 撞上在途保存同样静默早退（用户按了没反应）。
 *
 * ## 为什么是「合并」而不是「排队」
 *
 * 排队意味着：慢盘上 N 次编辑会累积 N 次串行写，越攒越多、越存越慢。
 * 合并意味着：*在途期间到来的请求，只保证在途那次结束后**再写一次最新内容***。
 *
 * 这与自动保存的语义天然对齐 —— 自动路径的合并触发条件是
 * 「一次写盘耗时 > 防抖窗口，且用户在此期间又停下了编辑」，实际最多两轮。
 * `maxRounds` 是硬保险：超过就交回调用方的防抖兜底，绝不无限自旋。
 *
 * ## 一个必须注意的时序陷阱（实测踩过）
 *
 * `inflight` **必须在进入异步循环之前就绪**。若像通常写法那样
 * `inflight = (async () => {...})()`，则 async 函数体会**同步执行到第一个 await**，
 * 此时 `run` 内部若同步回调 `request()`，读到的 `inflight` 仍是 null →
 * 被误判为「空闲」→ 递归开出新循环（实测跑到 101 轮才停）。
 * 故此处用 deferred：先建 promise 并赋给 inflight，再启动循环。
 *
 * ## 为什么不写在 EditorHost 里
 *
 * 项目铁律：纯逻辑（不 import vue、不碰 IPC）单独成文件才能被 `bundle()` 测。
 * 这个状态机是「最容易写错、也最该被断言」的部分。
 */

export interface CoalescerOptions<T> {
  /** 真正执行一次保存 */
  run: (payload: T) => Promise<void>
  /** 超过 maxRounds 仍未收敛时的兜底（通常是重排防抖定时器） */
  onDefer?: () => void
  /** 单次收敛内的最大写盘轮数，默认 3 */
  maxRounds?: number
}

export interface Coalescer<T> {
  /**
   * 请求一次保存。返回的 promise 在**本次请求对应的内容真正落盘后**才 resolve，
   * 故手动保存方可以据此 await 到真实结果。
   */
  request(payload: T): Promise<void>
  /** 放弃待补写（冲突检测发现外部改动时调用：绝不能再把自动保存补写上去） */
  cancel(): void
  /** 是否有保存正在进行（供 UI 显示「保存中」） */
  readonly busy: boolean
  /** 等待在途保存完全收敛（取代旧的 10ms 轮询） */
  settle(): Promise<void>
}

export function createCoalescer<T>(opts: CoalescerOptions<T>): Coalescer<T> {
  const maxRounds = opts.maxRounds ?? 3
  /** 当前收敛循环的完成信号；在循环启动**之前**赋值（见文件头时序陷阱说明） */
  let inflight: Promise<void> | null = null
  /** 在途期间是否又收到新请求 → 结束后需要再跑一轮 */
  let resaveRequested = false
  /** 最近一次收到的 payload（在途期间到达的会覆盖它，保证补写的是**最新**内容） */
  let latest: T | null = null

  function request(payload: T): Promise<void> {
    latest = payload
    // 在途：只标记「需要再写一次」，不排队。补写由当前循环在结束后自动消费。
    if (inflight) {
      resaveRequested = true
      return inflight
    }

    let done: () => void = () => {}
    inflight = new Promise<void>((resolve) => {
      done = resolve
    })
    // 此时 inflight 已就绪，下面循环内再来的 request 都会被正确判为「在途」
    ;(async () => {
      try {
        let rounds = 0
        do {
          resaveRequested = false
          const p = latest as T
          await opts.run(p)
          rounds++
        } while (resaveRequested && rounds < maxRounds)
        // 仍未收敛（保存极慢时用户持续输入）→ 交回防抖兜底，不在这里自旋。
        // 注意不清 resaveRequested：下一次 request 会重新置位。
        if (resaveRequested) opts.onDefer?.()
      } finally {
        inflight = null
        done()
      }
    })()
    return inflight
  }

  return {
    request,
    cancel() {
      // 只清「待补写」意图，绝不动在途的保存（它已经写了一半，收不回来）
      resaveRequested = false
    },
    get busy() {
      return inflight !== null
    },
    async settle() {
      while (inflight) await inflight
    },
  }
}
