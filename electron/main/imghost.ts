import { app, safeStorage } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectLocalImages, rewriteImageUrls } from './assets'
import type {
  ImgHostConfig,
  ImgHostUploadItem,
  ImgHostUploadResult,
  PublishResult
} from '../shared/ipc-channels'

interface StoredConfig {
  provider: string
  name: string
  endpoint: string
  tokenHeader: string
  /** 经 safeStorage 加密后的 base64 字符串；空表示未设置密钥 */
  tokenEnc?: string
}

const CONFIG_FILE = (): string => join(app.getPath('userData'), 'imghost.json')

function loadStored(): StoredConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE(), 'utf-8')) as StoredConfig
  } catch {
    return null
  }
}

function decryptToken(stored: StoredConfig): string | null {
  if (!stored.tokenEnc) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(stored.tokenEnc, 'base64'))
  } catch {
    return null
  }
}

/** 返回给渲染层的配置（不含密钥明文） */
export function getImgHost(): ImgHostConfig | null {
  const s = loadStored()
  if (!s) return null
  return { provider: s.provider, name: s.name, endpoint: s.endpoint, tokenHeader: s.tokenHeader }
}

/**
 * 保存图床配置。token 为空字符串表示「沿用已有密钥」，不覆盖；
 * config 为 null 表示清除配置。
 */
export async function setImgHost(config: ImgHostConfig | null, token: string): Promise<void> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  if (!config) {
    await writeFile(CONFIG_FILE(), JSON.stringify({ provider: '', name: '', endpoint: '', tokenHeader: '' }))
    return
  }
  const prev = loadStored()
  let tokenEnc = prev?.tokenEnc
  if (token && token.length > 0) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持 safeStorage 加密，无法安全保存密钥')
    }
    tokenEnc = safeStorage.encryptString(token).toString('base64')
  }
  const stored: StoredConfig = {
    provider: config.provider,
    name: config.name,
    endpoint: config.endpoint,
    tokenHeader: config.tokenHeader,
    tokenEnc
  }
  await writeFile(CONFIG_FILE(), JSON.stringify(stored))
}

/** 上传文档内本地图片到图床；密钥只在主进程解密使用，不回传渲染层 */
export async function uploadToImgHost(items: ImgHostUploadItem[]): Promise<ImgHostUploadResult> {
  const stored = loadStored()
  if (!stored || !stored.endpoint) {
    return { ok: false, items: items.map((it) => ({ ref: it.ref, error: '未配置图床' })) }
  }
  const token = decryptToken(stored)
  if (!token) {
    return { ok: false, items: items.map((it) => ({ ref: it.ref, error: '未配置图床密钥' })) }
  }

  const results = await Promise.all(
    items.map(async (it): Promise<{ ref: string; url?: string; error?: string }> => {
      try {
        const bytes = await readFile(it.path)
        const url = await uploadOne(stored, token, bytes, it.path)
        return { ref: it.ref, url }
      } catch (e) {
        return { ref: it.ref, error: e instanceof Error ? e.message : String(e) }
      }
    })
  )
  return { ok: true, items: results }
}

async function uploadOne(
  stored: StoredConfig,
  token: string,
  bytes: Buffer,
  path: string
): Promise<string> {
  const form = new FormData()
  const fileName = path.split(/[\\/]/).pop() ?? 'image.png'
  const mime = fileName.endsWith('.png')
    ? 'image/png'
    : fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'application/octet-stream'
  // 转成 ArrayBuffer 支撑的 Uint8Array，满足 BlobPart 类型（Node Buffer 的 buffer 为 ArrayBufferLike）
  const view = new Uint8Array(bytes.byteLength)
  view.set(bytes)
  form.append(fieldName(stored.provider), new Blob([view], { type: mime }), fileName)
  form.append('format', 'json')

  const headers: Record<string, string> = {}
  if (stored.tokenHeader) headers[stored.tokenHeader] = token

  const resp = await fetch(stored.endpoint, { method: 'POST', headers, body: form })
  const data = (await resp.json()) as {
    success?: boolean
    code?: string
    message?: string
    data?: { url?: string }
  }
  if (!resp.ok || data.success === false) {
    throw new Error(data.message || `上传失败 (${resp.status})`)
  }
  // SM.MS: { success:true, data:{ url } }
  const url = data.data?.url
  if (!url) throw new Error('响应中缺少图片 URL')
  return url
}

/** 不同提供方的图片字段名 */
function fieldName(provider: string): string {
  switch (provider) {
    case 'smms':
      return 'smfile'
    default:
      return 'file'
  }
}

/**
 * 上传文档内全部本地图片到图床，并把 Markdown 中的本地引用改写为远程 URL。
 * 密钥只在主进程解密使用，不回传渲染层。返回改写后的完整 Markdown。
 */
export async function publishImages(markdown: string, docPath: string | null): Promise<PublishResult> {
  const locals = collectLocalImages(markdown, docPath)
  if (locals.length === 0) {
    return { ok: true, noImages: true, uploaded: 0, failed: 0 }
  }

  const stored = loadStored()
  if (!stored || !stored.endpoint) {
    return { ok: false, error: '未配置图床', uploaded: 0, failed: 0 }
  }
  const token = decryptToken(stored)
  if (!token) {
    return { ok: false, error: '未配置图床密钥', uploaded: 0, failed: 0 }
  }

  const replacements = new Map<string, string>()
  let uploaded = 0
  let failed = 0

  await Promise.all(
    locals.map(async (it) => {
      try {
        const bytes = await readFile(it.abs)
        const url = await uploadOne(stored, token, bytes, it.abs)
        replacements.set(it.ref, url)
        uploaded++
      } catch {
        failed++
      }
    })
  )

  const next = rewriteImageUrls(markdown, replacements)
  return { ok: true, markdown: next, uploaded, failed }
}
