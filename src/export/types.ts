/**
 * 导出格式的统一类型与描述信息。
 *
 * 设计要点：
 * - 全集覆盖「纯 JS / WASM 可实现」的所有格式，不依赖 pandoc 等外部二进制；
 * - 文本类（md/txt/html/latex）以字符串传递；PDF 走隐藏窗口打印管线；
 * - 二进制类（docx/epub/rtf/odt）在渲染进程序列化为字节，经 IPC 以 base64 传给主进程写盘。
 */

/** 支持的全部导出格式 */
export type ExportKind =
  | 'md' // Markdown 源文件（直接透传正文）
  | 'txt' // 纯文本（剥离标签）
  | 'html' // 自包含 HTML 网页
  | 'pdf' // PDF 文档（隐藏窗口打印）
  | 'latex' // LaTeX 源文件
  | 'docx' // Word 文档
  | 'epub' // EPUB 电子书
  | 'rtf' // RTF 富文本
  | 'odt' // OpenDocument 文本

/** 二进制格式：在渲染进程序列化为字节，经 IPC 以 base64 传给主进程写盘 */
export function isBinary(k: ExportKind): boolean {
  return k === 'docx' || k === 'epub' || k === 'rtf' || k === 'odt'
}

/** 以等宽源码形式预览的格式（Markdown / 纯文本 / LaTeX） */
export function isSource(k: ExportKind): boolean {
  return k === 'md' || k === 'txt' || k === 'latex'
}

/** 文件扩展名（不含点） */
export function kindExt(k: ExportKind): string {
  return (
    {
      md: 'md',
      txt: 'txt',
      html: 'html',
      pdf: 'pdf',
      latex: 'tex',
      docx: 'docx',
      epub: 'epub',
      rtf: 'rtf',
      odt: 'odt'
    } as const
  )[k]
}

/**
 * 保存对话框文件类型名所需的 9 条译文。
 * 由上层从 i18n 的 ui 命名空间传入（复用「导出菜单」已有译文，不新增 key），
 * 这样本模块保持纯净——不 import 任何 i18n，也不假设当前语言。
 */
export interface ExportFilterLabels {
  exportMenuMd: string
  exportMenuTxt: string
  exportMenuHtml: string
  exportMenuPdf: string
  exportMenuLatex: string
  exportMenuDocx: string
  exportMenuEpub: string
  exportMenuRtf: string
  exportMenuOdt: string
}

/** 保存对话框的文件类型过滤（名称随界面语言走） */
export function kindFilter(
  k: ExportKind,
  U: ExportFilterLabels
): { name: string; extensions: string[] } {
  switch (k) {
    case 'md':
      return { name: U.exportMenuMd, extensions: ['md', 'markdown'] }
    case 'txt':
      return { name: U.exportMenuTxt, extensions: ['txt'] }
    case 'html':
      return { name: U.exportMenuHtml, extensions: ['html', 'htm'] }
    case 'pdf':
      return { name: U.exportMenuPdf, extensions: ['pdf'] }
    case 'latex':
      return { name: U.exportMenuLatex, extensions: ['tex'] }
    case 'docx':
      return { name: U.exportMenuDocx, extensions: ['docx'] }
    case 'epub':
      return { name: U.exportMenuEpub, extensions: ['epub'] }
    case 'rtf':
      return { name: U.exportMenuRtf, extensions: ['rtf'] }
    case 'odt':
      return { name: U.exportMenuOdt, extensions: ['odt'] }
  }
}
