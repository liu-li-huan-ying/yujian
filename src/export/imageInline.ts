/**
 * 导出时把相对路径图片内联为 data URL，产出自包含文档（离线 / 移动后仍可读）。
 *
 * 玉笺的图片约定：文档同级同名 `.assets`（如 `笔记.md` + `笔记.assets/`），
 * 正文里写相对路径，因此解析基准是「当前文档所在目录」。
 * 已是 data URL / 远程地址的图片直接跳过，避免无谓 IO 与误改外链。
 */

/**
 * 以 baseFile 所在目录为基准解析相对路径。
 * 纯字符串运算（渲染进程沙箱内没有 node:path），产出统一用 `/` 分隔，
 * Node 的 fs 在 Windows 上同时接受 `/` 与 `\`，主进程读取无碍。
 */
export function resolveRelative(baseFile: string, rel: string): string {
  const dir = baseFile.replace(/[\\/][^\\/]*$/, '')
  const parts = `${dir}/${rel}`.split(/[\\/]/)
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      out.pop()
      continue
    }
    out.push(p)
  }
  return out.join('/')
}

/** 无需读盘的地址：内联 data URL、远程 http(s)、以及浏览器本地协议 */
function isRemoteOrInline(src: string): boolean {
  return /^(data:|https?:|blob:|file:)/i.test(src.trim())
}

/**
 * 把 HTML 中相对路径的 `<img>` 替换为 data URL。
 * @param html          完整 HTML 文档字符串
 * @param docPath       当前文档路径（相对路径的解析基准）
 * @param readAsDataUrl 读绝对路径为 data URL 的实现（渲染进程经 IPC 调用，失败返回 null）
 */
export async function inlineImages(
  html: string,
  docPath: string,
  readAsDataUrl: (absPath: string) => Promise<string | null>
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imgs = Array.from(doc.querySelectorAll('img'))
  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (!src || isRemoteOrInline(src)) continue
    const dataUrl = await readAsDataUrl(resolveRelative(docPath, src))
    if (dataUrl) img.setAttribute('src', dataUrl)
  }
  return doc.documentElement.outerHTML
}
