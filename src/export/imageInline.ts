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
 * 把渲染层用的 `jade-asset://local/<encodeURIComponent(绝对路径)>` 还原为磁盘绝对路径。
 * 与 electron/main/index.ts 的 handleJadeAsset 对称：编码层会在绝对路径前多塞一个
 * 前导斜杠（/C:/... 或 /Users/...），这里去掉并做 Windows 盘符归一。
 */
function decodeJadeAssetUrl(src: string): string | null {
  const m = /^jade-asset:\/\/local\/(.*)$/i.exec(src.trim())
  if (!m) return null
  let abs = decodeURIComponent(m[1])
  abs = abs.replace(/^\/+/, '')
  abs = abs.replace(/^\/([A-Za-z]:)/, '$1')
  return abs || null
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
    if (!src) continue
    // 渲染层把图片改写为 jade-asset:// 协议 URL（仅显示用），导出时需还原为绝对路径再内联
    if (/^jade-asset:\/\//i.test(src)) {
      const abs = decodeJadeAssetUrl(src)
      const dataUrl = abs ? await readAsDataUrl(abs) : null
      if (dataUrl) img.setAttribute('src', dataUrl)
      continue
    }
    if (isRemoteOrInline(src)) continue
    const dataUrl = await readAsDataUrl(resolveRelative(docPath, src))
    if (dataUrl) img.setAttribute('src', dataUrl)
  }
  return doc.documentElement.outerHTML
}
