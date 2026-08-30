declare module 'html-to-docx' {
  /** html-to-docx 选项（仅列出本项目用到的字段，其余以 unknown 兜底） */
  export interface HtmlToDocxOptions {
    type?: 'buffer' | 'blob' | 'file'
    orientation?: 'portrait' | 'landscape'
    margins?: { top?: number; bottom?: number; left?: number; right?: number }
    title?: string
    font?: string
    fontSize?: number
    pageSize?: string
    [key: string]: unknown
  }

  /**
   * 把 HTML 字符串转成 .docx。
   * @param htmlString 正文 HTML（建议只含 <article> 内部片段）
   * @param headerHtmlString 页眉 HTML，传 null 表示无页眉
   * @param options 选项；type 为 'blob' 时在浏览器返回 Blob
   * @returns Promise<Blob | Buffer | ArrayBuffer | Uint8Array>
   */
  export default function HTMLToDOCX(
    htmlString: string,
    headerHtmlString?: string | null,
    options?: HtmlToDocxOptions
  ): Promise<unknown>
}
