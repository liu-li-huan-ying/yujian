/**
 * 自定义资源协议 `jade-asset://`：渲染层把相对图片路径解析为绝对路径后，
 * 以 `jade-asset://local/<encodeURIComponent(绝对路径)>` 形式引用，主进程按绝对路径读盘。
 *
 * 为什么不用 `file://`：开发模式渲染进程跑在 `http://localhost`，浏览器会拦截 http 源
 * 加载 `file://` 资源，导致图片在 dev 下全部裂开。统一走特权自定义协议后两种加载方式都正常。
 *
 * ⚠️ `registerSchemesAsPrivileged` 必须早于 app ready —— 故在本模块顶层执行（导入即生效）。
 */

import { protocol } from 'electron'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { reportSoftError } from './softError'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jade-asset',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
])

/** 按扩展名推断图片 MIME（协议处理器返回时使用） */
const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

/**
 * 处理 `jade-asset://local/<encoded-abs-path>` 请求：
 * 解码出磁盘绝对路径 → 读盘 → 以对应 MIME 返回。
 * 仅渲染层（本应用自身代码）会构造这种 URL，路径来自当前文档目录，不存在越权读取。
 */
function handleJadeAsset(request: GlobalRequest): GlobalResponse {
  try {
    const url = new URL(request.url)
    // pathname 形如 /%2FC%3A%2F...（绝对路径整体被 encodeURIComponent），
    // 解码后会多出一个协议层引入的前导斜杠：//C:/...（Windows）或 //Users/...（macOS）。
    let abs = decodeURIComponent(url.pathname)
    // 去掉那一个多余的协议层前导斜杠，恢复真实绝对路径
    abs = abs.replace(/^\//, '')
    // Windows 盘符归一：/C:/... → C:/...
    abs = abs.replace(/^\/([A-Za-z]:)/, '$1')
    const buf = readFileSync(abs)
    const mime = ASSET_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    return new Response(buf as unknown as BodyInit, {
      headers: {
        'content-type': mime,
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (e) {
    // 图片/附件读盘失败 → 渲染层表现为「裂图」，留痕以便排查（缺文件属常见，故 debug 级）
    reportSoftError('asset.read', e, 'debug')
    return new Response('Not found', { status: 404 })
  }
}

/** 注册协议处理器（须在 app ready 之后调用） */
export function registerAssetProtocol(): void {
  protocol.handle('jade-asset', handleJadeAsset)
}
