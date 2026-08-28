# Markdown 编辑器 · 架构设计文档

> 版本：v1.0 ｜ 日期：2026-08-28 ｜ 状态：待确认
> 本文所有依赖版本均经过 `npm view` 实测可获取，环境结论来自本机实际探测。

---

## 0. 结论摘要

| 决策项 | 结论 | 一句话理由 |
|---|---|---|
| 应用形态 | 跨平台桌面应用 | 你选的 |
| 框架 | **Electron 44 + Vue 3 + TypeScript** | 本机无 MSVC，Tauri 实测编译不了 |
| 构建工具 | **electron-vite 5 + vite 7**（不可升 8） | electron-vite 的 peer 不支持 vite 8 |
| 编辑器内核 | **@milkdown/crepe 7.22.1** | ProseMirror + remark 双引擎，Markdown 往返一致性最好 |
| 编辑模式 | WYSIWYG 为默认，可切源码模式 | 你选的 |
| 存储 | 文件夹即笔记库，纯 `.md` + 相对路径资源 | 数据永远可读、可 Git、可迁移 |
| 搜索 | MiniSearch（纯 JS 倒排索引） | 零原生编译，与"无 MSVC"约束一致 |
| v1 主攻 | 技术写作场景 | 你选的 |

### 0.1 本机环境实测结果

| 检测项 | 实测值 | 结论 |
|---|---|---|
| Node | v22.22.2 | ✅ |
| npm | 10.9.7 | ✅ |
| npm registry | `https://registry.npmmirror.com/` | ✅ 已加速 |
| `cl.exe`（MSVC 编译器） | **未找到** | ❌ Tauri 不可行 |
| VS2022 目录 | 存在但为空壳（未装任何工作负载） | ❌ 无 C++ 工具链 |
| WebView2 Runtime | **未安装** | ❌ Tauri 运行时也不满足 |
| Rust | 1.93.0 | ⚠️ 有工具链，但链接 Windows 目标必须走 MSVC，无用武之地 |
| `electron_mirror` | `undefined` | ⚠️ 需配置，否则下载 Electron 二进制走 GitHub 会很慢 |

> **关于 Tauri 的最终判断**：不是"麻烦"，是**不可行**。Tauri 在 Windows 上链接需要 `link.exe`（MSVC），且运行依赖 WebView2 Runtime，你本机两个都缺。即使愿意装，代价是 5~8GB 的 Visual Studio C++  workloads，而你已明确表示不想装。Electron 不需要任何 C++ 工具链（官方提供预编译二进制），是当前唯一顺畅的路径。

---

## 1. 需求边界与优先级

### 1.1 已确认需求

- 跨平台桌面应用，双击即用
- **默认所见即所得**编辑，**必须能切换到源码模式**
- 场景全覆盖，但 v1 主攻**技术写作**
- 四项必备能力：文件树 + 全文搜索 / 图表与公式 / 图片粘贴 + 图床 / 导出与发布
- 存储以"文件夹即笔记库"为主体，**同时支持单个 `.md` 文件导出**

### 1.2 优先级矩阵

| 优先级 | 能力 | 说明 |
|---|---|---|
| **P0** | 打开/新建/编辑/保存 `.md` | 没有这个其他都是空谈 |
| **P0** | WYSIWYG ⇄ 源码 双模式切换 | 你的核心诉求 |
| **P0** | 自动保存与崩溃恢复 | 编辑器类应用的信任底线 |
| **P1** | 文件树侧边栏 + 笔记库切换 | |
| **P1** | 代码块高亮（多语言） | 技术写作刚需 |
| **P1** | 数学公式（KaTeX） | Crepe 内置 |
| **P1** | Mermaid 流程图 | 需自研节点，见 §5.3 |
| **P1** | 增强表格编辑 | Crepe 内置 |
| **P1** | 图片粘贴落盘 | |
| **P1** | 导出 HTML / PDF / 单文件 Markdown | |
| **P2** | 全文搜索 | MiniSearch |
| **P2** | 大纲面板 | 长文与书稿场景 |
| **P2** | 图床上传 | 需配置化 |
| **P2** | 导出 Word | |
| **P3** | 双链、标签、关系图谱 | 知识库场景 |
| **P3** | 一键发布公众号/知乎 | 需各平台适配 |
| **P3** | 团队协作、云同步 | 需后端，另立项目 |

### 1.3 本期明确不做

- 实时多人协作（需要 CRDT + 服务端，是另一个量级的工程）
- 移动端版本
- 插件市场机制（预留接口，但不实现生态）

---

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

---

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
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- IPC channel 集中在 `shared/ipc-channels.ts` 常量表，preload 只挂载白名单内的方法

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

---

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

---

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
- 文档一律是标准 `.md`，YAML frontmatter 存元数据（title/tags/created/updated）
- 资源引用使用**相对路径**（`./.assets/xxx.png`），保证整库可迁移、可 Git、可用其他工具打开
- `.mdeditor/` 只是缓存，删掉不影响任何笔记内容

### 5.2 ⚠️ Markdown 往返失真 —— 本项目第一号风险

**问题**：Milkdown 通过 remark 序列化，会把用户手写的 Markdown 规范化。典型表现：

| 你写的 | 保存后变成 |
|---|---|
| `*斜体*` | `_斜体_` |
| `- 列表项` | `* 列表项` |
| Setext 标题（`===`） | ATX 标题（`###`） |
| 手排对齐的表格 | 按内容宽度重新对齐 |
| 内联 HTML | 可能被转义 |

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

- 状态机维护三个字段：`rawText`（磁盘原文）、`docText`（Crepe 序列化结果）、`isDirty`
- 只在 WYSIWYG 模式下产生编辑事务时才置 `isDirty`
- 源码模式编辑后保存，**永远走原文路径**，不经过序列化
- 提供设置项："保存时总是规范化排版"（默认关）

### 5.3 Mermaid 图表方案（代码块预览钩子）

> **实现时改了方案**：原计划自研 NodeView，实际改用 Crepe 代码块自带的
> `renderPreview` 钩子。理由见文末 —— 核心是**对文档结构零侵入**。

官方插件版本不兼容（见 §2.3 陷阱二），因此不使用 `@milkdown/plugin-diagram`。
改为接管 Crepe 代码块的**预览区**：

1. 文档里就是一个普通的 mermaid 代码块，schema 与序列化完全不动
2. 通过 `featureConfigs[Crepe.Feature.CodeMirror].renderPreview` 接管：
   - `language !== 'mermaid'` → 返回 `null`，保持无预览
   - 命中 mermaid → 返回 `undefined` 进入异步模式，渲染完成后 `applyPreview(svg)`
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
- 统一 `Uploader` 接口：`{ name, upload(buffer, filename): Promise<string> }`
- 内置实现：SM.MS、七牛云、自定义 HTTP API（预留阿里云 OSS / GitHub）
- 上传动作在 **main 进程**执行，规避浏览器 CORS 与密钥泄露
- 维护 `srcMap: 本地相对路径 → 远程 URL`，导出时可一键批量替换为图床链接（公众号等平台必须）

### 5.5 搜索（MiniSearch）

- 索引字段：`title`（权重 3）、`content`（权重 1）、`path`、`tags`
- 持久化：`vault/.mdeditor/search-index.json`，用 `MiniSearch.toJSON()` 序列化
- 增量更新：chokidar 捕获文件变更 → 只重建该条
- 冷启动全量构建：1000 个文件约 1-2 秒，放 main 进程避免卡 UI
- 支持中文分词（MiniSearch 对 CJK 需配置 `tokenize` 为按字切分）

> **为什么不用 SQLite**：`better-sqlite3` 需要 node-gyp 编译 → 需要 MSVC → 与你本机的约束直接冲突。MiniSearch 是纯 JS，零编译依赖。

### 5.6 导出

| 格式 | 方案 | 说明 |
|---|---|---|
| **HTML** | 克隆 ProseMirror DOM + 独立 CSS 模板 | **所见即所得导出**——你在编辑器里看到什么，导出的就是什么 |
| **PDF** | `webContents.printToPDF()` | Electron 原生能力，无需额外依赖，支持页眉页脚与分页控制 |
| **Markdown** | 单文件导出 | 支持"内联图片为 base64"或"附带 .assets 文件夹"两种模式 |
| **Word** | HTML → docx（阶段 6，可选） | |

**HTML 导出的优雅之处**：WYSIWYG 模式下，ProseMirror 的 DOM 已经是渲染后的结果——Mermaid 已变成 SVG、KaTeX 已变成 MathML、代码块已带高亮 span。直接 `cloneNode(true)` 套上模板 CSS 即可，**不需要再跑一遍 Markdown 渲染管线**，从根源上杜绝"编辑器里好看，导出后变形"的问题。

需额外处理：KaTeX 字体与代码块高亮 CSS 要内联进导出文件，保证单文件离线可用。

### 5.7 主题系统

- 基于 CSS Variables，一套变量表驱动全应用
- Crepe 官方自带 6 套主题（frame / crepe / nord × light / dark），可直接复用
- 编辑器内容区样式与导出模板共用同一套 CSS，保证一致性
- 跟随系统深色模式

---

## 6. 技术写作场景专项设计

| 能力 | 实现 | 阶段 |
|---|---|---|
| 代码块多语言高亮 | Crepe 内置 CodeMirror，语言按需引入裁剪体积 | P1 |
| 数学公式 | Crepe 内置 KaTeX，行内 + 块级 | P1 |
| Mermaid 流程图 | 代码块 renderPreview 钩子（§5.3） | P1 |
| 表格增强 | Crepe 内置，行列拖拽 + 对齐设置 | P1 |
| 大纲面板 | 从 ProseMirror doc 提取 heading 层级，滚动联动 | P2 |
| 字数/阅读时间统计 | 状态栏实时显示，中英文分别计数 | P2 |
| 专注模式 | 当前段落高亮，其余淡出 | P3 |
| 复制为富文本 | 复制到公众号/知乎时保留样式 | P3 |

---

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
```

---

## 8. 开发路线图

| 阶段 | 目标 | 产出验收标准 |
|---|---|---|
| **0. 地基** | 脚手架 + 窗口 + IPC 打通 | `npm run dev` 能弹出一个空白 Electron 窗口 |
| **1. 编辑器核心** | Crepe 接入 + 双模式切换 + 打开/保存 md | 能打开一个 md 编辑并保存，Ctrl+/ 切换源码无内容丢失 |
| **2. 笔记库** | 文件树 + 自动保存 + 崩溃恢复 | 能打开整个文件夹，断电重启后内容不丢 |
| **3. 写作套件** | Mermaid + 公式核验 + 表格 + 代码块 | 一篇含图表的文章能正常编辑渲染 |
| **4. 图片** | 粘贴落盘 + 图床配置 | 截图粘贴即可插入，图床可配 |
| **5. 搜索** | MiniSearch 索引 + 搜索面板 | 千篇笔记下搜索响应 < 100ms |
| **6. 导出** | HTML / PDF / 单 md | 导出结果与编辑器内观感一致 |
| **7. 打磨** | 主题、体积裁剪、快捷键、设置面板 | 安装包体积优化，可用 |
| **8. 分发** | electron-builder 打包 | 产出 Windows 安装包，可安装运行 |

> 建议：**先只做阶段 0~1**，跑通"打开→编辑→保存→切源码"这条最小闭环再继续。编辑器项目的复杂度集中在后段，早验证能省大量返工。

---

## 9. 已知风险与应对

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 1 | **Markdown 往返失真** | 高 | 原始文本保真模式（§5.2），未编辑则一字不改写回 |
| 2 | **Milkdown 多实例上下文错误** | 高 | 全项目只用 `@milkdown/crepe` 单包，不混装低版本插件 |
| 3 | **Electron 二进制下载慢/失败** | 中 | 配置 `electron_mirror` + `electron-builder-binaries` 指向 npmmirror |
| 4 | **Crepe 体积偏大** | 中 | 阶段 7 裁剪 `@codemirror/language-data`，按需引入语言包 |
| 5 | **KaTeX 字体导出丢失** | 中 | 导出 HTML 时内联字体或使用本地字体文件 |
| 6 | **electron-builder 打包需下载 NSIS** | 低 | 同风险 3，配镜像解决 |
| 7 | pinia 4 与 Vue 3.5 的 peer 兼容性 | 低 | 安装时若报冲突，降级到 `pinia@^2` |

---

## 10. 需要你拍板的遗留问题

这几个问题会影响后续实现细节，请确认（也可以先按我的默认建议走）：

1. **图片存放位置**：统一放 `vault/.assets/`（推荐，迁移方便）还是与 `.md` 同级目录（单文件分发方便）？
2. **自动保存策略**：防抖多少毫秒？我建议 800ms，另外是否需要保留 `.bak` 备份文件？
3. **源码模式切换时是否自动格式化**？我建议**不格式化**，保持你的原始排版。
4. **是否需要多标签页**（像浏览器一样同时开多篇）？这会增加状态管理复杂度，建议 v1 先单文档窗口。
5. **图床优先级**：v1 先只做本地存储、预留图床接口，还是直接接一个图床（比如 SM.MS）？
6. **AI 辅助写作**：Crepe 已内置 AI Feature 接口（需自备 API Key），要不要纳入路线图？放在哪个阶段？

---

## 附录 A：开工前必做的环境配置

```bash
# 1. 配置 Electron 二进制镜像（否则下载极慢）
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron-builder-binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/

# 2. 验证版本锁定正确
npm view vite version        # 应为 7.3.x，不是 8.x
npm view @milkdown/crepe version   # 应为 7.22.1
```
