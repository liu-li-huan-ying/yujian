import { Plugin, PluginKey } from '@milkdown/kit/prose/state'

/**
 * 「灌入事务」门闩 —— 让编辑器回显不再被误判为用户编辑。
 *
 * ## 问题
 * `load()` / 模式切换 / 快照恢复 / 图床发布都会把整篇内容灌进 ProseMirror。这是**程序化
 * 改动**，不是用户编辑；但 Crepe 的 `markdownUpdated` 会照常回显一次序列化结果。而 Crepe
 * 的序列化是**破坏性**的（无 remark-frontmatter 会吞掉 YAML 头、`[` 被转义成 `\[`），
 * 若把回显当成用户编辑 → 自动保存 → 把**根本没编辑过**的文档写坏。
 * 「打开即写坏」「内容地图打开有、过一会没了」都出自这条路径。
 *
 * ## 为什么不用「计数器 + setTimeout(0)」
 * `@milkdown/plugin-listener` 的 markdownUpdated 是 **200ms 防抖**的
 * （源码：`debounce(() => { … listeners.markdownUpdated.forEach(…) }, 200)`）。
 * 任何「灌入后延后一拍解除抑制」的时序假设都会在慢机器 / 长文档上偶发失效，
 * 而失效的代价是**静默写坏用户文件**——这正是最不能容忍的一类 bug。
 *
 * ## 做法：让标记跟着事务本身走
 * Milkdown 的 listener 明确跳过 `tr.getMeta('addToHistory') === false` 的事务：
 *   `if (!(tr.docChanged || tr.storedMarksSet) || tr.getMeta('addToHistory') === false) return`
 * 所以灌入事务打上该 meta 后**根本不会触发 markdownUpdated** —— 不是「触发了再抑制」，
 * 而是从源头不产生回显。语义上也更对：程序化整体替换本就不该进撤销历史。
 *
 * ## 实现要点
 * `replaceAll` 是 Milkdown 的高层命令，无法给它附加 meta。故用「门闩」+ 本插件的
 * `state.apply` 钩子：置位期间产生的 docChanged 事务，由插件补打 meta。
 * ⚠️ 本插件的 `state.apply` 必须**排在 listener 插件之前**（注册顺序即执行顺序）；
 * Milkdown 的 listener 在 Crepe 初始化时注册，本插件由 MilkdownEditor 在 `crepe.create()`
 * 之前 `editor.use(...)`，故顺序天然满足。
 */

/** 门闩：置位期间产生的文档变更事务视为程序化灌入 */
let ingestPending = false

/** 标记「接下来的事务是灌入」；返回解除函数（务必在 finally 里调用） */
export function beginIngest(): () => void {
  ingestPending = true
  return () => {
    ingestPending = false
  }
}

/** 当前是否处于灌入窗口（供测试与调试） */
export function isIngestPending(): boolean {
  return ingestPending
}

/** ProseMirror 插件：给灌入期间的事务补打 `addToHistory:false`，使回显不产生 */
export function createIngestPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('yj-ingest-gate'),
    state: {
      init: () => false,
      apply: (tr, _value) => {
        if (ingestPending && tr.docChanged) tr.setMeta('addToHistory', false)
        return ingestPending
      },
    },
  })
}
