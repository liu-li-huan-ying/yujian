import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const shared = resolve('electron/shared')
const root = resolve('src')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      outDir: 'out/main',
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve('electron/main/index.ts') }
      }
    }
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      outDir: 'out/preload',
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve('electron/preload/index.ts') }
      }
    }
  },

  renderer: {
    root,
    plugins: [vue()],
    resolve: {
      alias: {
        '@': root,
        '@shared': shared
      }
    },
    build: {
      outDir: 'out/renderer',
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve('src/index.html') }
      }
    },
    server: {
      port: 5173
    }
  }
})
