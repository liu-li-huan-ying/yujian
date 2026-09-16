/**
 * 药丸托盘的「语言提示」补丁 —— 给 Crepe 自带的各处方丸托盘补 title / aria-label。
 *
 * ## 问题
 * Crepe 渲染出的多处方丸托盘按钮都是**裸元素**，只挂 icon、没有任何文案：
 *   ① 块操作手柄（正文块左侧「+」与六点把手）：`h('div', { class: 'operation-item' }, h(Icon, ...))`
 *   ② 表格列/行手柄弹出工具条：`h('button', { onPointerdown: ... }, h(Icon, ...))`
 *   ③ 表格增行/增列细线按钮：`h('button', { class: 'add-button' }, h(Icon, ...))`
 *   ④ 图片块占位区的「上传」`<label class="uploader">` + 链接预览后的「确认」`<div class="confirm">`
 *   ⑤ 图片块悬浮时右上角的「切到说明文字」`<div class="operation-item">`
 *   ⑥ 链接预览浮层的「打开链接 / 编辑 / 删除」三枚 **`<span class="milkdown-icon">`**
 *      —— 不是 `<button>`，连 `role` 都没有，读屏**完全不可达**（最严重的一处）
 *   ⑦ 链接编辑浮层的「确认」`<span class="milkdown-icon button confirm">`
 *   ⑧ 代码块右上角的「预览/编辑切换」`<button class="preview-toggle-button">`
 *   ⑨ 代码块语言选择器搜索框的「清空」`<div class="clear-icon">`（是 `<div>`，无 role）
 * 既无 `title` 也无 `aria-label`（对比 Crepe 的行内工具条，它有 label 与 aria-keyshortcuts）。
 * 结果：鼠标悬停只有图标没有说明，读屏软件念不出任何信息——各处方丸托盘的
 * 「语言提示」待遇不一致，正是用户反馈的点。
 *
 * ⚠️ 代码块那两处的追加说明（很重要）：
 *   - `previewToggleButton` **配置项确实存在且值是字符串**，但 `@milkdown/components` 把它
 *     当**图标名**用：`h(Icon, { icon: props.config.previewToggleButton(...) })`，
 *     于是文本被当成找不到的图标、渲染成空白 —— 这是上游的用法错配。
 *     故文案只能从 DOM 层补（本文件），**不能靠配置项**。
 *   - 这两处都在**按需创建的浮层/工具条**里：`preview-toggle-button` 仅当代码块有预览时
 *     才渲染；`clear-icon` 仅当语言下拉展开且输入框非空时才出现。
 *     因此除 `create()` 后补一次外，还必须在浮层出现时补 —— 由宿主侧的
 *     `MutationObserver` 兜底（见 MilkdownEditor `setupTrayObserver`）。
 *
 * ## 为什么在 DOM 上补而不是改 Crepe 配置
 * Crepe 只暴露**图标**配置（`handleAddIcon` / `handleDragIcon` / `tableBlockConfig.renderButton` /
 * `imageBlockConfig` 的各项 icon），**没有**任何文案字段。
 * 这些节点由各自的 plugin view 在挂载时建好、编辑器生命周期内复用，
 * 故 `create()` 之后补一次属性即可长期生效，无需 MutationObserver。
 *
 * ## 顺序约定（改 Crepe 版本时先复核）
 * - 块手柄的两个 `.operation-item` 固定为 [＋新增, ⠿拖拽]（见 block-edit 源码 Fragment 顺序）。
 * - 表格 **列** 手柄 `.cell-handle[data-role="col-drag-handle"] .button-group` 内固定 4 枚：
 *   [左对齐, 居中对齐, 右对齐, 删除本列]（见 table-block 源码 h() 顺序）。
 * - 表格 **行** 手柄 `.cell-handle[data-role="row-drag-handle"] .button-group` 内固定 1 枚：[删除本行]。
 * - 细线手柄 `.line-handle` 两枚：`x-line-drag-handle`（在下方加行）/ `y-line-drag-handle`（在右侧加列）。
 * - 图片块与链接浮层均按**唯一 class** 取用，不依赖下标（比表格那处更稳）。
 * 若结构变化则找不到元素、静默跳过（不抛错），不会影响编辑器启动。
 *
 * ## 为何用 `closest()` 而不是直接给 Icon 加属性
 * 链接浮层那三枚是 `<span class="milkdown-icon button link-icon">`，**本身没有可点语义**
 * （Crepe 把 `onClick` 挂在 span 上）。补 `role="button"` + `tabindex` 让它对读屏可见，
 * 是本文件里唯一「改的是可访问性语义、不只是加个提示」的地方。
 */

/** 块手柄两枚按钮的文案（由调用方从 i18n 传入，本模块不依赖 i18n） */
export interface HandleLabels {
  /** 「＋」：在此块下方插入新块 */
  add: string
  /** 「⠿」：拖拽移动此块 */
  drag: string
}

/** 表格手柄弹出工具条 + 细线增行增列的文案 */
export interface TableHandleLabels {
  /** 列手柄弹出条：左对齐 */
  alignLeft: string
  /** 列手柄弹出条：居中对齐 */
  alignCenter: string
  /** 列手柄弹出条：右对齐 */
  alignRight: string
  /** 列手柄弹出条：删除本列 */
  deleteCol: string
  /** 行手柄弹出条：删除本行 */
  deleteRow: string
  /** 细线手柄：在下方插入行 */
  addRow: string
  /** 细线手柄：在右侧插入列 */
  addCol: string
  /** 列手柄本体：拖拽移动本列 */
  dragCol: string
  /** 行手柄本体：拖拽移动本行 */
  dragRow: string
}

/** 图片块 + 链接浮层 + 代码块上那些「只长着图标」的小按钮的文案 */
export interface InlineTrayLabels {
  /** 图片块占位区：「上传本地图片」 */
  upload: string
  /** 图片块/链接编辑浮层：「确认」 */
  confirm: string
  /** 图片块右上角：「编辑图片说明」 */
  editCaption: string
  /** 链接预览浮层：「打开链接」 */
  openLink: string
  /** 链接预览浮层：「编辑链接」 */
  editLink: string
  /** 链接预览浮层：「移除链接」 */
  removeLink: string
  /** 代码块右上角：「切换预览 / 编辑」 */
  previewToggle: string
  /** 语言选择器搜索框：「清空搜索」 */
  clearSearch: string
}

/** 把 title / aria-label / role / tabindex 一次性写到元素上（幂等） */
function mark(el: Element | null | undefined, text: string | undefined): boolean {
  if (!el || !text) return false
  el.setAttribute('title', text)
  el.setAttribute('aria-label', text)
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '-1')
  return true
}

/** 把若干 `[选择器, 文案]` 一次性打上标签，返回命中数（缺失的选择器静默跳过） */
function markAll(root: ParentNode, pairs: Array<[string, string | undefined]>): number {
  let done = 0
  for (const [selector, text] of pairs) {
    if (mark(root.querySelector(selector), text)) done += 1
  }
  return done
}

/**
 * 给容器内所有块操作手柄补 `title` / `aria-label` / `role`。
 * 幂等：重复调用只覆盖同样的值，不会叠加。
 * @returns 被打了标签的元素个数（供测试断言）
 */
export function decorateBlockHandles(root: ParentNode | null, labels: HandleLabels): number {
  if (!root) return 0
  const items = root.querySelectorAll<HTMLElement>('.milkdown-block-handle .operation-item')
  if (items.length === 0) return 0
  const texts: Array<[number, string]> = [
    [0, labels.add],
    [1, labels.drag],
  ]
  let done = 0
  for (const [idx, text] of texts) {
    if (mark(items[idx], text)) done += 1
  }
  return done
}

/**
 * 给表格的列/行手柄弹出工具条 + 细线增行增列按钮补 `title` / `aria-label`。
 *
 * 覆盖 6 组元素（各自独立、缺一不影响其余）：
 *  - `.cell-handle[data-role='col-drag-handle']` 本体 —— 「拖拽移动本列」
 *  - 其 `.button-group` 内 4 枚按钮 —— 左/居中/右对齐、删除本列
 *  - `.cell-handle[data-role='row-drag-handle']` 本体 —— 「拖拽移动本行」
 *  - 其 `.button-group` 内 1 枚按钮 —— 删除本行
 *  - `.line-handle[data-role='x-line-drag-handle'] .add-button` —— 「在下方插入行」
 *  - `.line-handle[data-role='y-line-drag-handle'] .add-button` —— 「在右侧插入列」
 *
 * 幂等：重复调用只覆盖同样的值，不会叠加。
 * @returns 被打了标签的元素个数（供测试断言）
 */
export function decorateTableHandles(
  root: ParentNode | null,
  labels: TableHandleLabels,
): number {
  if (!root) return 0
  let done = 0

  const colHandle = root.querySelector<HTMLElement>(
    ".milkdown-table-block .cell-handle[data-role='col-drag-handle']",
  )
  if (mark(colHandle, labels.dragCol)) done += 1
  if (colHandle) {
    const colBtns = colHandle.querySelectorAll<HTMLElement>('.button-group button')
    const colTexts = [
      labels.alignLeft,
      labels.alignCenter,
      labels.alignRight,
      labels.deleteCol,
    ]
    for (let i = 0; i < colTexts.length; i += 1) {
      if (mark(colBtns[i], colTexts[i])) done += 1
    }
  }

  const rowHandle = root.querySelector<HTMLElement>(
    ".milkdown-table-block .cell-handle[data-role='row-drag-handle']",
  )
  if (mark(rowHandle, labels.dragRow)) done += 1
  if (rowHandle) {
    const rowBtns = rowHandle.querySelectorAll<HTMLElement>('.button-group button')
    if (mark(rowBtns[0], labels.deleteRow)) done += 1
  }

  const addRow = root.querySelector<HTMLElement>(
    ".milkdown-table-block .line-handle[data-role='x-line-drag-handle'] .add-button",
  )
  if (mark(addRow, labels.addRow)) done += 1

  const addCol = root.querySelector<HTMLElement>(
    ".milkdown-table-block .line-handle[data-role='y-line-drag-handle'] .add-button",
  )
  if (mark(addCol, labels.addCol)) done += 1

  return done
}

/**
 * 给图片块、链接浮层与代码块上那些「只长着图标」的小按钮补 `title` / `aria-label`。
 *
 * 覆盖 10 处（全部按**唯一 class** 定位，不依赖下标）：
 *  - `.milkdown-image-block .placeholder .uploader` —— 「上传本地图片」（是 `<label>`）
 *  - `.milkdown-image-block .image-preview + .confirm` / `.milkdown-image-inline .confirm` —— 「确认」
 *  - `.milkdown-image-block .operation-item` —— 「编辑图片说明」
 *  - `.milkdown-link-preview .link-icon` —— 「打开链接」
 *  - `.milkdown-link-preview .link-edit-button` —— 「编辑链接」
 *  - `.milkdown-link-preview .link-remove-button` —— 「移除链接」
 *  - `.milkdown-link-edit .confirm` —— 「确认」
 *  - `.milkdown-code-block .preview-toggle-button` —— 「切换预览/编辑」
 *  - `.milkdown-code-block .clear-icon` —— 「清空搜索」
 *
 * ⚠️ 链接浮层那几枚是 `<span class="milkdown-icon …">`，原本**连 `role` 都没有**，
 * 读屏完全不可达；代码块的 `.clear-icon` 是 `<div>`，同样没有 role。
 * 这里一并补上 `role="button"` + `tabindex`，是「可访问性语义」层面的修复，
 * 不只是加提示 —— 故即使调用方没传文案，也不该把它们从这条链路上摘掉。
 *
 * ⚠️ `.clear-icon` 在「输入框为空」时被 Crepe 加上 `hidden` class（`display:none`）。
 * 对隐藏元素补属性无害（它本就不该被读屏读到），故不做可见性判断 —— 少一处状态依赖。
 *
 * 幂等：重复调用只覆盖同样的值，不会叠加。
 * @returns 被打了标签的元素个数（供测试断言）
 */
export function decorateInlineTrays(root: ParentNode | null, labels: InlineTrayLabels): number {
  if (!root) return 0
  const pairs: Array<[string, string | undefined]> = [
    ['.milkdown-image-block .placeholder .uploader', labels.upload],
    ['.milkdown-image-block .confirm', labels.confirm],
    ['.milkdown-image-inline .confirm', labels.confirm],
    // 图片块悬浮时右上角那枚：Crepe 无 data-role，靠「在 image-block 内」+ class 定位。
    // 它和块操作手柄的 .operation-item 同名但在不同容器下，故必须带 .milkdown-image-block 前缀。
    ['.milkdown-image-block .operation-item', labels.editCaption],
    ['.milkdown-link-preview .link-icon', labels.openLink],
    ['.milkdown-link-preview .link-edit-button', labels.editLink],
    ['.milkdown-link-preview .link-remove-button', labels.removeLink],
    ['.milkdown-link-edit .confirm', labels.confirm],
    // 代码块工具条（两处都是按需渲染的，靠宿主 MutationObserver 守住「出现即补」）
    ['.milkdown-code-block .preview-toggle-button', labels.previewToggle],
    ['.milkdown-code-block .clear-icon', labels.clearSearch],
  ]
  return markAll(root, pairs)
}
