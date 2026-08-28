/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly VITE_DEV_SERVER_URL?: string
    readonly DIST_ELECTRON?: string
    readonly DIST?: string
  }
}
