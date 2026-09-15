/** PKM 查询 IPC：双链解析 / 反链 / 未链接提及 / 标签树 / 内容地图 / 关系图谱。
 * 全部消费 watcher 维护的实时索引（getLiveIndex），避免回读有防抖延迟的磁盘快照。 */

import { ipcMain } from 'electron'
import { IPC, type GraphRequest, type UnlinkedMention } from '../../shared/ipc-channels'
import { getLiveIndex } from '../vault'
import * as VaultIndex from '../vaultIndex'

export function registerPkmIpc(): void {
  // 双链：把 [[wikilink]] 目标解析为 vault 内绝对路径（找不到返回 null，由前端决定创建或提示）
  ipcMain.handle(IPC.VAULT_RESOLVE_WIKILINK, (_event, root: string, target: string) =>
    VaultIndex.resolveWikiTarget(root, target),
  )

  // 双链：反链查询——哪些笔记链接到指定文档，附引用行上下文片段
  ipcMain.handle(IPC.VAULT_GET_BACKLINKS, (_event, root: string, absPath: string) =>
    VaultIndex.getBacklinksWithContext(root, absPath),
  )
  // 双链：[[ 自动补全候选——全部笔记标题（纯索引元数据，不读正文）
  ipcMain.handle(IPC.VAULT_LIST_NOTES, (_event, root: string) => VaultIndex.listNoteTitles(root))
  // 双链：未链接提及查询——纯文本提到当前笔记名但未加 [[ ]] 的片段
  ipcMain.handle(IPC.VAULT_UNLINKED_MENTIONS, (_event, root: string, absPath: string) =>
    VaultIndex.getUnlinkedMentions(root, absPath),
  )
  // 双链：把未链接提及包裹成 [[链接]] 写回磁盘（落笔前回验原文，绝不静默覆盖）
  ipcMain.handle(IPC.VAULT_WRAP_MENTION, async (_event, root: string, item: UnlinkedMention) =>
    VaultIndex.wrapUnlinkedMention(root, item),
  )
  // 标签聚合：列出全部标签（含计数 / 层级），由实时索引派生不存原始图。
  // 走 watcher 维护的内存索引（getLiveIndex），避免回读有 800ms 延迟的磁盘快照。
  ipcMain.handle(IPC.VAULT_LIST_TAGS, async (_event, root: string) =>
    VaultIndex.listTags(root, await getLiveIndex(root)),
  )
  // 标签聚合：按标签列出旗下笔记（点击标签面板条目时拉取）
  ipcMain.handle(IPC.VAULT_GET_NOTES_BY_TAG, async (_event, root: string, tag: string) =>
    VaultIndex.getNotesByTag(root, tag, await getLiveIndex(root)),
  )
  // 内容地图：列出全库 moc: true 的笔记（主题入口清单）
  ipcMain.handle(IPC.VAULT_LIST_MOCS, async (_event, root: string) =>
    VaultIndex.listMocs(root, await getLiveIndex(root)),
  )
  // 内容地图：某篇 MOC 的下级聚合（标签 / 出链 / 反链分组）
  ipcMain.handle(IPC.VAULT_GET_MOC_OUTLINE, async (_event, root: string, path: string) =>
    VaultIndex.getMocOutline(root, path, await getLiveIndex(root)),
  )
  // 关系图谱：由索引派生节点 / 边（本地子图 BFS / 全局度降序截断，纯函数零额外扫描）
  ipcMain.handle(IPC.VAULT_GRAPH, async (_event, root: string, req?: GraphRequest) =>
    VaultIndex.buildGraph(await getLiveIndex(root), req ?? {}),
  )
}
