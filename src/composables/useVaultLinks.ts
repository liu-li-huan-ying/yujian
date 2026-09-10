import type { Ref } from 'vue'
import type { BrokenLinkItem } from '../../electron/shared/ipc-channels'
import { useI18n } from '../i18n'

export interface VaultLinkHooks {
  /** 当前笔记库根；为空表示尚未打开任何库 */
  vaultPath: Ref<string | null>
  /** 打开（或切换）笔记库——跳转/创建前若尚无库，先请用户选库 */
  openVault: () => Promise<void>
  /** 打开指定文档为标签并载入单实例编辑器 */
  openPath: (path: string) => Promise<void>
  /** 重扫文件树（新建笔记后刷新侧栏） */
  refreshTree: () => Promise<void>
  /** 顶部轻提示 */
  showToast: (msg: string, type?: 'ok' | 'err' | 'info', duration?: number) => void
  /** 断链面板一键创建成功后复检 */
  refreshLinkCheck: () => void
}

/**
 * 双链「目标解析」编排：集中 `[[wikilink]]` 芯片点击（跳转 / 一键创建）与断链一键创建。
 *
 * 这些流程都在回答同一个问题——「这个目标落到磁盘上是哪篇文档？」——散在组件里容易各写一份
 * 解析规则而漂移，故收进一个 composable；App.vue 只留模板绑定（见 CODE-REVIEW §2.2(1)）。
 */
export function useVaultLinks(hooks: VaultLinkHooks) {
  const { t: L } = useI18n()
  const U = L.ui

  /** 编辑器内点击 [[wikilink]] 芯片：解析目标 → 已存在则跳转，不存在则一键创建该笔记 */
  async function onWikilink(payload: { target: string; anchor?: string | null }): Promise<void> {
    if (!hooks.vaultPath.value) {
      await hooks.openVault()
      return
    }
    const resolved = await window.api.resolveWikiTarget(hooks.vaultPath.value, payload.target)
    if (resolved) {
      await hooks.openPath(resolved)
      return
    }
    // 目标不存在：以目标文件名一键创建笔记并打开（批次二需求：missing → one-click create）
    const base = payload.target.split(/[\\/]/).pop()?.split('#')[0].trim()
    if (!base) {
      hooks.showToast(U.wikilinkOpenFail, 'err')
      return
    }
    try {
      const created = await window.api.createDoc(hooks.vaultPath.value, base)
      await hooks.refreshTree()
      await hooks.openPath(created)
      hooks.showToast(U.wikilinkCreated.replace('{n}', created.split(/[\\/]/).pop() ?? base), 'ok')
    } catch {
      hooks.showToast(U.wikilinkOpenFail, 'err')
    }
  }

  /**
   * 断链一键创建：按目标写法的意图落位并打开新笔记。
   *  - 目标带路径（`folder/Note`）→ 视作库内相对路径，在库内对应目录建；
   *  - 目标为裸名（`Note`）→ 就地建在**来源笔记所在目录**，
   *    因为断链多半是同主题笔记互引，就地补齐能让目录保持内聚，而不是把库根堆成孤儿收容所。
   */
  async function onCreateBrokenLink(item: BrokenLinkItem): Promise<void> {
    const root = hooks.vaultPath.value
    if (!root) return
    const parts = item.target.replace(/\\/g, '/').trim().split('/').filter(Boolean)
    const name = (parts.pop() ?? '').replace(/\.(md|markdown)$/i, '')
    if (!name) {
      hooks.showToast(U.linkCheckCreateFail, 'err')
      return
    }
    const dir = parts.length > 0 ? [root, ...parts].join('/') : item.file.replace(/[\\/][^\\/]+$/, '')
    try {
      const created = await window.api.createDoc(dir, name)
      await hooks.refreshTree()
      await hooks.openPath(created)
      hooks.showToast(U.wikilinkCreated.replace('{n}', name), 'ok')
      hooks.refreshLinkCheck()
    } catch {
      hooks.showToast(U.linkCheckCreateFail, 'err')
    }
  }

  return { onWikilink, onCreateBrokenLink }
}
