/**
 * 二进制格式的序列化入口：根据 ExportKind 把规范化 HTML 转成对应字节流。
 * 文本类（md/txt/html/latex）与 PDF 不走这里，由 buildExportContent 直接处理。
 *
 * 依赖方向：本文件**依赖**各格式实现，实现只依赖 `types.ts` 里的 `SerializeCtx` 契约。
 * 「契约放 types、不放这里」是刻意的——否则实现会反过来 import 本调度器，形成循环依赖。
 */
import { type ExportKind, type SerializeCtx } from './types'
import { buildDocx } from './docx'
import { buildEpub } from './epub'
import { buildRtf } from './rtf'
import { buildOdt } from './odt'

/** 把规范化 HTML 序列化为目标格式的字节流 */
export async function serializeBinary(
  kind: ExportKind,
  canonicalHtml: string,
  ctx: SerializeCtx
): Promise<Uint8Array> {
  switch (kind) {
    case 'docx':
      return buildDocx(canonicalHtml, ctx)
    case 'epub':
      return buildEpub(canonicalHtml, ctx)
    case 'rtf':
      return buildRtf(canonicalHtml)
    case 'odt':
      return buildOdt(canonicalHtml, ctx)
    default:
      throw new Error(`不支持的二进制导出格式：${kind}`)
  }
}
