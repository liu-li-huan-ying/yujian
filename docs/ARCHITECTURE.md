# Markdown 编辑器 · 架构设计文档

> 版本：v1.0 ｜ 日期：2026-08-28 ｜ 状态：待确认
> 本文所有依赖版本均经过 `npm view` 实测可获取，环境结论来自本机实际探测。

***

## 0. 结论摘要

| 决策项   | 结论                                   | 一句话理由                                     |
| ----- | ------------------------------------ | ----------------------------------------- |
| 应用形态  | 跨平台桌面应用                              | 你选的                                       |
| 框架    | **Electron 44 + Vue 3 + TypeScript** | 本机无 MSVC，Tauri 实测编译不了                     |
| 构建工具  | **electron-vite 5 + vite 7**（不可升 8）  | electron-vite 的 peer 不支持 vite 8           |
| 编辑器内核 | **@milkdown/crepe 7.22.1**           | ProseMirror + remark 双引擎，Markdown 往返一致性最好 |
| 编辑模式  | WYSIWYG 为默认，可切源码模式                   | 你选的                                       |
| 存储    | 文件夹即笔记库，纯 `.md` + 相对路径资源             | 数据永远可读、可 Git、可迁移                          |
| 搜索    | MiniSearch（纯 JS 倒排索引）                | 零原生编译，与"无 MSVC"约束一致                       |
| v1 主攻 | 技术写作场景                               | 你选的                                       |

### 0.1 本机环境实测结果

| 检测项                | 实测值                               | 结论                                   |
| ------------------ | --------------------------------- | ------------------------------------ |
| Node               | v22.22.2                          | ✅                                    |
| npm                | 10.9.7                            | ✅                                    |
| npm registry       | `https://registry.npmmirror.com/` | ✅ 已加速                                |
| `cl.exe`（MSVC 编译器） | **未找到**                           | ❌ Tauri 不可行                          |
| VS2022 目录          | 存在但为空壳（未装任何工作负载）                  | ❌ 无 C++ 工具链                          |
| WebView2 Runtime   | **未安装**                           | ❌ Tauri 运行时也不满足                      |
| Rust               | 1.93.0                            | ⚠️ 有工具链，但链接 Windows 目标必须走 MSVC，无用武之地 |
| `electron_mirror`  | `undefined`                       | ⚠️ 需配置，否则下载 Electron 二进制走 GitHub 会很慢 |

> **关于 Tauri 的最终判断**：不是"麻烦"，是**不可行**。Tauri 在 Windows 上链接需要 `link.exe`（MSVC），且运行依赖 WebView2 Runtime，你本机两个都缺。即使愿意装，代价是 5\~8GB 的 Visual Studio C++  workloads，而你已明确表示不想装。Electron 不需要任何 C++ 工具链（官方提供预编译二进制），是当前唯一顺畅的路径。

***

## 1. 需求边界与优先级

### 1.1 已确认需求

* 跨平台桌面应用，双击即用
* **默认所见即所得**编辑，**必须能切换到源码模式**
* 场景全覆盖，但 v1 主攻**技术写作**
* 四项必备能力：文件树 + 全文搜索 / 图表与公式 / 图片粘贴 + 图床 / 导出与发布
* 存储以"文件夹即笔记库"为主体，**同时支持单个 `.md` 文件导出**

### 1.2 优先级矩阵

| 优先级    | 能力                           | 说明           |
| ------ | ---------------------------- | ------------ |
| **P0** | 打开/新建/编辑/保存 `.md`            | 没有这个其他都是空谈   |
| **P0** | WYSIWYG ⇄ 源码 双模式切换           | 你的核心诉求       |
| **P0** | 自动保存与崩溃恢复                    | 编辑器类应用的信任底线  |
| **P1** | 文件树侧边栏 + 笔记库切换               | <br />       |
| **P1** | 代码块高亮（多语言）                   | 技术写作刚需       |
| **P1** | 数学公式（KaTeX）                  | Crepe 内置     |
| **P1** | Mermaid 流程图                  | 需自研节点，见 §5.3 |
| **P1** | 增强表格编辑                       | Crepe 内置     |
| **P1** | 图片粘贴落盘                       | <br />       |
| **P1** | 导出 HTML / PDF / 单文件 Markdown | <br />       |
| **P2** | 全文搜索                         | MiniSearch   |
| **P2** | 大纲面板                         | 长文与书稿场景      |
| **P2** | 图床上传                         | 需配置化         |
| **P2** | 导出 Word                      | <br />       |
| **P3** | 双链、标签、关系图谱                   | 知识库场景        |
| **P3** | 一键发布公众号/知乎                   | 需各平台适配       |
| **P3** | 团队协作、云同步                     | 需后端，另立项目     |

### 1.3 本期明确不做

* 实时多人协作（需要 CRDT + 服务端，是另一个量级的工程）
* 移动端版本
* 插件市场机制（预留接口，但不实现生态）

***

## 2. 技术选型与理由

### 2.1 为什么编辑器内核选 Milkdown Crepe 而不是 TipTap

这是全项目最关键的一个选择，理由如下：

1. **它是 Markdown 优先的，TipTap 是 HTML 优先的。**
   TipTap 的文档模型是 ProseMirror 的 HTML 语义，转 Markdown 需要额外的序列化层（tiptap-markdown 这类三方包），容易产生语义损耗。Milkdown 底层直接跑 remark 语法树，Markdown 是它的**一等公民**，双向转换由官方维护。

2. **你要的是"源码 ⇄ WYSIWYG 自由切换"。**
   这个需求本质上要求"序列化后的 Markdown 与原始 Markdown 高度一致"，正是 Milkdown 的设计目标。

3. **技术写作所需的能力大部分已内置。**
   Crepe 内置：代码块（CodeMirror 6 驱动，多语言高亮）、LaTeX 公式（KaTeX）、表格（含行列增删与对齐）、图片块（含缩放与图注）、斜杠命令、悬浮工具栏、拖拽排序。

4. **自带 AI 能力接口。**
   Crepe 7.22 内置 `AI` Feature（默认关闭），提供指令面板 + 流式输出 + diff 审阅，可接任意 provider。这给后续加 AI 辅助写作留了低成本入口。

**代价**：Crepe 依赖 `@codemirror/language-data`（全语言包，体积约 2MB+），需在阶段 7 用按需引入裁剪。

### 2.2 依赖版本清单（已实测可获取）

```jsonc
{
  "dependencies": {
    // —— 编辑器内核 ——
    "@milkdown/crepe": "^7.22.1",      // WYSIWYG 内核（已包含 katex/remark-math/codemirror）
    "@milkdown/utils": "^7.22.1",      // replaceAll 等工具，源码模式回写用
    "@milkdown/kit": "^7.22.1",        // 自定义节点开发用

    // —— 源码模式 ——
    "codemirror": "^6.0.2",
    "@codemirror/lang-markdown": "^6.5.2",
    "@codemirror/theme-one-dark": "^6.1.3",

    // —— 渲染增强 ——
    "mermaid": "^11.17.2",
    "katex": "^0.18.4",                // 显式锁定，与 crepe 内部依赖对齐避免双版本

    // —— 搜索 ——
    "minisearch": "^7.2.0",

    // —— UI ——
    "vue": "^3.5.42",
    "pinia": "^4.0.3"
  },
  "devDependencies": {
    "electron": "^44.0.0",
    "electron-builder": "^26.15.3",
    "electron-vite": "^5.0.0",
    "vite": "~7.3.6",                  // ⚠️ 绝对不要升到 8.x
    "typescript": "^5.x",
    "@vitejs/plugin-vue": "^5.x"
  }
}
```

**主进程额外依赖**（版本待安装时确认）：`chokidar`（文件监听）、`gray-matter`（YAML frontmatter 解析）。

### 2.3 ⚠️ 两个必须规避的版本陷阱

**陷阱一：vite 版本。**
`electron-vite@5` 的 peerDependencies 是 `vite ^5.0.0 || ^6.0.0 || ^7.0.0`。而 npm 上 vite 最新已是 **8.2.2**。若按常规 `npm i vite` 装上 8.x，构建会直接报 peer 冲突失败。
→ **必须锁 `vite@~7.3.6`。**

**陷阱二：Mermaid 插件版本不同步。**
`@milkdown/plugin-diagram`（官方 Mermaid 插件）停在 **7.7.0**，而 `@milkdown/kit` 已是 **7.22.1**。混装会导致 npm 装出两份 `@milkdown/core`，运行时出现"多实例上下文"错误——这是 Milkdown 最典型的踩坑点。
→ **不使用 plugin-diagram，改为自研 Mermaid 节点**（见 §5.3）。

***

## 3. 整体架构

### 3.1 进程模型

采用 Electron 标准三进程模型，严格遵守安全隔离：

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process  (Node.js, 完全权限)                            │
│  ├─ 窗口生命周期管理                                           │
│  ├─ 文件系统读写 / 目录扫描 / 文件监听                          │
│  ├─ 原生菜单、对话框、托盘                                      │
│  ├─ 导出 PDF (webContents.printToPDF)                        │
│  ├─ 图床上传（密钥只存在这里，encrypted via safeStorage）        │
│  └─ 搜索索引持久化                                             │
└────────────────────┬────────────────────────────────────────┘
                     │  IPC（channel 白名单，类型安全）
┌────────────────────┴────────────────────────────────────────┐
│  Preload  (contextBridge)                                     │
│  只暴露受控 API，不暴露 require / ipcRenderer 原始对象            │
└────────────────────┬────────────────────────────────────────┘
                     │  window.api.*
┌────────────────────┴────────────────────────────────────────┐
│  Renderer  (Vue 3 + Chromium, 沙箱)                           │
│  ├─ Milkdown Crepe (WYSIWYG)                                 │
│  ├─ CodeMirror 6   (源码模式)                                 │
│  ├─ 文件树 / 搜索 / 大纲 / 状态栏                               │
│  └─ 主题系统                                                   │
└─────────────────────────────────────────────────────────────┘
```

**安全基线（不可妥协）**：

* `contextIsolation: true`
* `nodeIntegration: false`
* `sandbox: true`
* IPC channel 集中在 `shared/ipc-channels.ts` 常量表，preload 只挂载白名单内的方法

> 图床密钥绝不能放在渲染进程——打包后的 JS 可被轻易反编译。必须走 main 进程 + `safeStorage` 加密存储。

### 3.2 一次编辑的完整数据流

```
用户敲键盘
   │
   ▼
ProseMirror 事务 (WYSIWYG 模式)
   │
   ├─► listener.markdownUpdated(md) ──► 更新内存中的 docText，标记 dirty
   │                                        │
   │                                        ▼
   │                              防抖 800ms ──► IPC: file:write
   │                                                    │
   │                                                    ▼
   │                                        main 进程原子写入（tmp + rename）
   │                                                    │
   │                                                    ▼
   │                                              更新 MiniSearch 索引
   │
   └─► 用户按 Ctrl+/ 切换源码模式
            │
            ▼
       docText = crepe.getMarkdown()
       crepe.setReadonly(true) + 隐藏容器（不销毁实例）
            │
            ▼
       挂载 CodeMirror 6，载入 docText
            │
            ▼ (用户编辑源码后切回)
       crepe.editor.action(replaceAll(sourceText))
       crepe.setReadonly(false) + 显示容器
```

**关键设计：切换模式时不销毁 Crepe 实例。**
切换是技术写作者的高频操作，销毁重建约 100ms 且会丢失光标/滚动位置/撤销栈。改为"常驻实例 + readonly + CSS 隐藏"，切回时用 `replaceAll` 灌入源码文本。

***

## 4. 目录结构

```
markdown-editor/
├─ electron/
│  ├─ main/
│  │  ├─ index.ts                    # 应用入口、窗口创建、生命周期
│  │  ├─ menu.ts                     # 原生菜单（含中文本地化）
│  │  ├─ ipc/
│  │  │  ├─ fs.handlers.ts           # 读写、目录树、监听
│  │  │  ├─ dialog.handlers.ts       # 打开/保存对话框
│  │  │  ├─ export.handlers.ts       # PDF / HTML / MD 导出
│  │  │  ├─ image.handlers.ts        # 图片落盘、图床上传
│  │  │  └─ config.handlers.ts       # 配置与密钥（safeStorage）
│  │  └─ services/
│  │     ├─ vault.service.ts         # 笔记库扫描、chokidar 监听
│  │     ├─ search.service.ts        # MiniSearch 索引构建/增量更新
│  │     ├─ exporter/
│  │     │  ├─ html.exporter.ts
│  │     │  ├─ pdf.exporter.ts
│  │     │  └─ md.exporter.ts
│  │     └─ uploader/
│  │        ├─ index.ts              # 统一 Uploader 接口
│  │        ├─ smms.ts
│  │        ├─ qiniu.ts
│  │        └─ custom.ts             # 自定义 HTTP API
│  ├─ preload/
│  │  └─ index.ts                    # contextBridge 白名单 API
│  └─ shared/
│     ├─ ipc-channels.ts             # 通道常量表（唯一真源）
│     └─ types.ts                    # 跨进程共享类型
│
├─ src/                              # 渲染进程
│  ├─ main.ts
│  ├─ App.vue
│  ├─ editor/
│  │  ├─ EditorHost.vue              # 双模式状态机（核心）
│  │  ├─ MilkdownEditor.vue          # WYSIWYG 容器
│  │  ├─ SourceEditor.vue            # CodeMirror 源码容器
│  │  └─ features/
│  │     ├─ mermaid.node.ts          # 自研 Mermaid 节点（NodeView）
│  │     ├─ paste-image.ts           # 图片粘贴拦截
│  │     └─ fidelity.ts              # 原始文本保真（见 §5.2）
│  ├─ components/
│  │  ├─ Sidebar/
│  │  │  ├─ FileTree.vue
│  │  │  ├─ SearchPanel.vue
│  │  │  └─ Outline.vue
│  │  ├─ TitleBar.vue
│  │  └─ StatusBar.vue
│  ├─ stores/
│  │  ├─ vault.ts
│  │  ├─ editor.ts
│  │  └─ settings.ts
│  └─ styles/
│
├─ resources/                        # 图标、导出模板 CSS
├─ electron.vite.config.ts
├─ package.json
└─ tsconfig.json
```

***

## 5. 核心模块设计

### 5.1 Vault（笔记库）模型

一个 Vault 就是一个普通文件夹，结构如下：

```
我的笔记库/
├─ .mdeditor/                 # 应用私有目录（可安全删除，会自动重建）
│  ├─ config.json             # 该库的配置
│  ├─ search-index.json       # MiniSearch 索引快照
│  └─ .history/               # 文件历史快照（可选）
├─ .assets/                   # 图片等资源（统一存放）
│  └─ 2026/08/                # 按月份归档，避免单目录文件过多
├─ 技术笔记/
│  └─ electron-架构.md
└─ 随笔/
   └─ 读书记.md
```

**设计原则：**

* 文档一律是标准 `.md`，YAML frontmatter 存元数据（title/tags/created/updated）
* 资源引用使用**相对路径**（`./.assets/xxx.png`），保证整库可迁移、可 Git、可用其他工具打开
* `.mdeditor/` 只是缓存，删掉不影响任何笔记内容

**切换笔记库（不重启应用）**：标题栏「切换工作文件夹」与侧栏「打开笔记库」共用同一入口
（`dialog:openDir` 选目录）。切换时主进程 `vault.ts` 的 `watchVault` 是单例（内部先
`stopWatching()`），新库监听会自动顶替旧库，不会泄漏 watcher。渲染层在切换前先保存当前文档的
未保存改动（`host.save()`），再把 `filePath` / `pendingPath` 置空并调用 `EditorHost.clear()`
（保真层回空 + Milkdown `setMarkdown('')`，源码面板随 `modelValue` 绑定自动清空），最后
`useVault(root)` 重建文件树。旧文档路径不会被继续写入——`scheduleSave` 在 `filePath` 为空时直接
短路。切换后界面回到空白，由用户从新库选择文档。

### 5.2 ⚠️ Markdown 往返失真 —— 本项目第一号风险

**问题**：Milkdown 通过 remark 序列化，会把用户手写的 Markdown 规范化。典型表现：

| 你写的              | 保存后变成         |
| ---------------- | ------------- |
| `*斜体*`           | `_斜体_`        |
| `- 列表项`          | `* 列表项`       |
| Setext 标题（`===`） | ATX 标题（`###`） |
| 手排对齐的表格          | 按内容宽度重新对齐     |
| 内联 HTML          | 可能被转义         |

对会把 md 推到 GitHub / Hugo / VitePress 的技术写作者来说，**这是不可接受的**——每次打开再保存都会产生一大片无意义的 Git diff。

**应对方案：原始文本保真模式（`features/fidelity.ts`）**

```
磁盘读取 ──► rawText（原文，一字不改）
              │
              ├──【用户未在 WYSIWYG 中编辑】──► 保存时直接写回 rawText（零改写）
              │
              └──【用户在 WYSIWYG 中编辑过】──► dirty = true
                                                  │
                                                  ▼
                                        保存 docText（已规范化）
                                                  │
                                                  ▼
                                        状态栏提示"本次保存已规范化排版"
```

* 状态机维护三个字段：`rawText`（磁盘原文）、`docText`（Crepe 序列化结果）、`isDirty`
* 只在 WYSIWYG 模式下产生编辑事务时才置 `isDirty`
* 源码模式编辑后保存，**永远走原文路径**，不经过序列化
* 提供设置项："保存时总是规范化排版"（默认关）

### 5.3 Mermaid 图表方案（代码块预览钩子）

> **实现时改了方案**：原计划自研 NodeView，实际改用 Crepe 代码块自带的
> `renderPreview` 钩子。理由见文末 —— 核心是**对文档结构零侵入**。

官方插件版本不兼容（见 §2.3 陷阱二），因此不使用 `@milkdown/plugin-diagram`。
改为接管 Crepe 代码块的**预览区**：

1. 文档里就是一个普通的 mermaid 代码块，schema 与序列化完全不动
2. 通过 `featureConfigs[Crepe.Feature.CodeMirror].renderPreview` 接管：
   * `language !== 'mermaid'` → 返回 `null`，保持无预览
   * 命中 mermaid → 返回 `undefined` 进入异步模式，渲染完成后 `applyPreview(svg)`
3. 稳定性：400ms 防抖、自增令牌丢弃过期结果、语法错误渲染成人话提示而非抛异常
4. mermaid 用动态 `import()` 懒加载（含 cynefin / cytoscape 依赖约 3.3MB），
   不进主包，只有真正遇到图表才拉取
5. 安全：`securityLevel: 'strict'`，预览内容最终由组件内 `sanitizeSvg`（DOMPurify）兜底
6. 渲染在渲染进程完成，导出 HTML 时 SVG 已在 DOM 中，天然支持离线导出

**为什么不用自研 NodeView（原方案）**：NodeView 要接管 `code_block` 渲染，
就必须处理与 Crepe 内置 CodeMirror NodeView 的冲突；一旦动到 schema，
就会威胁「Markdown 往返保真」这条红线。而 `renderPreview` 契约天然提供了
同样的产品目标（代码 ⇄ 图表切换由组件自带预览开关提供），对文档零侵入，
风险低一个数量级。

**为什么不用 plugin-diagram**：版本停在 7.7.0，与 kit 7.22.1 混装会触发 Milkdown 的多实例上下文错误。

### 5.4 图片与图床

**粘贴流程：**

```
Ctrl+V / 拖拽图片
   │
   ▼
ProseMirror handlePaste 拦截
   │
   ▼
IPC: image:save  ──► main 进程写入 vault/.assets/YYYY/MM/<ts>-<hash>.png
   │                  计算相对路径返回
   ▼
插入 ![](./.assets/2026/08/xxx.png)
```

**图床设计：**

* 统一 `Uploader` 接口：`{ name, upload(buffer, filename): Promise<string> }`
* 内置实现：SM.MS、七牛云、自定义 HTTP API（预留阿里云 OSS / GitHub）
* 上传动作在 **main 进程**执行，规避浏览器 CORS 与密钥泄露
* 维护 `srcMap: 本地相对路径 → 远程 URL`，导出时可一键批量替换为图床链接（公众号等平台必须）

### 5.5 搜索（MiniSearch）

* 索引字段：`title`（权重 3）、`content`（权重 1）、`path`、`tags`
* 持久化：`vault/.mdeditor/search-index.json`，用 `MiniSearch.toJSON()` 序列化
* 增量更新：chokidar 捕获文件变更 → 只重建该条
* 冷启动全量构建：1000 个文件约 1-2 秒，放 main 进程避免卡 UI
* 支持中文分词（MiniSearch 对 CJK 需配置 `tokenize` 为按字切分）

> **为什么不用 SQLite**：`better-sqlite3` 需要 node-gyp 编译 → 需要 MSVC → 与你本机的约束直接冲突。MiniSearch 是纯 JS，零编译依赖。

### 5.6 导出

| 格式           | 方案                             | 说明                                    |
| ------------ | ------------------------------ | ------------------------------------- |
| **HTML**     | 克隆 ProseMirror DOM + 独立 CSS 模板 | **所见即所得导出**——你在编辑器里看到什么，导出的就是什么       |
| **PDF**      | `webContents.printToPDF()`     | Electron 原生能力，无需额外依赖，支持页眉页脚与分页控制      |
| **Markdown** | 单文件导出                          | 支持"内联图片为 base64"或"附带 .assets 文件夹"两种模式 |
| **Word**     | HTML → docx（阶段 6，可选）           | <br />                                |

**HTML 导出的优雅之处**：WYSIWYG 模式下，ProseMirror 的 DOM 已经是渲染后的结果——Mermaid 已变成 SVG、KaTeX 已变成 MathML、代码块已带高亮 span。直接 `cloneNode(true)` 套上模板 CSS 即可，**不需要再跑一遍 Markdown 渲染管线**，从根源上杜绝"编辑器里好看，导出后变形"的问题。

需额外处理：KaTeX 字体与代码块高亮 CSS 要内联进导出文件，保证单文件离线可用。

### 5.7 主题系统

* 基于 CSS Variables，一套变量表驱动全应用
* Crepe 官方自带 6 套主题（frame / crepe / nord × light / dark），可直接复用
* 编辑器内容区样式与导出模板共用同一套 CSS，保证一致性
* 跟随系统深色模式

### 5.8 启动偏好（Startup preference）

用户可决定每次打开应用时看到什么，配置项位于标题栏「偏好设置」：

| 选项         | 值         | 行为                                |
| ---------- | --------- | --------------------------------- |
| 恢复上次会话（默认） | `restore` | 启动即重新打开上次使用的笔记库与文档，回到上次退出时的状态     |
| 每次启动显示全新页面 | `fresh`   | 启动不恢复任何笔记库/文档，打开即是空白，从「选择一个文件夹」开始 |

**持久化**：`startupMode` 与 `vaultPath` / `activePath` / `mode` / `sidebarWidth` 一起存放在
主进程 `userData/session.json`（复用既有的 `session.ts` 原子写与 `patchSession` 通道，
不新增 IPC）。应用启动时读取 `SessionState.startupMode`：为 `fresh` 时只恢复窗口级偏好
（`sidebarWidth`、编辑器模式），跳过 `vaultPath` / `activePath` 的恢复；为 `restore`（或
历史文件缺失/损坏）时按原有逻辑恢复整个会话。无论哪种模式，切换/打开笔记库时仍会把
`vaultPath` 写回 session，便于之后切回 `restore` 能恢复到最近使用的库。

### 5.9 Phase 2 批次一：多文档标签与文件内查找（2026-08-29）

**多文档标签（守单实例红线）**

* 新增 `src/store/tabs.ts`（Pinia）管理「打开路径集合 + 激活路径」，store **不持有任何文档内容**。
* `App.vue` 的 `filePath` 改为派生自 `tabs.activePath`；切换标签 = 先 `host.save()` 落盘脏数据，再改 `activePath`，由 `EditorHost` 单实例 `load(newPath)` —— 永远是「单实例换内容」，绝不每标签建实例。
* 会话白名单 `SessionState` 新增 `openTabs?: string[]`（`electron/shared/ipc-channels.ts` + `session.ts` sanitize），启动 `restore(openTabs, activePath)` 恢复全部标签。

**文件内查找 / 替换（与「全部」共用同一套引擎，零冗余，2026-08-30）**

* **2026-08-30 重构**：原先「本文档」走的是独立的编辑器内查找引擎（`src/editor/find-source.ts` 的 CodeMirror 高亮、`src/editor/find-wysiwyg.ts` 的 ProseMirror 装饰、`src/editor/docFindApi.ts` 的 `DocFindApi` 契约、以及 `EditorHost` 的 `find/findNext/findPrev/replaceOne/replaceAll/clearFind` 暴露），已于本日整体删除，连同 `editor.css` 的 `.cm-find` / `.pm-find` 样式。原因：单文档查找与文件夹全文搜索本质是同一种「在文本中找匹配、返回命中行」操作，**仅范围不同**，分两套实现是代码冗余。
* **统一方案**：主进程 `electron/main/vault.ts` 的 `searchVault(root, query, opts?, file?)` 与 `replaceInVault(root, query, replacement, opts?, file?)` 各加一个可选 `file` 参数——
  * 传 `file`：只对这一单个文件查找（不递归），即「本文档」范围；
  * 不传 `file`：对整个 vault 递归，即「全部」范围。
  后端其余逻辑（按行切分命中、替换回写、原子写）两范围完全共用。IPC 通道 `VAULT_SEARCH` / `VAULT_REPLACE` 与 preload 的 `searchVault / replaceInVault` 签名同步透传 `file`。
* **前端 `Sidebar`**：只保留一个搜索框 + 一个 `SearchResults` 渲染器 + 一个替换面板。`scopeFile()` 在「本文档」范围返回 `props.activePath`、在「全部」返回 `undefined`，作为第 4/5 实参传入 `searchVault / replaceInVault`；命中结果一律**点击跳转**（复用既有 `onOpenResult(path, line)` → `EditorHost.revealLine`），不再有 ‹ › 逐个步进。结果元信息用 `SearchResults` 的 `singleFile` 属性区分：`本文档` 显示「N 处命中」，`全部` 显示「N 处命中 · M 个文件」。
* **取舍**：放弃了编辑器内逐命中常驻高亮 + ‹ › 步进（即用户最初觉得「所见即所得下只是跳转不够直观」那部分体验），换来零代码冗余与两种范围完全一致的交互。命中定位仍可靠（点击命中行即跳到源码模式对应行并精确滚动）。

### 5.10 Phase 2 批次二：版本快照 + 写作统计 + 凝神模式（2026-08-29）

**版本快照（本地唯一真源，与 `.mdeditor/` 分离）**

* 存储：main 进程在 vault 根建 `.yujian-history/<path-hash>/<ISO8601>.md`（独立于 `.mdeditor/`，建议进 vault `.gitignore`）。`electron/main/snapshots.ts` 提供 `snapshotList` / `snapshotCreate`（写一份，可带备注）/ `snapshotRestore`（**只读返回内容**，不写磁盘）/ `snapshotDelete`。
* ⚠️ **时区修复（2026-08-30）**：原 `nowIso()` 用 `toISOString()` 取的是 **UTC** 墙钟，而 `isoToDate()` 把该数字当**本地**时间解析，导致东八区用户存的快照被整差 8 小时。已改为取 `Date` 的本地时区 `getFullYear/getMonth/.../getSeconds` 生成文件名，与解析端一致；渲染端 `SnapshotPanel` 时间戳经 `src/utils/time.ts` 的 `formatDateTime`（同样走本机时区），并加「本机时区：{IANA}」tooltip（`Intl.DateTimeFormat().resolvedOptions().timeZone` 自动取电脑时区，无需硬编码东八区）。**注意**：此前（bug 期）已落盘的快照文件名仍是 UTC 数字，读回会偏 8 小时；新快照已正确，旧快照可在 `.yujian-history/` 手动清理。
* IPC：通道 `snapshot:list` / `snapshot:create` / `snapshot:restore` / `snapshot:delete` 在 `electron/shared/ipc-channels.ts` 集中定义；preload 暴露 `window.api.snapshotList/Create/Restore/Delete`（类型自动派生）。
* 前端：`src/store/snapshots.ts`（Pinia，**只缓存当前文档的快照列表，不持有内容**）；玻璃 `SnapshotPanel.vue`（锚定 `.editor` 右上）：备注输入 + 保存、列表（时间 + 备注 + 字数差 `deltaChars`）、选中→`snapshotRestore` 只读返回→`diffLines`（`diff@^7.0.0`）摊平逐行 add/del/ctx 预览、右下恢复/删除 + 右键 `ContextMenu`（restore/delete danger）、空态文案。恢复走 `EditorHost.loadMarkdownExternal`（灌入 + 标 dirty + 自动保存），**不立即覆盖磁盘原文**（守 §5.2 保真红线）。
* 行级 diff 库选型修正：原计划写 `jsdiff`，但 `jsdiff@1.1.1` 实为「JSON 对象 diff」库（装配错误）；正确库是 `diff@^7.0.0`（`diffLines`），已在 `package.json` 落地，`jsdiff` 已卸载；无类型的 `diff@7` 在 `src/types/diff.d.ts` 补了环境声明。
* 自动快照策略（防抖保存 + 定时）已留接口；批次二先落地「手动留档 + 行级 diff 预览 + 回滚」闭环，自动策略在后续打磨中接入同一 `snapshotCreate`。
* ⚠️ **状态：实现但未测试（implemented but NOT yet tested）**：快照逻辑（主进程 `.yujian-history/` 存储 + `snapshot:*` 通道 + 行级 diff 预览 + 回滚标脏不覆盖磁盘）已完整落地，但**尚未在运行期人工验证**（存/看 diff/恢复/删除的实际交互与边界：大文档、空文档、并发、断电均未体验）。暂不提供体验入口，待后续专项审查补运行期测试与验收标准；前端 `SnapshotPanel.vue` 顶部已加统一「⚠ 实现但未测试」标注。

**写作统计（纯函数，零依赖）**

* `src/utils/text-stats.ts`：`computeStats(text)` 输出 `han`(CJK 字数) / `words`(英文词) / `chars`(含空白) / `charsNoSpace` / `readingMinutes`（中文 \~300 字/分 + 英文 \~200 词/分混合估算）。
* 状态栏紧凑读数 `{{han}}{{U.unitHan}} · {{words}}{{U.unitWord}} · {{readingMinutes}}{{U.unitMin}}`（`U` 为 i18n 单位：`unitHan='字'/'chars'`、`unitWord='词'/'words'`、`unitMin='′'/'min'`，随中/英语言切换）；点击唤起玻璃 `StatsPopover.vue`（其阅读时长单位 `L.unitMin` 同样随语言）。

**凝神模式 = 打字机 + 禅 融合（零新增依赖）**

* 用户决策：两体验融合为典雅的「**凝神**」模式（图标 `moon`，英文 `Focus`），标题栏一个开关统一控制。
* 所见即所得：`src/editor/zen.ts` 用 ProseMirror **node Decoration**（`$prose(() => createZenPlugin())` 注册）——当前光标块加 `.zen-active`、其余块加 `.zen-dim`（opacity .26 + 降饱和）；CSS 做不到「按光标给除当前块外所有块加类」，故必须走 Decoration（非破坏性，不标 dirty）。当前行 `behavior:'smooth'` 垂直居中（偏上 1/3），rAF 节流、失焦暂停。
* 源码模式：`SourceEditor` 用 `EditorView.scrollIntoView` 居中（同源 `isZenActive()` 模块级开关）；居中在两种模式都跑，淡化仅在 WYSIWYG 生效。
* **开关机制（修复「凝神无效」根因）**：装饰状态改由 `PluginKey<ZenValue>` 持有，`setZen` 经 `view.dispatch(tr.setMeta(zenKey, value))` 切换——**meta 事务必定触发** `apply` 重建装饰。早期版本用模块级标志 + 空事务 `dispatch(v.state.tr)`，空事务在视图派发链中常被当作「无变化」跳过，导致装饰不重算、淡化/高亮不出现（即「凝神无效」现象）；改 meta 后稳定生效。模块级 `zenState.active` 仍保留供源码模式 `isZenActive()` 与 plugin `view.update` 读取。
* 持久化：`SessionState` 新增 `focusMode?: boolean`，随会话恢复（`App.onMounted` 读 `focusMode` → 为真则 `setZen(true)`）；切 tab / 切模式前暂停居中，与 `captureScroll/restoreScroll`、多标签互不打架。

**全局替换（左侧文件树搜索增强，打磨项）**

* 左侧 `Sidebar.vue` 搜索框在「有搜索命中」时展开一个玉质 `.repl` 区块：开关 `.repl__toggle`（复用 `t.ui.replace`）→ 输入替换串 → 确认框展示「将替换全部 {n} 处」→ 执行。
* 范围限定为**当前搜索命中的文件**：`window.api.replaceInVault(root, query, replacement, { caseSensitive, wholeWord })`（匹配选项与搜索一致，贯穿大小写 / 全词），仅对命中文件做字面量替换并写回磁盘；返回 `{replaced, files, paths}`，前端 toast 反馈并刷新搜索；若当前编辑文档在 `paths` 中则自动从磁盘重载。
* IPC：新增通道 `vault:replace`（`ReplaceResult` 接口），main 侧 `replaceInVault` 复用 `searchVault` 取命中文件、正则转义后替换、仅内容变化时写回；`electron/shared/ipc-channels.ts` 集中定义，preload 暴露 `window.api.replaceInVault`。

### 5.11 凝神 2.0：雾与纸（2026-08-29，设计稿 docs/FOCUS-MODE-2.0-DESIGN.md）

**进退场（`src/styles/zen.css`，App 根节点 `.shell[data-zen]` 驱动，JS 只挂/摘属性）**

* 四幕进场 ~360ms：① 侧栏/大纲宽→0+淡出（0–100ms，复用 `is-collapsed`，App 传 `visible && !focusMode`）② 标题栏 `.bar`/标签条 `.tabbar`/状态栏 `.statusbar` 高→0（80–200ms）③ 正文列 `--w-column` 720→640（180–300ms，`@property` 注册长度变量使全部块联动、一次样式重算）④ `.editor::before/::after` 上下 48px 羽化遮罩 + 装饰淡入（280ms 起）。
* 退场 240ms 三幕反向（`:not([data-zen])` 基态规则承载退场时序——transition 取目标态规则，进退场各自独立时序）。`prefers-reduced-motion` 全部降为 0ms 直接切换。

**雾化五档（`src/editor/zen.ts` + `editor.css`）**

* `buildDecorations` 按**文本块距**生成 `.zen-active` / `.zen-dim-1..5`：按文档序遍历**全部文本块**（含列表项 / 引用 / 表格单元格内的嵌套文本块，距离 = 与当前文本块之间隔了几个文本块），类只挂文本块与顶层叶块（图 / 分割线 / mermaid 按「其前的文本块数」计距）——长列表 / 长表格内部逐块淡出，容器本身不挂类，无透明度复合叠加；容器视觉元素（表格网格 / 引用竖线 / 列表圆点）保持满透明度（结构保留、文字退后）。档位由根节点 `--fog-1..5` CSS 变量承载（快 `[.45,.28,.2,.17,.16]` / 中 `[.55,.38,.28,.22,.18]` / 慢 `[.66,.5,.4,.32,.26]`），换档只改变量。只用 opacity（拒绝逐块 blur）；当前文本块青瓷微光底衬替代被否决的「光标闪烁频率」。

**纸卷滚动（lerp）**

* `centerZenLine` 改为 rAF lerp 追随：只在「脏」（选区/文档变化，plugin `view.update` 判定）时拉锚，收敛即停——滚轮浏览不被抢滚动条；单帧限幅 120px（粘贴大段匀速补偿、缓出刹住）；开启凝神后延迟 320ms 再拉锚，避开布局动画。锚点/平滑度参数来自偏好。

**轻退栏 + 设置面板 + 偏好**

* `ZenRetreatBar.vue`：32px 玻璃胶囊（`position:fixed` 不占布局），文件名 · 字数 · 相对保存时间（30s 自刷新）｜⚙ 设置 / 切换文档（复用标签激活）/ 退出凝神。Esc 状态机在 `App.onKeydown`（设置面板优先、轻退栏可关）。
* `ZenSettings.vue`：玻璃模态，锚点（1/3·黄金分割·正中）/ 雾化（快中慢）/ 滚动（跟手·平滑·极平滑）/ 自动全屏 / 轻退栏，改即生效并 `patchSession({ zenPrefs })`。`SessionState.zenPrefs` 经 `session.ts sanitizeZenPrefs` 逐字段校验。设置入口：轻退栏 ⚙ + 标题栏「更多」菜单（`zen-settings`）。
* 凝神下源码模式居中列：`.shell[data-zen] .source-host .cm-scroller` 对称内边距 `max(0, 50% − var(--w-column-zen)/2)`，行号 + 代码整体收进 640px 居中列（行号随列移动），修复 CodeMirror 宽窗整屏贴左。
* 自动全屏走新 IPC `win:setFullscreen`（preload `window.api.setFullscreen`）；只还原自己转的全屏（`zenAutoFullscreen` 标记），不碰用户手动 F11。

### 5.12 链接健康检查（2026-08-30，Phase 2 批次三 §3.7）

**扫描（`electron/main/vault.ts` 的 `checkLinks(root)`，新增 IPC `vault:checkLinks` → preload `window.api.checkLinks`）**

* 两遍遍历：第一遍收集全部 Markdown 文档，建立「基名（去扩展名，小写）」与「相对库根路径（去扩展名，小写）」索引；第二遍逐文件逐行抽取链接并解析判定。遍历规则与 `listTree` / `searchVault` 一致（跳过点目录 / node\_modules / 同名 `.assets`），不引入任何新依赖。
* 识别三类链接：① `[[wikilink]]`（兼容 `[[X|别名]]`、`[[X#标题]]`，按基名或相对路径解析）；② Markdown 链接 `[text](target)`（相对当前文档目录解析后判定目标文件是否存在）；③ 图片 `![alt](target)`（同上检查图片是否存在）。
* 跳过不计入断链：外部链接（http(s) / mailto / tel / data / ftp、协议相对 `//`、`www.` 域名）、纯锚点（`#标题`）。断链条目上限 2000 提前返回，防大库爆内存。
* `BrokenLinkReport { scanned, total, items[] }`，`BrokenLinkItem { file, line, raw, target, kind, context }`（新增 `context`：断链所在行的原文，便于面板内预览）；`kind: 'wikilink' | 'mdlink' | 'image'`。

**报告面板（`src/components/LinkCheckPanel.vue`，玻璃浮层，入口：标题栏「更多 ⌄ · 链接健康检查」）**

* 挂载即扫描（加载态带旋转图标 → 汇总「扫描 N 篇、发现 M 处」+ 按类型拆分计数「Wiki a · 链接 b · 图片 c」→ 列表）；可「重新扫描」；`Esc` 关闭。
* 顶部「全部 / Wiki / 链接 / 图片」类型筛选（带各类型计数，零项禁用）；每行按 kind 三色徽标（Wiki / 链接 / 图片）+ 源文件基名 + 行号 + 目标（等宽）+ **所在行原文预览**（左侧竖线缩进，等宽、截断），hover 标题显示原始链接、所在行与「定位到 N 行」。
* 点击行 → `App.onOpenBrokenLink(item)`：经 `openPath` 打开文档（已是当前文档则跳过）→ 切源码模式（行级定位只在源码精确）→ `revealLine(line)` 滚动到断链行；与全文搜索结果定位同一套逻辑。零断链显示「未发现断链 ✓」（绿色对勾）。

### 5.13 写作辅助（2026-08-30，Phase 2 批次三 §3.6）

**frontmatter 解析 / 回写（`src/editor/frontmatter.ts`，复用已依赖的 `gray-matter`，零新增依赖）**

* `parseFrontmatter(text)`：用 `gray-matter` 分离 YAML 元数据与正文，正文 `content` 一字不改返回；同时用正则判定原文档是否以合法 `---` 开头（`hasFrontmatter`）。
* `serializeFrontmatter(data, content)`：只对顶部 `---` 块做增删改，正文原样接回。未知字段（用户手写的其他 key）经 `data` 透传、由 gray-matter 内置 js-yaml 原样保留；若全部字段清空则直接去掉 frontmatter 块返回纯正文。严守 Markdown 往返保真红线。

**插入路径（`EditorHost.insertText` + `SourceEditor.insertAtCursor`）**

* 所见即所得：用 ProseMirror 视图 `tr.insertText(text, from, to)` 在光标处插入（替换选区），触发 `markdownUpdated` → 自动落盘。
* 源码：CodeMirror `dispatch` 在 `selection.head` 处插入并移动光标。两种模式都不切换、不影响保真层之外状态。

**面板（`src/components/WritingAidsPanel.vue`，玻璃浮层，入口：标题栏「更多 ⌄ · 写作辅助」）**

* 两个标签页：**属性** —— frontmatter 表单（标题 / 作者 / 描述 / 标签[逗号或空格分隔] / 日期），挂载时从 `App` 传入的当前文档全文解析填充；「应用」经 `App.onApplyFrontmatter` → `host.loadMarkdownExternal(newText)` 改写并自动保存，正文逐字保留。**片段** —— 内置 8 类常用模板（文档模板 / 代码块 / 表格 / 提示框 / 任务列表 / 脚注 / 流程图 / 公式块），点击经 `App.onInsertSnippet` → `host.insertText` 在光标处插入。
* 面板打开时快照一次当前文档全文（`host.getMarkdown()`），`canEdit` 由是否打开文档决定；无文档时仅提示。i18n 文案集中在 `ui.writingAids`，中英文 key 一一对应。

***

## 6. 技术写作场景专项设计

| 能力          | 实现                                   | 阶段 |
| ----------- | ------------------------------------ | -- |
| 代码块多语言高亮    | Crepe 内置 CodeMirror，语言按需引入裁剪体积       | P1 |
| 数学公式        | Crepe 内置 KaTeX，行内 + 块级               | P1 |
| Mermaid 流程图 | 代码块 renderPreview 钩子（§5.3）           | P1 |
| 表格增强        | Crepe 内置，行列拖拽 + 对齐设置                 | P1 |
| 大纲面板        | 从 ProseMirror doc 提取 heading 层级，滚动联动 | P2 |
| 字数/阅读时间统计   | 状态栏实时显示，中英文分别计数                      | P2 |
| 专注模式        | 当前段落高亮，其余淡出                          | P3 |
| 复制为富文本      | 复制到公众号/知乎时保留样式                       | P3 |

***

## 7. 关键接口定义

```ts
// shared/types.ts —— 跨进程共享

export type EditorMode = 'wysiwyg' | 'source'

export interface VaultConfig {
  version: number
  name: string
  createdAt: number
}

export interface DocMeta {
  path: string          // 相对 vault 的路径
  title: string
  tags: string[]
  createdAt: number
  updatedAt: number
  wordCount: number
}

export interface FidelityState {
  rawText: string       // 磁盘原文
  docText: string       // 编辑器序列化结果
  isDirty: boolean      // 是否在 WYSIWYG 中编辑过
}

export interface Uploader {
  name: string
  upload(buffer: Buffer, filename: string): Promise<string>
}

export type ExportFormat = 'html' | 'pdf' | 'md' | 'docx'

export type StartupMode = 'restore' | 'fresh'

export interface SessionState {
  vaultPath: string | null    // 当前笔记库根目录
  activePath: string | null   // 当前编辑的文档绝对路径
  mode: EditorMode            // 编辑器模式
  sidebarWidth: number        // 侧栏宽度（px）
  startupMode: StartupMode    // 启动偏好：恢复上次会话 / 全新页面
  openTabs?: string[]         // 多标签：当前打开的文档绝对路径列表（Phase 2 批次一）
  focusMode?: boolean         // 凝神模式（打字机+禅融合）开关（Phase 2 批次二）
  writingGoal?: number        // 写作目标（字数），0 = 未设（Phase 2 批次二）
}
```

***

## 8. 开发路线图

| 阶段             | 目标                                              | 产出验收标准                                                                               |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| **0. 地基**      | 脚手架 + 窗口 + IPC 打通                               | `npm run dev` 能弹出一个空白 Electron 窗口                                                    |
| **1. 编辑器核心**   | Crepe 接入 + 双模式切换 + 打开/保存 md                     | 能打开一个 md 编辑并保存，Ctrl+/ 切换源码无内容丢失                                                      |
| **2. 笔记库**     | 文件树 + 自动保存 + 崩溃恢复                               | 能打开整个文件夹，断电重启后内容不丢                                                                   |
| **3. 写作套件**    | Mermaid + 公式核验 + 表格 + 代码块                       | 一篇含图表的文章能正常编辑渲染                                                                      |
| **4. 图片**      | 粘贴落盘 + 图床配置                                     | 截图粘贴即可插入，图床可配                                                                        |
| **5. 搜索**      | MiniSearch 索引 + 搜索面板                            | 千篇笔记下搜索响应 < 100ms                                                                    |
| **6. 导出**      | HTML / PDF / 单 md                               | 导出结果与编辑器内观感一致                                                                        |
| **7. 打磨**      | 主题、体积裁剪、快捷键、设置面板                                | 安装包体积优化，可用                                                                           |
| **8. 分发**      | electron-builder 打包                             | 产出 Windows 安装包，可安装运行                                                                 |
| **9. Phase 2** | 多文档标签+查找替换+版本快照+写作统计+凝神(打字机/禅)模式+导出增强+写作辅助+断链检查 | 🔧 批次一已落地（多文档标签·文件内查找替换·选区字数）；批次二已落地（版本快照·写作统计·凝神模式）；批次三待排期（见 `docs/PHASE2-PLAN.md`） |

> 建议：**先只做阶段 0\~1**，跑通"打开→编辑→保存→切源码"这条最小闭环再继续。编辑器项目的复杂度集中在后段，早验证能省大量返工。

***

## 9. 已知风险与应对

| # | 风险                              | 影响 | 应对                                                              |
| - | ------------------------------- | -- | --------------------------------------------------------------- |
| 1 | **Markdown 往返失真**               | 高  | 原始文本保真模式（§5.2），未编辑则一字不改写回                                       |
| 2 | **Milkdown 多实例上下文错误**           | 高  | 全项目只用 `@milkdown/crepe` 单包，不混装低版本插件                             |
| 3 | **Electron 二进制下载慢/失败**          | 中  | 配置 `electron_mirror` + `electron-builder-binaries` 指向 npmmirror |
| 4 | **Crepe 体积偏大**                  | 中  | 阶段 7 裁剪 `@codemirror/language-data`，按需引入语言包                     |
| 5 | **KaTeX 字体导出丢失**                | 中  | 导出 HTML 时内联字体或使用本地字体文件                                          |
| 6 | **electron-builder 打包需下载 NSIS** | 低  | 同风险 3，配镜像解决                                                     |
| 7 | pinia 4 与 Vue 3.5 的 peer 兼容性    | 低  | 安装时若报冲突，降级到 `pinia@^2`                                          |

***

## 10. 需要你拍板的遗留问题

这几个问题会影响后续实现细节，请确认（也可以先按我的默认建议走）：

1. **图片存放位置**：统一放 `vault/.assets/`（推荐，迁移方便）还是与 `.md` 同级目录（单文件分发方便）？
2. **自动保存策略**：防抖多少毫秒？我建议 800ms，另外是否需要保留 `.bak` 备份文件？
3. **源码模式切换时是否自动格式化**？我建议**不格式化**，保持你的原始排版。
4. **是否需要多标签页**（像浏览器一样同时开多篇）？这会增加状态管理复杂度，建议 v1 先单文档窗口。
5. **图床优先级**：v1 先只做本地存储、预留图床接口，还是直接接一个图床（比如 SM.MS）？
6. **AI 辅助写作**：Crepe 已内置 AI Feature 接口（需自备 API Key），要不要纳入路线图？放在哪个阶段？

***

## 附录 A：开工前必做的环境配置

```bash
# 1. 配置 Electron 二进制镜像（否则下载极慢）
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron-builder-binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/

# 2. 验证版本锁定正确
npm view vite version        # 应为 7.3.x，不是 8.x
npm view @milkdown/crepe version   # 应为 7.22.1
```

