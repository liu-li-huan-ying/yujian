# 玉笺 Markdown 编辑器

所见即所得的跨平台桌面 Markdown 编辑器，可一键切换源码模式。
默认面向**技术写作**场景：代码高亮、Mermaid 图表、公式、表格与导出。

当前处于**阶段 0**：工程骨架已跑通，编辑器内核尚未接入。

## 技术栈

| 项    | 选型                       | 说明                                     |
| ---- | ------------------------ | -------------------------------------- |
| 运行时  | Electron 44              | 不依赖任何 C++ 工具链，官方提供预编译二进制               |
| 构建   | electron-vite 5 + vite 7 | vite 版本不可升到 8（electron-vite 的 peer 限制） |
| 前端   | Vue 3 + TypeScript       | <br />                                 |
| 编辑内核 | Milkdown Crepe 7         | 基于 ProseMirror + remark，Markdown 是一等公民 |
| 源码模式 | CodeMirror 6             | 与 WYSIWYG 共享同一份 Markdown 文本            |
| 搜索   | MiniSearch               | 纯 JS 倒排索引，零原生编译                        |

## 快速开始

```bash
npm install
npm run dev      # 开发模式，热更新
npm run build    # 构建产物到 out/
npm run dist     # 打包 Windows 安装包
```

## 已知环境坑

**1. `ELECTRON_RUN_AS_NODE` 导致窗口不起来**

部分 IDE（如 WorkBuddy、VS Code）本身是 Electron 应用，会向派生的 shell 注入
`ELECTRON_RUN_AS_NODE=1`。该变量会让 `electron.exe` 退化成纯 Node 运行：

* `process.type` 变成 `undefined`（正常应为 `browser`）
* `require('electron')` 返回**二进制路径字符串**，而非 API 对象
* 应用不报错，但永远不创建窗口

`scripts/dev.mjs` 已在启动前清除该变量，`npm run dev` 可直接使用。
命令行手动运行时：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe .
```

**2. `electron --version` 打印的是内置 Node 版本**

Electron 44 内置 Node 24.18.1 + Chrome 152，`--version` 报的是 Node 版本。
查真实版本看 `node_modules/electron/dist/version` 文件。

**3. Electron 二进制下载**

`.npmrc` 已配置 npmmirror 镜像。注意 `npm config set electron_mirror`
在 npm 10 上会被拒绝（不是已注册的配置项），必须直接写 `.npmrc`。

若二进制未下载成功，手动补：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

## 设计文档

* `docs/ARCHITECTURE.md` — 架构设计、模块划分、9 阶段路线图
* `docs/UI-DESIGN.md` — 设计令牌、组件规范、材质系统、皮肤架构
* `docs/preview/theme-yujian.html` — 玉质主题效果预览（浏览器直接打开）

## 路线图

| 阶段 | 目标                               |
| -- | -------------------------------- |
| 0  | 工程骨架、窗口、IPC 打通 ✅                 |
| 1  | 接入 Milkdown Crepe，双模式切换，打开/保存 md |
| 2  | 笔记库文件树、自动保存、崩溃恢复                 |
| 3  | Mermaid、公式、表格、代码块                |
| 4  | 图片粘贴与图床                          |
| 5  | 全文搜索                             |
| 6  | 导出 HTML / PDF / Markdown         |
| 7  | 主题打磨、AI 能力                       |
| 8  | 打包分发                             |

