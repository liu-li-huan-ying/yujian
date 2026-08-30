// 渲染进程是浏览器上下文（contextIsolation / sandbox），没有 Node 全局。
// mermaid 的部分图表模块（如 swimlanes 等）在导出渲染时会引用全局 `Buffer`，
// 而 Vite 不会为浏览器自动 polyfill Node 内置模块，导致运行时抛
// "Buffer is not defined"。此处注入纯 JS 实现的 Buffer，使全局可见。
// 必须放在入口模块（main.ts）体内，确保不被 tree-shaking 剔除，且在业务代码前生效。
import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer?: unknown }).Buffer = Buffer

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/scrollbar.css'
import './styles/base.css'
import './styles/zen.css'

createApp(App).use(createPinia()).mount('#app')
