/**
 * 索引层的全部类型与共享常量。零依赖，可被任意层引用。
 *
 * 由 vaultIndex 包拆分而来；详细设计铁律见 ./index.ts 头部。
 */
export const MD_EXT = new Set(['.md', '.markdown'])

/**
 * 索引结构版本。**改变 IndexEntry 的字段或语义时必须 +1**，否则磁盘上的旧缓存
 * （`.mdeditor/vault-index.json`）会被直接复用，未修改的文件永远拿不到新字段。
 * v2：tags 纳入正文内联 `#标签`（此前只有 frontmatter），并新增 moc 标记。
 */
export const INDEX_VERSION = 2

/** 索引内的单个文件记录（轻量元数据） */
export interface IndexEntry {
  /** 文档修改时间（ms epoch），用于增量 reconcile */
  mtime: number
  /** 标题：frontmatter title > 首个 H1；为空串表示未知 */
  title: string
  /** 标题层级（heading），最多 50 条，供批次三图谱/大纲复用，不存正文 */
  headings: { level: number; text: string }[]
  /** 解析后的出链（已是 vault 内绝对路径，仅含解析成功的目标） */
  outLinks: string[]
  /** 标签：frontmatter tags 与正文内联 `#标签` 合并去重后的小写 key */
  tags: string[]
  /** 是否为内容地图（MOC）：frontmatter `moc: true` */
  moc: boolean
}

export interface VaultIndex {
  version: number
  /** key = 文档绝对路径 */
  files: Record<string, IndexEntry>
  /** key = 被链接的文档绝对路径；value = 链接到它的文档绝对路径集合 */
  backLinks: Record<string, string[]>
}

/* ── 文件判定（与 listTree / checkLinks 同源，收拢到此避免重复实现） ── */

/** 「基名 / 相对库路径 → 绝对路径」映射（wikilink 目标解析的唯一依据） */
export interface PathMaps {
  byBase: Map<string, string>
  byRel: Map<string, string>
}

/** 一次移动的「旧绝对路径 → 新绝对路径」；目录移动由调用方展开为「逐篇文档」 */
export interface MovePair {
  from: string
  to: string
}

export interface LinkRewriteSummary {
  /** 被改写的源文件绝对路径（已按新位置计算），供调用方立即刷新索引 */
  sources: string[]
  /** 被改写的来源文件数 */
  files: number
  /** 被改写的链接条数 */
  links: number
}
