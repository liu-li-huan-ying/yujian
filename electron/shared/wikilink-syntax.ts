/**
 * `[[wikilink]]` 语法的**唯一定义** —— 索引层与编辑器 remark 层共用。
 *
 * 【为什么必须收敛到一处】
 * 同一条语法在仓库里原本有两份独立实现：
 *   - 编辑器层 `src/editor/features/wikilink.ts`：把文本改写成原子节点（`parseInner`）；
 *   - 索引层 `electron/main/vaultIndex.ts`：扫正文抽链、改链接（内联分段逻辑）。
 * 两份实现一旦语义漂移，就会长出幽灵问题：反链面板看得到、点进去却解析不到；
 * 或者索引把 `[[]]` 当链接而编辑器不认，导致「计数对不上正文」。
 * 更隐蔽的是正则**字面量**散在 6 处（含一份 `*` 与其余 `+?` 不一致），改一处漏一处。
 *
 * 本模块零依赖（纯函数 + 纯语法），主进程与渲染进程都可直接 import。
 *
 * 语法：`[[目标]]` / `[[目标|别名]]` / `[[目标#锚点]]` / `[[目标#锚点|别名]]`
 */

/**
 * 生成 `[[...]]` 匹配正则。**每次返回新实例**：带 `g` 的正则会持有可变 `lastIndex`，
 * 共享同一个实例跨调用会产生「偶发漏匹配」的幽灵 bug（尤其在有提前 return 的循环里）。
 *
 * 内层约束：至少 1 个字符、不含 `]`、不跨行——`[[]]` 与跨行都不算链接。
 */
export function wikiLinkRegex(): RegExp {
  return /\[\[([^\]\n]+?)\]\]/g
}

/** 输入规则用的锚定式（敲完 `]]` 即刻转换），非全局 */
export function wikiLinkInputRegex(): RegExp {
  return /\[\[([^\]\n]+?)\]\]$/
}

/** 一段 wikilink 内层文本的解析结果（同时给出「已归一」与「原文照抄」两套片段） */
export interface WikiLinkParts {
  /** 目标（已 trim），不含锚点/别名 */
  target: string
  /** 锚点（已 trim，不含 `#`）；无则 null */
  anchor: string | null
  /** 别名（已 trim，不含 `|`）；无则 null */
  alias: string | null
  /** 原文里的目标段（未 trim） */
  rawTarget: string
  /** 原文里的锚点段（含 `#`，未 trim）；无则空串 */
  rawAnchor: string
  /** 原文里的别名段（含 `|`，未 trim）；无则空串 */
  rawAlias: string
}

/**
 * 解析 `[[` 与 `]]` 之间的原始内容。
 *
 * 为什么同时返回 raw*：改写引用时**只能替换 target 段**，锚点/别名的原始拼写
 * （含多余空格）必须逐字节保留，否则一次重命名就会顺手改坏用户正文的排版。
 */
export function parseWikiLink(inner: string): WikiLinkParts {
  const pipe = inner.indexOf('|')
  const targetPart = pipe === -1 ? inner : inner.slice(0, pipe)
  const rawAlias = pipe === -1 ? '' : inner.slice(pipe)
  const hash = targetPart.indexOf('#')
  const rawTarget = hash === -1 ? targetPart : targetPart.slice(0, hash)
  const rawAnchor = hash === -1 ? '' : targetPart.slice(hash)

  const alias = rawAlias.slice(1).trim()
  const anchor = rawAnchor.slice(1).trim()
  return {
    target: rawTarget.trim(),
    anchor: anchor || null,
    alias: alias || null,
    rawTarget,
    rawAnchor,
    rawAlias
  }
}

/** 由解析结果还原 `[[...]]` 文本（`target` 为归一后的目标；锚点/别名沿用原文） */
export function buildWikiLink(parts: Pick<WikiLinkParts, 'rawAnchor' | 'rawAlias'>, target: string): string {
  return `[[${target}${parts.rawAnchor}${parts.rawAlias}]]`
}

/**
 * 扫出正文里全部 wikilink 的内层文本（含出现位置）。
 * 索引层与编辑器层都应走这里，确保「哪些算链接」永远一致。
 */
export function findWikiLinks(text: string): Array<{ inner: string; start: number; end: number }> {
  const out: Array<{ inner: string; start: number; end: number }> = []
  const re = wikiLinkRegex()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ inner: m[1], start: m.index, end: m.index + m[0].length })
  }
  return out
}
