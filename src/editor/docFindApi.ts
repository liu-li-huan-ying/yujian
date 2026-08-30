/**
 * 本文档内查找 / 替换引擎对外契约。
 *
 * EditorHost 通过 defineExpose 暴露这一组方法（实现见 EditorHost.vue，底层分派到
 * find-source.ts / find-wysiwyg.ts）。侧栏「本文档」范围搜索直接调用，避免把整个
 * 编辑器组件实例当类型传入（Vue 组件实例类型的 $props 索引签名不兼容，会触发
 * 类型报错），故抽成稳定的最小接口。
 */
export interface DocFindOptions {
  /** 区分大小写（默认 false） */
  caseSensitive?: boolean
  /** 全词匹配（默认 false） */
  wholeWord?: boolean
}

export interface DocFindApi {
  /** 在当前文档内查找，高亮全部命中并选中首个；返回命中总数 */
  find(query: string, opts: DocFindOptions): number
  /** 跳到下一处命中 */
  findNext(): void
  /** 跳到上一处命中 */
  findPrev(): void
  /** 替换当前命中，返回替换后剩余命中数 */
  replaceOne(repl: string): number
  /** 替换全部命中，返回替换数 */
  replaceAll(repl: string): number
  /** 清除查找高亮 */
  clearFind(): void
  /** 当前命中序号（0-based） */
  readonly findCurrent: number
  /** 命中总数 */
  readonly findTotal: number
}
