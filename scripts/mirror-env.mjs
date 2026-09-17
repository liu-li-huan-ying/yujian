/**
 * 集中管理 Electron / electron-builder 的下载镜像环境变量。
 *
 * 原先这两个镜像写在项目 .npmrc 里（electron_mirror / electron-builder-binaries_mirror），
 * 但 npm 会把未知键报成 "Unknown project config" 警告。这些键本就不是 npm 的配置，
 * 而是 electron / electron-builder 通过其专属环境变量读取的：
 *   - ELECTRON_MIRROR（@electron/get 下载 electron 二进制）
 *   - ELECTRON_BUILDER_BINARIES_MIRROR（electron-builder 下载打包所需的二进制）
 * 故改为在此处统一设置，既保留镜像能力，又消除 npm 警告。
 *
 * 仅在变量尚未被外部环境设置时才写入，便于 CI / 个人环境覆盖。
 */
export function ensureMirrorEnv() {
  if (!process.env.ELECTRON_MIRROR) {
    process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  }
  if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
      'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
}
