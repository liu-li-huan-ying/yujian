// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
var shared = resolve("electron/shared");
var root = resolve("src");
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": shared }
    },
    build: {
      outDir: "out/main",
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve("electron/main/index.ts") }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": shared }
    },
    build: {
      outDir: "out/preload",
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve("electron/preload/index.ts") }
      }
    }
  },
  renderer: {
    root,
    plugins: [vue()],
    resolve: {
      alias: {
        "@": root,
        "@shared": shared
      }
    },
    build: {
      outDir: "out/renderer",
      emptyOutDir: false,
      rollupOptions: {
        input: { index: resolve("src/index.html") }
      }
    },
    server: {
      port: 5173
    }
  }
});
export {
  electron_vite_config_default as default
};
