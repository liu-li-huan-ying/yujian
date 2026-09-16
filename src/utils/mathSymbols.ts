/**
 * 公式编辑面板的符号表（纯数据 + 纯函数，供 `MathEditPanel.vue` 渲染、供 test-core 断言）。
 *
 * ## 为什么单拆一个模块
 * 符号表原先硬编码在 `MathEditPanel.vue` 的 `<script setup>` 里 —— SFC 无法被 `bundle()`
 * 打进测试（只处理 TS），于是「每个符号都必须有人类可读名 + 短语说明」这条产品约定
 * **没有任何门禁**，下一个人加符号时随手写个 `{ cmd }` 就漏了提示，又回到
 * 「悬停只有 `\frac{}{}`」的老问题（正是用户截图反馈的那条）。
 * 抽成纯模块后 §5.33 的「组件瘦身与可测化」在这里同样成立：数据与渲染分离。
 *
 * ## 数据约定
 *  - `cmd`   插入到 LaTeX 源码里的片段；含 `{}` 表示「插入后光标落进括号内」。
 *  - `label` 按钮上显示的**视觉字形**，不是 LaTeX 命令（`α` 而非 `\alpha`）。
 *  - `tip`   悬停/读屏的**人类可读名**，必须说人话（「分数」而非 `\frac{}{}`）。
 *
 * ⚠️ `label` 必须是「看得懂的字形」：公式面板是给写公式的人用的，
 *    按钮上写 `\begin{matrix}` 等于让人自己解析语法，反而更慢。
 */

/** 一个符号按钮：插入片段 + 显示字形 + 人类可读提示 */
export interface MathSymbol {
  /** 插入到源码的 LaTeX 片段 */
  cmd: string
  /** 按钮上显示的视觉字形（如 `α` / `a/b` / `√`），不是 LaTeX 命令 */
  label: string
  /** 悬停提示与读屏名，必须说人话（如「分数」） */
  tip: string
}

/** 符号分组：4 组，每组 ≤8（规格 docs/PHASE3-UI-DESIGN.md §4.4） */
export interface MathSymbolGroup {
  /** 分组显示名（由调用方从 i18n 传入，本模块不依赖 i18n） */
  label: string
  items: MathSymbol[]
}

/**
 * 构建四组符号。分组名从 i18n 传入以保持本模块无依赖。
 * @param names 四个分组的显示名（希腊/运算/结构/标注）
 */
export function buildSymbolGroups(names: {
  greek: string
  operators: string
  structure: string
  markup: string
}): MathSymbolGroup[] {
  return [
    {
      label: names.greek,
      items: [
        { cmd: '\\alpha', label: 'α', tip: '希腊字母 alpha' },
        { cmd: '\\beta', label: 'β', tip: '希腊字母 beta' },
        { cmd: '\\gamma', label: 'γ', tip: '希腊字母 gamma' },
        { cmd: '\\delta', label: 'δ', tip: '希腊字母 delta' },
        { cmd: '\\theta', label: 'θ', tip: '希腊字母 theta' },
        { cmd: '\\lambda', label: 'λ', tip: '希腊字母 lambda' },
        { cmd: '\\mu', label: 'μ', tip: '希腊字母 mu' },
        { cmd: '\\pi', label: 'π', tip: '希腊字母 pi' },
      ],
    },
    {
      label: names.operators,
      items: [
        { cmd: '\\times', label: '×', tip: '乘号' },
        { cmd: '\\div', label: '÷', tip: '除号' },
        { cmd: '\\pm', label: '±', tip: '正负号' },
        { cmd: '\\cdot', label: '·', tip: '点乘' },
        { cmd: '\\leq', label: '≤', tip: '小于等于' },
        { cmd: '\\geq', label: '≥', tip: '大于等于' },
        { cmd: '\\neq', label: '≠', tip: '不等于' },
        { cmd: '\\approx', label: '≈', tip: '约等于' },
      ],
    },
    {
      label: names.structure,
      items: [
        { cmd: '^{}', label: 'x²', tip: '上标' },
        { cmd: '_{}', label: 'x₂', tip: '下标' },
        { cmd: '\\frac{}{}', label: 'a/b', tip: '分数' },
        { cmd: '\\sqrt{}', label: '√', tip: '平方根' },
        { cmd: '\\sum', label: '∑', tip: '求和' },
        { cmd: '\\int', label: '∫', tip: '积分' },
        { cmd: '\\lim', label: 'lim', tip: '极限' },
        { cmd: '\\prod', label: '∏', tip: '连乘' },
      ],
    },
    {
      label: names.markup,
      items: [
        { cmd: '\\left(', label: '( )', tip: '自适应括号（左）' },
        { cmd: '\\right)', label: '( )', tip: '自适应括号（右）' },
        { cmd: '\\begin{matrix}', label: '矩阵', tip: '矩阵环境' },
        { cmd: '\\hline', label: '—', tip: '表格横线' },
        { cmd: '\\text{}', label: 'text', tip: '正体文字' },
        { cmd: '\\label{}', label: 'lab', tip: '定义编号标签' },
        { cmd: '\\eqref{}', label: 'ref', tip: '引用编号' },
        { cmd: '\\tag{}', label: 'tag', tip: '手动编号' },
      ],
    },
  ]
}

/** 每组符号数上限（规格 §4.4「每组 ≤8」） */
export const MAX_SYMBOLS_PER_GROUP = 8

/** 按钮悬停提示：`人类可读名 · LaTeX 片段` —— 既好认又能顺带学语法 */
export function symbolTip(s: MathSymbol): string {
  return `${s.tip} · ${s.cmd}`
}
