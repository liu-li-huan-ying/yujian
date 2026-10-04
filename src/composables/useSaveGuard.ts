import { ref } from 'vue'

/**
 * 保存失败的用户可见处理（2026-10-04 数据安全 P0-2）。
 *
 * 为什么单独成 composable：App.vue 只剩 26 行行数余量（`check-structure` 上限 1500，
 * 现状 1474），而这段逻辑要处理「弹窗策略 + 红点 + 会话内去重」三件事。
 *
 * ## 分级策略（主人裁定：宁可打扰也不能静默）
 *
 * 但**打扰也要有节制** —— 磁盘满时自动保存每 800ms 触发一次，若每次都弹窗，
 * 弹窗本身就成了故障源、把真正的错误刷进噪音里。故：
 *
 * - **手动保存失败** → **必弹 sticky**：用户主动按了 Ctrl+S 却什么都没发生，
 *   是最坏的体验；且这属于「用户完全不知情」的路径，必须打扰。
 * - **自动保存失败** → **红点常驻 + 首次弹一次 sticky**：会话内只提示一次
 *   （`autoNotified` 标志），之后靠红点持续可见。保存成功即清除。
 *
 * sticky（duration=0）而不是默认 2.6s：用户盯着编辑器时，
 * 一条自己消失的错误提示等于没有。
 */

export interface SaveFailure {
  path: string
  message: string
  kind: 'auto' | 'manual'
}

export interface SaveGuardDeps {
  showToast: (msg: string, type: 'ok' | 'err' | 'info', duration: number) => void
  /** 取当前激活文档路径；用于丢弃「上一个文档」的迟到失败提示 */
  activePath: () => string | null
  /** 路径→可读名（一般取 basename） */
  displayName: (path: string) => string
  /** 失败提示文案模板（注入以保持 i18n 中英双语一致） */
  messages: { manual: string; auto: string }
}

export interface SaveGuard {
  /** 是否有未解决的保存失败（供标题栏红点 / 状态栏绑定） */
  saveFailed: ReturnType<typeof ref<boolean>>
  /** 最近一次失败（供面板展示详情） */
  lastFailure: ReturnType<typeof ref<SaveFailure | null>>
  /** 由 App 绑到 EditorHost 的 @save-error */
  onSaveError(p: SaveFailure): void
  /** 保存成功后清除失败态（红点与 sticky 都收起） */
  onSaveOk(): void
  /** 切换文档时调用：清掉属于旧文档的失败态，避免红点一直挂着 */
  onDocSwitched(): void
}

export function useSaveGuard(deps: SaveGuardDeps): SaveGuard {
  const saveFailed = ref(false)
  const lastFailure = ref<SaveFailure | null>(null)
  // 会话内自动保存失败只提示一次，避免磁盘满时弹窗刷屏
  let autoNotified = false

  function onSaveError(p: SaveFailure): void {
    // 迟到提示过滤：切换文档后，在途保存的失败可能属于**上一个**文档。
    // 若不校验路径，用户会在新文档上看到「上一个文档保存失败」——比不提示更困惑。
    const cur = deps.activePath()
    if (cur && p.path !== cur) return

    saveFailed.value = true
    lastFailure.value = p
    const name = deps.displayName(p.path)

    if (p.kind === 'manual') {
      deps.showToast(deps.messages.manual.replace('{name}', name).replace('{msg}', p.message), 'err', 0)
      return
    }
    if (!autoNotified) {
      autoNotified = true
      deps.showToast(deps.messages.auto.replace('{name}', name).replace('{msg}', p.message), 'err', 0)
    }
  }

  function onSaveOk(): void {
    saveFailed.value = false
    lastFailure.value = null
    autoNotified = false
  }

  function onDocSwitched(): void {
    saveFailed.value = false
    lastFailure.value = null
    autoNotified = false
  }

  return { saveFailed, lastFailure, onSaveError, onSaveOk, onDocSwitched }
}
