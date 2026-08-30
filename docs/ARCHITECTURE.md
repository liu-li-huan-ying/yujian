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
| **P1** | 数学公式（MathJax）                | Crepe 提供节点，渲染层自研见 §5.3.2 |
| **P1** | Mermaid 流程图                  | 代码块预览钩子，见 §5.3 |
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
   Crepe 内置：代码块（CodeMirror 6 驱动，多语言高亮）、LaTeX 公式（提供 `math_inline` / `latex` 代码块节点与 remark-math 解析，**渲染层已自研替换为 MathJax**，见 §5.3.2）、表格（含行列增删与对齐）、图片块（含缩放与图注）、斜杠命令、悬浮工具栏、拖拽排序。

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
                                       // 注：显示层已改用 MathJax，katex 现仅供
                                       // markdownToHtml（合订导出）的 DOMSerializer 路径使用
    "mathjax-full": "^3.2.2",          // 数学显示引擎（AllPackages + mhchem，支持 \ce/\require/\eqref）
    "markdown-it-emoji": "^3.1.0",     // 仅复用其全量 emoji 短代码词典（name → emoji）

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

#### 5.3.1 编辑区默认显示图表（2026-08-30）

默认（`previewOnlyByDefault` 缺省 = 只读态）下代码块是「CodeMirror 编辑器 + 下方预览区」并存，
图表要往下找才看得到。改为**预览优先**：

* `featureConfigs[Crepe.Feature.CodeMirror].previewOnlyByDefault = true`
* 该开关是**全局布尔**，不能直接对所有代码块生效（否则普通代码默认变成只读预览）。
  实际靠 `renderPreview` 的返回值天然分流：
  * 非 mermaid / 非 latex → 返回 `null` → 预览面板不渲染，`codemirror-host` 也就不加 `hidden`
    → **普通代码块行为完全不变**（照样是可编辑的高亮代码）
  * mermaid / latex → 返回 SVG → 预览面板渲染且 `codemirror-host` 加 `hidden`
    → **默认直接看到图表 / 公式**，点预览区右上角的 Edit 仍可切回编辑源码
* 结论：用一个全局开关 + 按语言分流的 renderPreview，实现"仅图表类代码块默认预览"，
  零 schema 改动、零副作用。

**为什么不用自研 NodeView（原方案）**：NodeView 要接管 `code_block` 渲染，
就必须处理与 Crepe 内置 CodeMirror NodeView 的冲突；一旦动到 schema，
就会威胁「Markdown 往返保真」这条红线。而 `renderPreview` 契约天然提供了
同样的产品目标（代码 ⇄ 图表切换由组件自带预览开关提供），对文档零侵入，
风险低一个数量级。

**多图并存修复（2026-08-30）**：早期实现用模块级共享的 `timer` / `token`，多个 mermaid 图块
同时存在时，新图的渲染会 `clearTimeout` 掉旧图的定时器、且旧图的结果令牌被判失效被丢弃，
于是「只有最后渲染的那张图能出来，其余都消失」——即用户反馈的『多个图放在一起渲染能力很弱』。
改为用 `WeakMap` 以每个代码块的 `applyPreview` 闭包为键，给每个图维护**独立的**防抖定时器与
结果令牌（`src/editor/features/mermaid.ts`），任意数量的图都能各自独立、正确渲染。

**为什么不用 plugin-diagram**：版本停在 7.7.0，与 kit 7.22.1 混装会触发 Milkdown 的多实例上下文错误。

### 5.3.2 数学渲染：MathJax 替换 KaTeX（2026-08-30）

**背景**：Crepe 的 `Latex` Feature 用 KaTeX 渲染。KaTeX 不认 `\require`、`\ce` 需额外扩展，
对 `\label` / `\eqref` 交叉引用与整篇 LaTeX 文档级语法支持弱。改用 **MathJax**
（`mathjax-full` 程序化 API + `AllPackages` + mhchem），原生支持：

| 语法                    | KaTeX     | MathJax（现方案） |
| --------------------- | --------- | ------------ |
| `$…$` / `$$…$$`       | ✅         | ✅            |
| `\label` / `\eqref`   | 有限（需 globalGroup） | ✅            |
| `\ce{H2O}`（mhchem）    | 需额外扩展     | ✅            |
| `\require{mhchem}`    | ❌         | ✅            |

**为什么保留 Crepe 的数学节点、只换渲染层**：数学节点的 schema 与 `remark-math`
解析直接决定「Markdown 往返保真」这条红线。已被验证的部分不动，只接管"显示"，
风险最低 KaTeX 与 katex.css 因此仍会留在包里（仅供合订导出的 DOMSerializer 路径）。

两条渲染路径：

1. **行内 `$…$`（`math_inline` 原子节点）**
   Crepe 的渲染写在 schema 的 `toDOM` 里直接调 `katex.render`，但**并没有**给该节点注册
   nodeView —— 所以补一个 ProseMirror 插件提供 `props.nodeViews.math_inline` 即可接管，
   无冲突。nodeView 内先以源码占位，MathJax 异步就绪后替换为 SVG；用自增令牌
   丢弃过期渲染结果，`destroy()` 时让在途回调失效。

2. **块级 `$$…$$`（`language='latex'` 的代码块）**
   走 `codeBlockConfig.renderPreview`。Crepe 的 Latex Feature 会在 `create()` 期间
   用 katex 拦截 `latex` 语言并**覆盖**该配置；若用 `editor.config(...)` 在构造期之前覆盖，
   会被 Latex Feature 的 katex 包装再次盖掉（这就是 `\label`/`\eqref`/`\ce`/`\require`
   一度以字面量出现的根因）。

   正确做法：用 **`.use()` 特性**（排到内部特性之后）再覆盖一次，让 MathJax 最终胜出：

   ```ts
   crepe.editor.use((ctx) => () => {
     ctx.update(codeBlockConfig.key, (prev) => ({
       ...prev,
       renderPreview: (language, content, applyPreview) => {
         if (String(language).toLowerCase() === 'latex')
           return renderMathBlockPreview(content, applyPreview)  // MathJax
         return prev.renderPreview(language, content, applyPreview)  // 保住 mermaid 等
       }
     }))
   })
   ```

   Crepe 构造函数里 `loadFeature` 通过 `editor.use()` 注册内部特性（含 Latex），
   故本 `.use()` 调用排在它们之后；`create()` 时插件 runner 按注册顺序执行，
   Latex 的 katex 包装先跑、我们的 MathJax 包装后跑 → **后者为最外层**，`latex` 命中 MathJax。
   配合 §5.3.1 的预览优先，块级公式在编辑区默认即渲染后的样子。

**沙箱安全性**：用 `liteAdaptor`（MathJax 自带的轻量 DOM 实现）而非浏览器 adaptor。
实测在**完全没有 document / window 全局**的 Node 环境下即可完成渲染 —— 因此不会
重蹈 mermaid 缺 `Buffer` 的覆辙（`§6` 的 renderer polyfill 与本模块无关）。
输出用 SVG 且 `fontCache: 'none'`，每个 SVG 自包含，插入 DOM 与导出都不依赖外部 CSS。

**整篇 LaTeX 文档级围栏修复（2026-08-30）**：用户把含 `\documentclass…\begin{document}` 的
整篇 LaTeX 文档粘进 `latex` 代码块时，原先被当成**一个巨型数学公式**喂给 MathJax → 渲染出一条
超宽退化的 SVG（界面上表现为用户所说的「一条加粗实线」）；且一旦报错会回退显示整段源码，于是
`\require` 等控制指令也以字面量出现在结果里。

修复（`src/editor/features/mathjax.ts`）：`renderLatexContent()` 先判断是否为完整 LaTeX 文档
（`isFullLatexDoc`，命中 `\begin{document}` 或 `\documentclass`），是则 `renderLatexDoc()`
抽取 `document` 环境正文，用 `SEG_RE` 切成「数学段 / 文本段」：

* 数学段（`$$…$$` / `\[…\]` / `\(…\)` / `\begin{数学环境}…\end{数学环境}` / `$…$`）交 MathJax 渲染；
* 叙述文本段剥离 LaTeX 控制指令（`\section{…}` → 仅留 `…`）后保留可读文字；
* 报错时不再回显源码（见下条）。

该方法同时供编辑器预览（`renderMathBlockPreview`）与 HTML 导出（`renderLatexBlocksInExport`，
见 §5.6）复用 —— 因此导出后的完整 LaTeX 文档同样会被正确分段渲染，而非原样转储源码。

**报错不再回显源码（2026-08-31）**：早期 `errorHtml()` 会把被截断的源码渲染进结果，于是
`\require{amscd}` / `\documentclass` 等控制指令以红色字面量出现在正文里（用户反馈
"显示红色的 \require"），还会污染导出。改为只输出错误徽标 `⚠ 公式无法渲染`，
完整原因放 `title` 悬停可见 —— 读者不需要看源码，作者悬停能查因。

**`\eqref` / `\ref` 交叉引用（2026-08-31）**：MathJax 的标签表挂在共享 `document` 上、
**跨 `convert()` 保留**，所以 `\eqref` 能否解析取决于「`\label` 是否已经渲染过」。
而渲染是异步且顺序不定的（行内 nodeView 立即渲染、块级走防抖预览），`\eqref` 经常先于
`\label` 渲染 → 显示 `???`，且因其结果被缓存而**一直卡在 ???**。
修复：`renderMathToSvg()` 检测到源码含 `\label{` 时广播 `onLabelsChanged`，
含 `\eqref` / `\ref` 的行内 nodeView 与块级预览订阅该事件并重渲染（各自带令牌防串台）。

**`$$` 定界符残留（2026-08-31）**：`renderLatexContent()` 增加 `stripMathDelims()`，
去掉可能残留的 `$$…$$` / `\[…\]` 包裹 —— 带着 `$$` 喂 MathJax 不会报错，但会多渲染两个
`$$` 字形（实测 SVG 宽度 27.6ex → 32.1ex），看着像公式坏了。

**`\require` 红色泄漏根治（2026-08-31）**：即便 `errorHtml()` 已改为不回显源码，
截图证实 `\require{amscd}` 仍以红色文本出现在 MathJax 的 SVG 输出中——
这是 **MathJax 自身**未能静默消费该预加载指令导致的（AllPackages 虽已包含 amscd 扩展，
但 `\require` 在某些上下文中仍被当作未知命令渲染为 merror 节点）。
根因修复：新增 `stripRequireDirectives()` 在送入 MathJax 前正则移除所有 `\require{…}` 行。
由于 AllPackages 已全量加载，该指令在功能上完全冗余；剥离后既消除视觉污染又不影响渲染能力。

**`\eqref` 显示 `???` 的根治（2026-08-31，推翻此前两版结论）**：

此前两版修复（延迟重试、`onLabelsChanged` 广播）**全都无效**，因为踩了三个连环坑，
且前两个都是"看起来在修、其实没生效"：

| # | 坑 | 说明 | 根治 |
|---|---|---|---|
| 1 | **压根没编号** | MathJax v3 的 `TagsFactory.OPTIONS.defaultTags = 'none'`（见 `mathjax-full/js/input/tex/Tags.js`）。只有显式 `\tag{…}` 的公式才有号，`\begin{equation}\label{eq:x}` **不自动编号**，`\label` 登记的是一个 tag 为空的 `Label` → `\eqref` 拿到空值 → `(???)`。 | 构造 TeX 时传 **`tags: 'ams'`**（v2 的 `equationNumbers.autoNumber:'AMS'` 的 v3 等价写法，与 StackOverflow / Quarto / VSCode-MPE 的通行解法一致）。`ams` 语义：`equation`/`align` 编号，`equation*`/`align*` 与行内不编号。 |
| 2 | **`???` 检测从未命中** | SVG 输出里没有字面文本，字符编成字形路径，`?` 写作 `<path data-c="3F">`。此前所有 `svg.includes('???')` 判断**恒为 false**，重试逻辑一次都没触发过。 | 改为解码 `data-c` 判断，且只在含 `MathJax_ref` 的节点上判定（避免误伤公式里正常的问号）。 |
| 3 | **编号漂移** | `tags.allCounter` 跨 `convert()` 累加，同一公式每重渲染一次编号 +1，边打字边看编号往上涨。 | 自维护 `label → 固定编号` 映射，渲染前 `primeCounter(n)` 把计数器上膛到该编号。 |

配套三处健壮性处理：
- `ignoreDuplicateLabels: true` —— 否则同一公式重渲染时 `\label` 会抛 `Label multiply defined`；
- 引用排队入队后**立即复查一次标签表**：微任务时序下「入队」完全可能发生在
  「标签注册 → 刷新队列」之后，此后不再有事件唤醒，任务将永久挂起（实测必现）；
- **1200ms 超时兜底 + 最多 3 轮**：引用了根本不存在的 label 时永远不会有注册事件，
  宁可显示 `(???)` 提示用户"引用没解析出来"，也不要让节点一直停在占位源码 `$…$` 上装死。

**裸 `$$…\label…$$` 自动套编号环境（2026-08-31）**：AMS 语义下 `$$…$$` 本身不编号，
写了 `\label` 也拿不到号。Markdown 用户写 `$$E=mc^2\label{eq:e}$$` 时心里想的
几乎一定是"这公式要能被引"。故 `ensureNumberedEnv()` 仅在**「有 `\label`、无任何环境、
无手动 `\tag`」**这三种条件同时满足时自动套壳：含 `\\` 或 `&` 时套 `align`（`equation`
单行环境吃不下换行对齐），否则套 `equation`。已有环境的一律尊重原样。

**行内标记与键帽的主题化（2026-08-31）**：新增两个色相层令牌，随皮肤走：
- `--hue-mark`（`==高亮==` 的荧光笔迹）：冷色皮肤（青瓷/天青/月白/黛）配**金缮暖金**，
  琥珀暖皮反过来配**石绿**，避免金色在暖调背景上糊成一片；
- `--hue-key`（`<kbd>` 键帽的玉料色）：取各皮肤同源色，像从同一块玉上雕下来的键。
均存 RGB 分量，便于 `rgba(var(--hue-mark), α)` 调透明度。

**CodeMirror 按钮 i18n 补全（2026-08-31）**：代码块预览区右上角的 Edit / Hide 按钮在中文模式下
仍显示英文。根因：Crepe `code-mirror/index.ts:70-72` 硬编码 fallback
`(previewOnlyMode ? 'Edit' : 'Hide')`，我们的 CodeMirror featureConfig 漏传了
`previewToggleText` 函数。修复：在 `MilkdownEditor.vue` 的配置中补传
`previewToggleText: (previewOnly) => previewOnly ? L.codeMirror.editLabel : L.codeMirror.hideLabel`，
并在中英文 locale 各增 `editLabel` / `hideLabel` 条目。

### 5.3.3 脚注双向跳转（2026-08-30）

Milkdown 的 GFM 脚注渲染为：正文引用 `<sup data-type="footnote_reference" data-label="N">`
与底部定义 `<dl data-type="footnote_definition" data-label="N"><dt>N</dt><dd>…</dd></dl>`。
**默认两者都没有锚点**（回跳通常由 rehype 注入，而 Milkdown 用自己的序列化器），
所以"点脚注跳不到正文"。

* **编辑区**：只加点击委托，**零 DOM 注入** —— 点 `<sup>` 滚到对应 `<dl>`；
  点定义里的 `<dt>` 滚回正文第一处引用。视觉上用 CSS `::after { content: ' \21A9' }`
  给出回跳提示。不动 DOM 是为了避免和 ProseMirror 托管 DOM 打架（它会在重渲染时清掉注入）。
* **导出 HTML**：产物是离屏副本，可安全改写 —— `enhanceFootnotes()` 给引用补
  `id` 并包一层 `<a href="#fn-N">`，给定义补 `id="fn-N"` 并追加
  `<a class="footnote-backref" href="#fnref-N-0">↩</a>`。同一脚注多处引用时 id 带序号，
  回跳指向第一处。

### 5.3.4 Emoji 短代码（2026-08-30）

`:smile:` 这类短代码自动转 emoji，三处协同：

1. **输入规则** `emojiInputRule`（ProseMirror `InputRule`）：敲完 `:name:` 立刻替换成 emoji
   字符，文档模型里即存 emoji。
2. **只读装饰** `emojiDecorationPlugin`：对已存在 / 粘贴进来的 `:name:`，用 widget 装饰
   原位显示 emoji 并把原文本隐藏 —— 不改动源码。经输入规则转换过的字符不再匹配，两者不冲突。
3. **导出** `replaceEmojiInHtml()`：装饰不进 `innerHTML`，故导出副本需单独把残留的
   `:name:` 换成 emoji；用 TreeWalker 跳过 `<code>` / `<pre>`，避免破坏代码里的字面量。

词典直接复用 `markdown-it-emoji/lib/data/full.mjs`（全量 GitHub 短代码），
不自己维护映射表 —— 但只取其数据，不用它的 markdown-it 插件。

### 5.3.5 内联标记：`==高亮==` / `^上标^` / `~下标~` / `<kbd>` 与内联 HTML（2026-08-30）

MarkText / Typora 风格的内联语法，在所见即所得里以对应样式呈现：

- `==文本==` → 高亮（导出 `<mark>`）
- `^文本^` → 上标（导出 `<sup>`；内部不含 `^` 与空格，避免误吞行首锚点 / 公式）
- `~文本~` → 下标（导出 `<sub>`；**单波浪线**，前后不接 `~` 以免误吞 GFM `~~删除线~~`）
- `<kbd>Ctrl</kbd>` → 键盘键帽（导出 `<kbd>`）；任意内联 HTML（`<sub>` `<sup>` `<mark>` `<abbr>` …）同理保留

> **上下标语法**：下标用**单** `~`（如 `H~2~O`），上标用 `^`（如 `X^2^`）。
> **双波浪线 `~~` 是 GFM 删除线**，不能用来写下标 —— `H~~2~~O` 渲染出来是删除线而非下标。

**为什么必须做「真节点」而不是装饰（2026-08-31 重构）**：初版沿用 Emoji 那套
「装饰显示 + 导出后处理」，源码里仍留着 `~` / `==` 字面量，结果**往返保真红线被破坏**：

1. `remark-gfm` 的 `singleTilde` 默认 `true`，会把单个 `~` 当删除线解析，切回源码时被
   规范化成 `~~` → 用户把 `~~` 改成 `~`，渲染后又被写回 `~~`，来回拉锯。
2. 即便关掉 `singleTilde`，`mdast-util-gfm-strikethrough` 仍**静态**注册了
   `unsafe: [{character:'~', inConstruct:'phrasing'}]`，序列化时 `~` 被转义成 `\~`；
   同理 `==高亮==` 在行首会被转义成 `\==高亮==`。

根因是：**只要定界符留在文本里，就必然被 gfm 抢解析或被 safe() 转义**。
故改为真节点 —— 定界符由节点自己的 to-markdown handler 输出，不经过 `safe()`：

| 输入        | 旧（装饰）       | 新（真节点）  |
| --------- | ----------- | ------- |
| `H~2~O`   | `H~~2~~O` ❌  | `H~2~O` ✅ |
| `X^2^`    | `X^2^` ✅     | `X^2^` ✅  |
| `==高亮==`  | `\==高亮==` ❌  | `==高亮==` ✅ |
| `~~删除~~`  | `~~删除~~` ✅   | `~~删除~~` ✅ |

实现分两路：

**A. 内联标记真节点**（等号高亮 / 上下标）：

1. `src/editor/features/inlineMarksSyntax.ts` —— **纯 remark 扩展，不 import 任何 Milkdown 模块**
   （因而可在 Node 里直接跑往返测试验证，见下）：
   * micromark 语法扩展：`~` / `^` / `==` 三个行内构造，叶子式分词（内容不跨行、遇到定界符即闭合），
     `solid` 要求至少一个非空白字符，避免 `~~` / `====` 空标记误命中；
   * mdast 扩展：`enter` 建节点、`exit` 回填 `value`（注意 `this.exit(token)` **不返回节点**，
     需在 `this.data` 上用栈传递引用）；
   * to-markdown handler：经 `data('toMarkdownExtensions')` 自注册 —— 这是 remark 官方扩展通道
     （remark-gfm 同路），**不依赖任何插件注册时序**。
2. `src/editor/features/inlineMarks.ts` —— Milkdown `$nodeSchema`（`sub` / `sup` / `highlight`
   三个行内原子节点，直接渲染 `<sub>` / `<sup>` / `<mark>` 语义标签）+ 输入规则。
3. **输入规则不可省**：真节点只在「重新解析」时生成，若无 InputRule，用户敲完 `~2~` 当下
   看不到效果、要切一次模式才变，观感等同于坏掉。节点类型从 `state.schema` 取，
   不依赖 ctx 时序。

> ⚠️ **序列化 handler 是强制项**：缺失时 remark-stringify 遇到这些节点会直接抛
> `Cannot handle unknown node 'sub'`（实测），含上下标的文档保存即崩 —— 故 handler
> 必须由插件自注册，不能依赖外部注入。

**B. 真实内联 HTML 节点**（`<kbd>` 与任意内联 HTML）：

Milkdown 默认没有 HTML 节点，`<kbd>Ctrl</kbd>` 被 micromark 解析成 `html` 节点后又因 schema
无对应节点被**直接丢弃** —— 这正是早期「键盘键适配未实现 / html 还是不支持」的根因。
改为自研 `$remark` + `$nodeSchema`（`src/editor/features/htmlInline.ts`）：

1. remark 插件把父节点属于行内容器（paragraph / heading / blockquote / listItem /
   tableCell / emphasis / strong / link / delete）的 `html` 节点改写为自定义 `htmlInline`；
2. schema 把它映射成行内原子节点，原样保存原始 HTML 字符串，用 `innerHTML` 渲染
   （标签不显示、只显示渲染结果），并随皮肤 / 明暗自动着色；
3. `toMarkdown` 把原始 HTML 原样写回，**保证 Markdown 往返保真**。

> #### ⚠️ 标签对必须合并成「一个」节点（2026-08-31 血泪）
>
> **症状**：键帽渲染成「左边一块空白的 `<kbd></kbd>`，右边光秃秃跟着 `Ctrl` 两个字」
> —— 用户痛斥的「文字与格式分离」。
>
> **根因**：CommonMark 的行内 HTML 是**逐个标签**解析的。
> `按 <kbd>Ctrl</kbd> 复制` 被切成三个 mdast 节点：
>
> ```
> html("<kbd>")  →  text("Ctrl")  →  html("</kbd>")
> ```
>
> 旧实现不假思索地把开闭标签**各自**转成一个 `htmlInline` 原子节点，于是渲染出
> `<kbd></kbd>`（空键帽，只剩描边底色）+ 裸文本 `Ctrl` + 一个无渲染效果的 `</kbd>`。
>
> **修复**：`mergeInlineHtml()` 在转换时向后扫描找到配对的闭合标签（同层、支持嵌套计数），
> 把「开标签 + 中间内容 + 闭合标签」合并成**单个** `htmlInline` 节点。
> 取值优先用 `position.start/end.offset` 从**原文切片**（而非拼接 children），
> 嵌套标签、属性、内部行内标记都能原样保留。
>
> 空标签（`<br>` / `<img>` / `<hr>` …，见 `VOID_TAGS`）与自闭合形式（`<br/>`）没有配对闭合，
> 单独成节点；未闭合的畸形标签退化为单节点，至少不丢内容。
> 13 条用例覆盖：单键帽 / 带属性 / `<br>` / 同行多键帽 / 嵌套 / 内含行内标记 / 块级不接管 / 逐字往返。

> 取舍：A / B 两路现在**都是真实节点**，编辑区与导出共用同一套语义标签
> （`<mark>` / `<sup>` / `<sub>` / `<kbd>`），从根上杜绝「编辑区好看、导出变形」。
> 代价是这些节点为**原子节点**（内容不可在位编辑，需整块重输），换取的是往返一字不改。
> 旧的 `replaceInlineMarkupInHtml()` 导出后处理已随之删除（不再是死代码）。

### 5.3.6 大排查与回归测试（2026-08-31）

用户明确要求「Markdown 解析是基础功能立身之本，必须非常完美」「大排查并解决」。
本轮在动手改之前先做了**根因实证**（用 Node 直接跑 MathJax / remark，而非凭印象），
并落地了一套**自动化回归网**（`scripts/verify-markdown.mjs`，`npm run verify:md`），
把本轮发现的每个坑都固化成用例，避免反复踩。

**排查覆盖与结论：**

| 项 | 排查点 | 结论 |
|---|---|---|
| 数学渲染 | MathJax 标签表是否跨 `convert()` 保留 | 标签对象共享且 `labels` 确实有值，但 v3 默认 `tags:'none'` 导致 `equation` 不编号、`\label` 是空壳 → `\eqref` 出 `???`。**已切 `tags:'ams'`** |
| 数学 `???` 检测 | 旧 `svg.includes('???')` 为何永远不命中 | SVG 用路径字形编码 `?`（十六进制 `data-c="3F"`），**字面 `???` 根本不存在于输出**。检测改为解码字形码 |
| HTML 内联 | `<kbd>Ctrl</kbd>` 为何「空键帽 + 裸文字」 | CommonMark 把开闭标签切成 3 个 mdast 节点；旧实现各自成节点 → 格式与文字分离。**已用 `mergeInlineHtml()` 合并成对标签** |
| 主题化 | kbd / mark 是否随皮肤走 | 新增 `--hue-mark` / `--hue-key` 令牌（5 皮肤 × 明暗），冷皮配暖金、暖皮配石绿，避免糊成一片 |
| CodeMirror i18n | 中文下 Edit/Hide 仍为英文 | Crepe 硬编码 fallback，已补 `previewToggleText` + 中英文 locale |
| 渲染管线 | 是否执行 remark 转换器 | `remark.runSync(remark.parse(...))` 确实执行（旧记忆有误，已更正于项目记忆） |

**回归用例（29 条，覆盖三大块）：**
- 数学：`\label`/`\eqref` 跨顺序解析、AMS 编号稳定、裸 `$$…\label…$$` 兜底、`\require` 剥离、
  未定义引用超时兜底、行内/块级两套节点视图。
- HTML 内联：单/多键帽、带属性、`<br>`、嵌套、内含行内标记、块级不接管、逐字往返。
- 混合：主题令牌存在性、跨皮肤明暗取值。

> 设计决策：本脚本**直接 bundle 真实 TS 源码**用 esbuild 在 Node 跑（mathjax.ts / htmlInline.ts），
> 不走浏览器沙箱、不靠猜；依赖用 `--alias` 桩替换。每次改动后跑 `npm run verify:md` 即可确认无回归。

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

| 格式             | 方案                                       | 说明                                              |
| -------------- | ---------------------------------------- | ----------------------------------------------- |
| **Markdown**    | 单文件导出 + `getMarkdown()`                    | 支持「内联图片为 base64」或「附带 .assets 文件夹」两种模式           |
| **纯文本**        | `htmlToPlainText(article)`                | 规范化 HTML 取 `<article>` 内层剥离标签，块级换段、实体解码          |
| **HTML**        | 克隆 ProseMirror DOM + 独立 CSS 模板             | **所见即所得导出**——你在编辑器里看到什么，导出的就是什么              |
| **PDF**         | `webContents.printToPDF()`                | Electron 原生能力，无需额外依赖；已加自动目录 / A4 分页控制 / 可选封面页   |
| **LaTeX**       | `src/export/markdownToLatex.ts`           | **纯 TS 零依赖**，不引入 pandoc；公式与代码块原样保留             |
| **Word (docx)** | 手写 OOXML + `jszip`（`src/export/docx.ts`） | 取 `<article>` 内层 → Mermaid `<svg>` 光栅化为 PNG → 拼装 DOCX 包（含 styles/numbering/图片/超链接） |
| **EPUB**        | `jszip@3.10.1` 手写 OPF（`src/export/epub.ts`） | EPUB3：`mimetype`(STORE 首条) / content.opf / nav.xhtml / 内联 SVG |
| **RTF**         | 零依赖手写 RTF 1.9（`src/export/rtf.ts`）        | `\ansicpg936` 中文；标题/列表/引用/代码/图片/链接；`\u` 带符号转义    |
| **ODT**         | `jszip@3.10.1` 手写 ODF 1.2（`src/export/odt.ts`） | content.xml / styles.xml / manifest.xml / Pictures/   |

**HTML 导出的优雅之处**：WYSIWYG 模式下，ProseMirror 的 DOM 已经是渲染后的结果——Mermaid 已变成 SVG、数学公式已由 MathJax 变成自包含 SVG、代码块已带高亮 span。直接 `cloneNode(true)` 套上模板 CSS 即可，**不需要再跑一遍 Markdown 渲染管线**，从根源上杜绝"编辑器里好看，导出后变形"的问题。

> **注（2026-08-30）**：WYSIWYG 导出（`getHTML()` 读实时视图 DOM）走 MathJax，产出的是
> `fontCache:'none'` 的自包含 SVG，**不需要任何外部 CSS / 字体**。
> 但「多文件合订」走 `markdownToHtml()` → `DOMSerializer` → `math_inline` 的 `toDOM`，
> 该路径仍是 Crepe 自带的 KaTeX 实现，因此导出模板的 KaTeX CSS CDN 需保留（见下条）。

需额外处理：KaTeX 字体与代码块高亮 CSS 要内联进导出文件，保证单文件离线可用。

**导出增强（2026-08-30，格式全集 9 种已落地）**

* **管道收敛**：九种格式共用一条流程——取正文 → 变换 →（可选预览）→ 落盘。`IPC.EXPORT_FILE` 为通用 `export:file` 通道（`content` + `defaultName` + `filters`），文本类（md / txt / html / latex）与 PDF 直接写盘 / 打印；二进制类（docx / epub / rtf / odt）在**渲染进程**序列化为 `Uint8Array`，经 `ExportPayload.binaryBase64` 以 base64 传给主进程，`writeFile(Buffer.from(b64,'base64'))` 精确写盘，规避 sandbox 下主进程无法访问渲染层 DOM 与文本编码损坏。
* **二进制序列化分层**：`buildExportContent` 对二进制格式调用 `serializeBinary(kind, canonicalHtml, ctx)`（`src/export/serialize.ts`），按 kind 分派到 `docx.ts` / `epub.ts` / `rtf.ts` / `odt.ts` 四个 builder；Mermaid `<svg>` 统一先经 `rasterizeSvgToImg` 光栅化为 PNG（DOCX/RTF/ODT），EPUB 保留内联 SVG。
* **LaTeX 转换的关键设计——转义与「公式 / 代码 / 链接」互斥**：先把行内代码、行内公式 `$...$`、显示公式 `$$...$$`、图片、链接、脚注抽成占位符，再对剩余文本做 LaTeX 特殊字符转义（`\ & % $ # _ { } ~ ^`），最后回填。否则链接 URL 里的 `_`、公式里的 `\`、宏名里的 `#` 都会被转义破坏。
* **PDF 分页**：顶层 `@page { size: A4; margin: 20mm 18mm }`；`@media print` 内 `.yujian-cover, .yujian-toc { break-after: page }`、`.yujian-doc h1 { break-before: page }`、`pre, table, figure, .mermaid, img { break-inside: avoid }`、`h1,h2,h3 { break-after: avoid }`（标题不孤行）。紧跟封面 / 目录的标题用 `.yujian-cover + h1 { break-before: avoid }` 取消分页，避免产生空白页。
* **图片内联**：`src/export/imageInline.ts` 用 `DOMParser` 解析产物，按**文档所在目录**解析相对路径（玉笺约定：文档同级同名 `.assets`），经 `file:readBase64` 读取后替换 `src`；已是 `data:` / `http(s):` 的跳过。**PDF 强制内联**——它经隐藏窗口加载 `tmpdir` 下的临时 HTML，相对路径图片本就取不到，这是此前 PDF 丢图的根因。
* **Mermaid 内嵌**：`src/export/mermaidSvg.ts` 复用既有 `mermaid` 依赖把 ```mermaid 渲染成 SVG 内嵌，失败则保留原代码块（优雅降级）。内嵌后不再注入 CDN 脚本，产物离线可用。
* **渲染任意 Markdown**：`MilkdownEditor.markdownToHtml(md)` 复用 Milkdown 的 `parserCtx` + `schemaCtx` + `DOMSerializer`，**不需要第二个编辑器实例**（不违反单实例红线），是多文件合订与选中范围导出的共同基础。
* **导出范围**：选中走 `getSelectionHTML()`（ProseMirror 选区 `serializeFragment`），源码模式取选区 Markdown 再渲染，两种模式产出同构；LaTeX 走 `getSelectionMarkdown()`（Milkdown `serializerCtx`，选区结构不合法时 try/catch 兜底）。无选区回退整篇并 toast 提示，不静默降级。
* **元信息**：`readExportMeta()` 取 `fidelity` 的 Markdown，用 `parseFrontmatter` 读 title / author / date（YAML 的 Date 统一转 `YYYY-MM-DD`），喂给封面页与 LaTeX 的 `\title` / `\author` / `\date`。
* **UI**：导出菜单扩展 `MenuEntry`，用新增的 `separatorTitle` 字段把 9 个格式按「文本 / 排版·网页 / 办公·电子书」分组，下接五个开关（自动目录 / 封面页 / 图片内联 / 仅选中范围 / 导出前预览）+ 多文件合订入口；合订面板 `CompilePanel.vue` 格式下拉同步 9 选项。`MenuEntry` 暂无 checkbox 字段，开关态用 `☑ / ☐` 符号表达，避免改动 `TitleMenu` 的类型契约。
* **多文件合订**（2026-08-30）：`src/components/CompilePanel.vue` 按文件树顺序列出 vault 内全部 `.md`，支持勾选 + 上下移排序 + 合订标题 + 每篇另起页（`break-before:page`）；输出 HTML / PDF / LaTeX 任选。逐文件 `readFile → markdownToHtml（复用 Milkdown parser/schema，不建第二实例）→ inlineImages（按各自文档目录解析相对图片，因为合订后无法用单一基准路径）→ 拼接`，再走与单文档完全相同的 `buildExportContent(override, forceInline)` 管道；`forceInline` 强制内联图片与 Mermaid 图表，保证跨目录自包含。LaTeX 合订则直接拼接各文件 Markdown 原文。
* **导出前预览**（2026-08-30）：`exportPrefs.preview` 开关（导出菜单可切换），或在合订面板内勾选。预览浮层 `src/components/ExportPreview.vue` 对 HTML/PDF 用 Blob + `iframe(sandbox="allow-scripts allow-same-origin")` 渲染真实排版、LaTeX 显示源码，确认后才写盘 / 打印；预览与落盘复用同一份已构建内容，不重复渲染。确认按钮明示「确认并选择位置」+ hint「确认后将弹出系统对话框，选择保存位置」，并有空内容兜底态。
  * **预览白屏根因**：预览 `iframe` 用 `blob:` URL，但 CSP `default-src 'self'` 未含 `frame-src blob:`，会直接拦截加载；`sandbox` 缺 `allow-same-origin` 也会阻止 blob 加载 → 一片白。修复：CSP 加 `frame-src 'self' blob:`、`sandbox` 改 `allow-scripts allow-same-origin`。
  * **深色模式原生保存框不同步**：文件名在系统原生保存框填写，app 深色由 CSS `data-mode` 驱动，而 Electron `nativeTheme.themeSource` 未同步 → 深色 app 弹出浅色对话框、文字发白。新增 IPC `app:setNativeTheme`，`appearance.applyAppearance` 每次切换把 `nativeTheme.themeSource` 设为 `mode`（dark/light/system），原生对话框与 app 同明暗。
  * **`ExportPreview.vue` 令牌修正**：误用未定义令牌 `--text-primary/--text-secondary`（实际为 `--hue-text-1/2`）已改正，文件名区改为与主题一致的可读 chip。
* **导出细节二次打磨（2026-08-30）**：针对「开了预览却无预览/无保存框/不知成败」——`EditorHost.getHTML()` 修复：源码模式下所见即所得 DOM 滞后/为空会返回空串，使 `buildExportContent` 因 `!body` 静默短路 → 不预览、不弹框、不提示；改为**源码模式直接走 `markdownToHtml()` 解析管线**（与合订/选区导出同源）。`App.vue` 的 `doExport`/`onCompile`/`confirmExport`/`writeExport` 全链路包 try/catch，失败 `showToast(...,'err',5000)` 显具体错误，成功 toast 显保存路径（4500ms），取消/失败回传明确状态，杜绝静默失败。
* **渲染进程 Node 全局 polyfill（2026-08-30）**：`mermaid` 部分图表模块（swimlanes 等）在导出/实时预览渲染时引用全局 `Buffer`，而 renderer 为 `contextIsolation/sandbox`（无 Node 全局），Vite 不自动 polyfill → 含 Mermaid 代码块的文档导出时抛 `Buffer is not defined`。已在 `src/main.ts` 入口注入纯 JS 的 `buffer` 包：`globalThis.Buffer = Buffer`，mermaid 渲染前全局可用。

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
* **取舍**：放弃了 ‹ › 逐个步进（即用户最初觉得「所见即所得下只是跳转不够直观」那部分体验），换来零代码冗余与两种范围完全一致的交互。命中定位在**两种编辑模式都可用**（见下方「命中行定位：不再强制切源码」）。
* **2026-08-30 补回：两端命中常驻高亮（对称体验）**：用户认可源码模式用 CodeMirror `Decoration` 常驻高亮全部命中的体验，故在统一引擎之上补回该视图层高亮；随后因追求两端一致，进一步补回所见即所得 ProseMirror `Decoration` 装饰，使其在两种模式对称高亮。
  * **源码模式**（`src/editor/find-source.ts`）：导出 `sourceFindField`（`StateField` + `setSourceFind` effect），按当前 `query/opts` 全文扫描命中区间打 `.cm-find`、当前结果所在行打 `.cm-find--current`；文档编辑时经 `tr.docChanged` 跟随重算。`SourceEditor` 挂载该字段并暴露 `setFind(query?, opts?, currentLine?)`。
  * **所见即所得模式**（`src/editor/find-wysiwyg.ts`）：导出 `createFindDecoPlugin`（`$prose(() => ...)` 注册，与凝神插件同机制），按当前 `query/opts` 用 ProseMirror `Decoration.inline` 常驻高亮全部命中、当前结果所在行打 `.pm-find--current`；`currentLine` 由 `isCurrentHit()` 判定（优先源码行文本匹配、回退行号比较，详见下方「命中行定位」）；文档编辑 / 切换文档时经 `tr.docChanged` 跟随重算。`MilkdownEditor` 暴露 `setFind(fs | null)`，经 `view.dispatch(tr.setMeta(findKey, fs))` 驱动（meta 事务必触发 `plugin.apply` 重建装饰）。
  * **桥接**：`EditorHost.setFindHighlight` 同时转发给 `source.setFind` 与 `milkdown.setFind`（构造 `WysiwygFindState`）。`Sidebar` 经 `find-highlight` 事件在「有查询且已打开文档」时把状态推给编辑器——**两种范围都高亮**（全库范围也会高亮当前打开文档内的全部命中）；无查询 / 无文档时抛 null 清空两端。
  * `editor.css` 恢复 `.cm-find` / `.pm-find` 系列（青瓷半透底 + 实强调色反相的 `--current` 变体）。纯视图装饰，不进文档、对 Markdown 往返保真零影响。
* **命中行定位：不再强制切源码（2026-08-30 修正）**
  * **问题**：此前 `App.onOpenResult` / `onOpenBrokenLink` 在跳转前会把 `requestedMode` 强制切到 `'source'`，理由是「渲染模式无法精确定位行」——`EditorHost.revealLine` 里 `if (mode.value !== 'source') return` 直接短路，所见即所得根本没有定位能力。后果：在所见即所得下点搜索结果会**被打断切到源码**，破坏写作沉浸感。
  * **修正**：所见即所得补齐行定位，`revealLine` 按当前模式分派（源码走 CodeMirror、渲染走 ProseMirror），两处强制切模式的逻辑一并移除。
  * **关键坑：源码行号 ≠ 渲染行号**。`lineOfPos` 基于 `doc.textBetween(0, pos, '\n', '\n')` 统计换行，而 Markdown 的**空行渲染后不产生节点**、块之间只算一个换行，渲染态行号被「压缩」，与统一搜索返回的源码行号存在系统性偏移（实测：源码第 3 行会落到渲染第 2 个文本块）。
  * **统一口径**：改用**源码行文本匹配**消除偏差——
    * `find-wysiwyg.ts` 新增 `stripMd(line)`（去 `#` / `>` / `-` / 强调标记）与 `findPosByText(doc, needle)`（片段逐级缩短做包含匹配，容忍语法差异，找不到返回 `null`）；
    * `MilkdownEditor.revealLine(line)`：先取源码第 `line` 行文本走 `findPosByText`，匹配不到再回退 `findPosOfLine`（行号反查，保留作兜底），命中后 `setSelection(TextSelection.near(...)).scrollIntoView()` + `view.focus()`；
    * `WysiwygFindState` 新增 `currentLineText`，`EditorHost.setFindHighlight` 从 `fidelity.currentText` 取该行原文传入；`buildDecos` 判定 `current` 改由 `isCurrentHit()` 优先做**行文本 ↔ 文本块**双向包含匹配，无行文本时才回退行号比较。
  * **实测**（真实浏览器 + 真实 Crepe，标题/段落/列表/引用混合文档）：源码第 1/3/5/8 行分别正确落到「标题 / 段落 / 列表项 / 引用」块，`current` 强化标记 4/4 命中正确块，超界行号返回 `null` 安全回退；面板 `display:none → 可见` 切换后装饰数不变（4 → 4）。

### 5.10 Phase 2 批次二：版本快照 + 写作统计 + 凝神模式（2026-08-29）

**版本快照（本地唯一真源，与 `.mdeditor/` 分离；git 化 Phase A 已于 2026-08-31 落地）**

* **存储（git 化 Phase A）**：main 进程在 vault 根建 `.yujian-history/<path-hash>/`：
  * `<ISO8601>__<note>.md` —— 快照正文（人类可读，**向后兼容旧全量快照**）；
  * `index.json` —— 元数据清单（git reflog 思想），记录 `tags` / `contentHash` / `parent` / `file` / 字数 / 字节数。
  * **内容哈希去重**：`createSnapshot` 算 `sha1(content)`，与任一已有快照哈希相同则**不写新 `.md`，仅新增一条 index 记录**指向同一文件（内容寻址去重，多个提交共享一份 blob）；`deleteSnapshot` 用**引用计数**——仅当无任何其它条目引用同一 `.md` 时才走 `shell.trashItem` 回收站物理删除（绝不 `rm`）。
  * **`parent` 线性血缘链**：新快照 `parent` 指向上一份；旧的全量 `.md` 在首次读取时经 `migrate()` 自动生成 `index.json` 并按时间排成 `parent` 链，**不丢任何历史数据**；脏条目（`.md` 已被手动删）自动剔除。
  * `electron/main/snapshots.ts` 提供 `listSnapshots` / `createSnapshot`（写一份，可带备注 + 标签）/ `restoreSnapshot`（**只读返回内容**，不写磁盘）/ `deleteSnapshot` / `setSnapshotTags`（更新命名标签）。
* ⚠️ **时区修复（2026-08-30）**：原 `nowIso()` 用 `toISOString()` 取的是 **UTC** 墙钟，而 `isoToDate()` 把该数字当**本地**时间解析，导致东八区用户存的快照被整差 8 小时。已改为取 `Date` 的本地时区 `getFullYear/getMonth/.../getSeconds` 生成文件名，与解析端一致；渲染端 `SnapshotPanel` 时间戳经 `src/utils/time.ts` 的 `formatDateTime`（同样走本机时区），并加「本机时区：{IANA}」tooltip（`Intl.DateTimeFormat().resolvedOptions().timeZone` 自动取电脑时区，无需硬编码东八区）。**注意**：此前（bug 期）已落盘的快照文件名仍是 UTC 数字，读回会偏 8 小时；新快照已正确，旧快照可在 `.yujian-history/` 手动清理。
* **命名标签（git tag 思想，Phase A）**：`tags[]` 经 `sanitizeTags`（去空/去重/限长 24/限最多 8 个）落库；面板每行内联 chip 增删，顶部按全部标签筛选；`SnapshotInfo` 增补 `tags?` / `contentHash?` / `parent?`。
* **任意两点对比（git diff A B 思想，Phase A）**：`SnapshotPanel.vue` 每行带 A / B 小按钮，选两份即 `diffLines(快照A, 快照B)` 摊平逐行 add/del/ctx 预览；保留旧"选中快照 vs 当前稿"对比（`diffMode` 区分 `'ab'` / `'selected'` / `'none'`）。
* IPC：通道 `snapshot:list` / `snapshot:create` / `snapshot:restore` / `snapshot:delete` / `snapshot:setTags`（新增）在 `electron/shared/ipc-channels.ts` 集中定义；preload 暴露 `window.api.snapshotList/Create/Restore/Delete/SetTags`（类型自动派生）；`main/index.ts` 注册对应 handler。
* 前端：`src/store/snapshots.ts`（Pinia，**只缓存当前文档的快照列表，不持有内容**；新增 `setTags`）；玻璃 `SnapshotPanel.vue`（锚定 `.editor` 右上）：备注输入 + 保存、标签筛选 chips、A↔B 任意两点对比、标签 chips 内联增删、左侧时间 + 备注 + 字数差 `deltaChars`、选中→`snapshotRestore` 只读返回→行级 diff 预览、右下恢复/删除 + 右键 `ContextMenu`（restore/delete danger）、空态文案。恢复走 `EditorHost.loadMarkdownExternal`（灌入 + 标 dirty + 自动保存），**不立即覆盖磁盘原文**（守 §5.2 保真红线）。
* 行级 diff 库选型修正：原计划写 `jsdiff`，但 `jsdiff@1.1.1` 实为「JSON 对象 diff」库（装配错误）；正确库是 `diff@^7.0.0`（`diffLines`），已在 `package.json` 落地，`jsdiff` 已卸载；无类型的 `diff@7` 在 `src/types/diff.d.ts` 补了环境声明。
* 自动快照策略（防抖保存 + 定时）已留接口；批次二先落地「手动留档 + 行级 diff 预览 + 回滚」闭环，自动策略在后续打磨中接入同一 `snapshotCreate`。
* ✅ **状态：已于 2026-08-30 由用户运行期验证可用**（基础留档/看 diff/恢复/删除），**git 化 Phase A（标签/任意两点对比/哈希去重/index 元数据/向后兼容迁移）于 2026-08-31 落地**。原「⚠ 实现但未测试」标注已从 `SnapshotPanel.vue` 代码注释、面板 UI 横幅与本小节移除。

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
* 点击行 → `App.onOpenBrokenLink(item)`：经 `openPath` 打开文档（已是当前文档则跳过）→ `revealLine(line)` 按当前模式定位并滚动到断链行（源码与所见即所得都支持，不再强制切源码）；与全文搜索结果定位同一套逻辑。零断链显示「未发现断链 ✓」（绿色对勾）。

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
| 数学公式        | MathJax（`mathjax-full` + AllPackages + mhchem），行内 nodeView + 块级 renderPreview（§5.3.2）；支持 `\ce` / `\require` / `\label` / `\eqref` | P1 |
| Mermaid 流程图 | 代码块 renderPreview 钩子（§5.3）；编辑区默认即显示图表（§5.3.1） | P1 |
| 脚注           | GFM 脚注；编辑区点击双向跳转 + 导出注入回跳锚点（§5.3.3）           | P1 |
| Emoji 短代码    | `:smile:` 输入自动转换 + 只读装饰显示 + 导出替换（§5.3.4）     | P1 |
| 内联标记        | `==高亮==` / `^上标^` / `~下标~` 编辑区装饰 + 导出落语义标签；`<kbd>` 与内联 HTML 经 htmlInline 真实节点（§5.3.5） | P1 |
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

