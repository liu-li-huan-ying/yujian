/**
 * vault 包公开门面 —— 外部（主进程入口 / 完整性检查 / 测试）一律从此处导入，
 * 不直接触达内部子模块，以便内部继续细颗粒拆分而不影响调用方。
 *
 * 注：trash 的注入必须从本入口再导出。打包会把 ../trash 内联成独立副本，
 * 只在外层模块设注入是无效的；测试注入须与内部使用同一份实例。
 */
export { listTree, createDoc, createFolder, renameItem, deleteItem, moveItem } from './treeOps'
export { getLiveIndex } from './indexStore'
export { watchVault, stopWatching } from './watcher'
export { searchVault, replaceInVault } from './search'
export { checkLinks } from './linkCheck'
export { setTrashImpl, trashItem } from '../trash'
