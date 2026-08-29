/**
 * `diff` 库（v7）未自带类型声明，这里仅声明快照 diff 预览用到的行级 diff API。
 * 行级 diff 用 `diffLines`；其余能力按需补全。
 */
declare module 'diff' {
  export interface Diff {
    value: string
    added?: boolean
    removed?: boolean
    count?: number
  }

  export function diffLines(
    oldStr: string,
    newStr: string,
    options?: Record<string, unknown>
  ): Diff[]
}
