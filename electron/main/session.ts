import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { atomicWrite } from './atomicWrite'
import {
  DEFAULT_SESSION,
  DEFAULT_ZEN_PREFS,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  type SessionState,
  type StartupMode,
  type ZenPrefs
} from '../shared/ipc-channels'

/**
 * 会话状态持久化 —— 崩溃恢复的地基。
 *
 * 注意职责边界：文档内容的安全由编辑器的自动保存保证（编辑后 800ms 内
 * 原子写回原文件，丢失窗口极短）。这里只负责「重启后回到上次的位置」：
 * 哪个笔记库、哪篇文档、什么模式、侧栏多宽。
 */
const FILE_NAME = 'session.json'

function sessionPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

/** 逐字段校验凝神偏好：手改坏的历史值一律回退默认，不让非法值进入运行时 */
function sanitizeZenPrefs(p: Record<string, unknown>): ZenPrefs {
  const raw = (p.zenPrefs ?? {}) as Record<string, unknown>
  const anchor = raw.anchor
  const scroll = raw.scroll
  return {
    anchor:
      typeof anchor === 'number' && Number.isFinite(anchor) && anchor > 0.1 && anchor < 0.9
        ? anchor
        : DEFAULT_ZEN_PREFS.anchor,
    fog:
      raw.fog === 'fast' || raw.fog === 'mid' || raw.fog === 'slow'
        ? raw.fog
        : DEFAULT_ZEN_PREFS.fog,
    scroll:
      typeof scroll === 'number' && Number.isFinite(scroll) && scroll > 0.01 && scroll <= 1
        ? scroll
        : DEFAULT_ZEN_PREFS.scroll,
    fullscreen: raw.fullscreen === true,
    retreatBar: raw.retreatBar !== false
  }
}

/** 逐字段校验：历史版本或被手改坏的 session 都不能污染运行时 */
function sanitize(raw: unknown): SessionState {
  const p = (raw ?? {}) as Record<string, unknown>
  const width = p.sidebarWidth

  return {
    vaultPath: typeof p.vaultPath === 'string' ? p.vaultPath : null,
    activePath: typeof p.activePath === 'string' ? p.activePath : null,
    openTabs: Array.isArray(p.openTabs)
      ? (p.openTabs as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    mode: p.mode === 'source' ? 'source' : 'wysiwyg',
    sidebarWidth:
      typeof width === 'number' && Number.isFinite(width)
        ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width))
        : DEFAULT_SESSION.sidebarWidth,
    startupMode: (p.startupMode === 'fresh' ? 'fresh' : 'restore') as StartupMode,
    sidebarVisible: p.sidebarVisible !== false,
    outlineVisible: p.outlineVisible !== false,
    focusMode: p.focusMode === true,
    writingGoal:
      typeof p.writingGoal === 'number' && Number.isFinite(p.writingGoal) && p.writingGoal > 0
        ? Math.floor(p.writingGoal)
        : 0,
    zenPrefs: sanitizeZenPrefs(p)
  }
}

/** 读取会话。文件缺失、损坏、权限异常都安全回退默认值，绝不让启动失败 */
export async function readSession(): Promise<SessionState> {
  try {
    const raw = await readFile(sessionPath(), 'utf-8')
    return sanitize(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SESSION }
  }
}

/** 合并写入：只覆盖传入字段，避免多处 patch 互相抹掉对方的值 */
export async function patchSession(patch: Partial<SessionState>): Promise<SessionState> {
  const next = { ...(await readSession()), ...patch }
  await persist(sanitize(next))
  return next
}

async function persist(state: SessionState): Promise<void> {
  const target = sessionPath()
  try {
    // 原子写（临时文件 + rename），对 Windows 只读 / 同步锁 EPERM 做兜底；写入中途崩溃不会留下半个 json
    await atomicWrite(target, JSON.stringify(state, null, 2))
  } catch {
    // 会话持久化失败不该干扰编辑，静默即可
  }
}
