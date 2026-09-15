# Markdown 编辑器 · 架构设计文档

> 版本：v2.1.0 ｜ 日期：2026-09-12 ｜ 状态：已发布
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
| 搜索    | 统一 vault 索引层（轻量元数据，纯 Node fs，无全文索引） | 零原生编译，与"无 MSVC"约束一致；索引为可重建缓存，丢失静默重建 |
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

### 0.2 开发宗旨与原则（2026-08-31 确立）

以下八条是本项目的**最高指导原则**，高于任何局部便利或短期省事。所有架构决策、代码取舍、依赖选型都必须向它们对齐；当两条原则冲突时，越靠前的优先级越高。

1. **不保留向后兼容。** 过时的直接删，别加兼容层、别写 migration、别留 fallback。
2. **选能满足当前需求的最简单实现。** 不要预防性抽象，不要多此一举的配置层。
3. **系统分层长。** 先跑通一个最小的端到端版本，再往上加东西。绝不为了未完成的复杂度拆掉能跑的东西。
4. **组件保持模块化，关注点分离。**
5. **优先用成熟的、有人维护的库。** 没有明确理由别自己重写。
6. **先翻项目里已有的依赖能做什么，再考虑加新包或自己写。** 别上来就假设库里没有。
7. **架构决策往长了做。** 不接受"先这样以后再换"的临时方案。
8. **先看成熟产品怎么解决同一个问题，用已验证的模式，别从零发明。**

> 据此原则，本项目**不维护历史兼容代码**：移除功能即彻底删除组件 + 接线 + 文档，不留半截死代码或残留入口；新增能力先盘点仓库已有同类实现，避免重复造车。

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
| **P2** | 全文搜索                         | 统一 vault 索引层（vaultIndex.ts）   |
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

    // —— 搜索（统一 vault 索引层，纯 Node fs，无第三方搜索库） ——

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
   │                                              更新统一 vault 索引层
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

> ⚠️ 下方为 v1 立项时的**目标结构草图**，与当前实现已有出入，**以实际目录为准**：
> * `electron/main/` 现为**扁平模块**（`vault.ts` / `vaultIndex.ts` / `snapshots.ts` / `vaultIntegrity.ts` / `vaultBackup.ts` / `softError.ts` / `trash.ts` / `atomicWrite.ts` / `imghost.ts` / `assets.ts` / `session.ts` / `index.ts`），不再有 `ipc/` 与 `services/` 子目录；
> * 渲染层状态在 `src/store/`（非 `stores/`），本轮新增 `src/composables/`（`usePkmPanels.ts` / `useVaultLinks.ts`，见 §5.23）；
> * 跨进程契约在 `electron/shared/`：`ipc-channels.ts`（通道唯一真源）+ `wikilink-syntax.ts`（共享语法，见 §5.23）。

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
│  │     ├─ search.service.ts        # 统一 vault 索引层（vaultIndex.ts）构建/增量维护
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
│  ├─ vault-index.json        # 统一 vault 索引层快照（轻量元数据，可重建缓存）
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

**`\eqref` / `\ref` 交叉引用（2026-08-31，机制于 2026-09-11 校正）**：MathJax 的标签表挂在共享
`document` 上、**跨 `convert()` 保留**，所以 `\eqref` 能否解析取决于「`\label` 是否已经渲染过」。
而渲染是异步且顺序不定的（行内 nodeView 立即渲染、块级走防抖预览），`\eqref` 经常先于
`\label` 渲染 → 显示 `???`。

机制（当前实现，见 `renderMathWithRef` / `flushPendingRefs`）：含引用的公式若解析不出，
**不返回半成品**，而是把任务推入 `pendingRefs` 队列挂起；`renderMathToSvg()` 每渲染一个含
`\label{` 的公式就调用一次 `flushPendingRefs()` 唤醒队列重试。三层保险：①入队后立即复查一次
标签表（微任务时序下「入队」可能晚于「注册 → 刷新」，实测必现）；②最多重试 `MAX_REF_ATTEMPTS`
轮；③1200ms 超时兜底，宁可结算出 `???` 也不让节点永久停在占位源码。
> 注：早期版本曾有一套 `onLabelsChanged` 广播接力，**因未区分「已超时结算」与「未超时挂起」而失效，已移除**；
> 现 `labelChangeListeners` 是**仅针对「已超时显示 ??? 的存活 NodeView」**的晚到恢复通知，二者不可混为一谈。

**`$$` 定界符残留（2026-08-31）**：`renderLatexContent()` 增加 `stripMathDelims()`，
去掉可能残留的 `$$…$$` / `\[…\]` 包裹 —— 带着 `$$` 喂 MathJax 不会报错，但会多渲染两个
`$$` 字形（实测 SVG 宽度 27.6ex → 32.1ex），看着像公式坏了。

**`\require` 红色泄漏根治（2026-08-31）**：即便 `errorHtml()` 已改为不回显源码，
截图证实 `\require{amscd}` 仍以红色文本出现在 MathJax 的 SVG 输出中——
这是 **MathJax 自身**未能静默消费该预加载指令导致的（AllPackages 虽已包含 amscd 扩展，
但 `\require` 在某些上下文中仍被当作未知命令渲染为 merror 节点）。
根因修复：新增 `stripRequireDirectives()` 在送入 MathJax 前正则移除所有 `\require{…}` 行。
由于 AllPackages 已全量加载，该指令在功能上完全冗余；剥离后既消除视觉污染又不影响渲染能力。

**`\eqref` 显示 `???` 的三个连环坑（2026-08-31 记录 · 2026-09-11 校正措辞与验证状态）**：

此前两版修复（延迟重试、`onLabelsChanged` 广播）**全都无效**，因为踩了三个连环坑，
且前两个都是"看起来在修、其实没生效"：

| # | 坑 | 说明 | 修复 |
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
- **token 失效必结算（2026-09-11 修）**：`flushPendingRefs` 曾对 token 失效的任务直接
  `return`（不 resolve、不再入队），而 1200ms 兜底又因该任务已出队（`indexOf < 0`）而跳过
  → promise 永久挂起，节点卡在占位源码。现改为 `task.resolve(svg)` 结算（调用方有
  `mine !== this.token` 守卫，不会污染陈旧 DOM）。

- **晚到 label 自动恢复（2026-09-12 根治 `???` 端到端）**：`pendingRefs` 只唤醒**尚未超时**
  的引用；一旦 `1200ms` 兜底把任务结算成 `(???)`，该任务就出队了，后续 `\label` 即便注册成功
  **也没有 Promise 可 resolve**。而块级公式走 CodeMirror 懒初始化（`IntersectionObserver →
  initializeCodeMirror → Vue 挂载 → renderPreview`），其 `\label` 经常**晚于**行内 `\eqref` 的
  1200ms 兜底才登记——于是行内已显示 `(???)` 且永不再刷新（用户重输字符才恢复，正因 `update()`
  重新触发了 `renderMathWithRef`）。
  修复：新增 `labelChangeListeners` 通知（非替换 `pendingRefs`）。`renderMathToSvg()` 在确认
  MathJax 标签表**确有**新 label 后调用 `notifyLabelsChanged(labels)`；`MathInlineView` 构造时
  订阅，仅当「当前仍是引用公式、DOM 仍是 unresolved SVG、且新注册的 label 命中其引用」时
  `render()` 补渲染一次；`destroy()` 中 `offLabels?.()` 退订，避免旧 nodeView 被模块级监听器持有。
  全程复用既有 token 守卫，不新增竞态。回归测试见 `verify-markdown.mjs` `1b`（晚到恢复）/
  `1c`（无关 label 不触发）/`1d`（销毁后不写旧 DOM）/`1e`（快速编辑不覆盖）。

> **验证状态（2026-09-12 更新）**：用户实测的「重载后持久 `???`」**已根治**——根因是
> 「晚到 label + 已结算 NodeView 不重渲染」的局部生命周期同步缺口，而非块级预览派发缺失
> （`renderPreview` 本就会被调用，只是常常晚于兜底）。修复为最小局部改动，不依赖任何 DOM 取证，
> 且 `verify-markdown.mjs` 在**纯逻辑层**覆盖「引用先于定义」「label 不存在超时兜底」「token 失效不挂起」
> 以及「**已超时显示 ??? 的同一 NodeView 被晚到 label 自动恢复**」四条路径（修复前 `1b` 必失败）。

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

**回归用例（30 条，覆盖三大块）：**
- 数学：`\label`/`\eqref` 跨顺序解析、AMS 编号稳定、裸 `$$…\label…$$` 兜底、`\require` 剥离、
  未定义引用超时兜底、**token 失效必结算（不挂起）**、行内/块级两套节点视图。
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

**编辑器内显示（jade-asset:// 协议，2026-09-01 落地）：**

* **问题**：文档模型里图片是**相对路径**（保真红线，绝不改写）。旧实现把显示用 `src` 改写成 `file://` 绝对路径——但开发模式渲染进程跑在 `http://localhost`，Chromium 会拦截 `http` 源加载 `file://` 资源，导致开发期图片全裂（生产用 `loadFile` 的 `file://` 源则正常）。这就是"有时正常有时裂"的根因。
* **方案**：自定义特权协议 `jade-asset://`，开发 / 生产统一生效。
  * 渲染层 `MilkdownEditor.vue` 的 `rewriteImages` / `imgToAssetUrl`：把相对 / `file://` 图改写成 `jade-asset://local/<encodeURIComponent(绝对路径)>`（`https:` / `data:` / `blob:` / 已是 `jade-asset:` 的跳过，避免循环改写）；`http:` 远程图也跳过。
  * 主进程 `electron/main/index.ts` 顶层 `protocol.registerSchemesAsPrivileged([{ scheme:'jade-asset', privileges:{ standard, secure, stream, supportFetchAPI, bypassCSP } }])`（须在 `app ready` 前注册），`app.whenReady` 内 `protocol.handle('jade-asset', handleJadeAsset)` 按绝对路径 `readFileSync` 读盘、以 `Response` 返回字节流。
  * 文档模型仍是相对路径，**往返保真不变**。
* **导出衔接**：`src/export/imageInline.ts` 的 `inlineImages` 识别 `jade-asset://` 并解码回绝对路径（`decodeJadeAsset` 提取 `local/` 后段 → `decodeURIComponent`）再内联为 data URL，避免 WYSIWYG 导出（`getHTML()` 读实时 DOM，含 `jade-asset://`）丢图。
* **两个易错点（已踩坑）**：① `new URL(...).pathname` 已对中文做一层百分号编码，渲染层须先 `decodeURIComponent` 再 `encodeURIComponent` 一次，否则主进程只解一层致中文路径仍是 `%XX` 读不到；② 协议层会在绝对路径前多塞一个前导斜杠（`//C:/...` 或 `//Users/...`），主进程 handler 须 `replace(/^\//,'')` 再 `replace(/^\/([A-Za-z]:)/,'$1')` 归一。

### 5.5 搜索（统一 vault 索引层）

> ⚠️ 历史说明：早期架构稿曾设想用 MiniSearch 做全文倒排索引，但 `minisearch` 自引入后**代码中零引用（死依赖）**，实际搜索一直是 `vault.ts` 的暴力递归扫描（单文件 20 命中、全库 80 文件上限）。批次零已移除该死依赖，并建成真正的统一索引层 `electron/main/vaultIndex.ts`。

* 索引层：`electron/main/vaultIndex.ts`，**纯 Node `fs`，无第三方搜索库**，便于在 Node 环境跑往返单测。
* 索引字段（轻量元数据，不缓存正文、不索引全文）：`mtime` / `title`（frontmatter title > 首个 H1）/ `headings`（≤50）/ `outLinks`（已解析的 wikilink 目标绝对路径）/ `tags`（frontmatter `tags` + 正文内联 `#标签`，v2 起）/ `moc`（frontmatter `moc: true`）。反向链接由 `outLinks` 派生，并被搜索、反链面板、标签 / MOC 聚合与**重命名 / 移动的引用自动改写**（§5.21）共同消费。
* 持久化：`vault/.mdeditor/vault-index.json`，沿用项目「写临时文件 + rename」原子写；是**可重建缓存**，丢失/损坏/版本不符时静默全量重建，绝不弹错。
* 增量维护（严格增量，禁任何全库周期重算）：chokidar 捕获 `add`/`change` → 只重解析该文件（复用缓存的路径映射，O(1)）；`unlink` → 移除该条并清理反向条目；`addDir`/`unlinkDir` → 防抖全量对齐（仅重解析 mtime 变化者）。
* 全文搜索：仍按正文逐行匹配（按设计不建全文索引，避免 Obsidian 式内存膨胀），但经索引枚举文件（免目录递归），并解除原 80 文件 / 20 命中硬上限，改为软上限（每文件 500 命中、1000 文件）配合 `truncated` 标志提示用户收窄查询。
* 冷启动全量构建放 main 进程，仅初次/重建/损坏时发生一次。

> **为什么不用 SQLite / MiniSearch**：`better-sqlite3` 需要 node-gyp 编译 → 需要 MSVC → 与本机约束直接冲突；MiniSearch 虽纯 JS 但引入后从未接入且会引入全文索引内存开销。统一索引层只存必要元数据、派生反链，契合「无原生编译 + 大数据量不退化」目标。

### 5.6 导出

| 格式             | 方案                                       | 说明                                              |
| -------------- | ---------------------------------------- | ----------------------------------------------- |
| **Markdown**    | 单文件导出 + `getMarkdown()`                    | 支持「内联图片为 base64」或「附带 .assets 文件夹」两种模式           |
| **纯文本**        | `htmlToPlainText(article)`                | 规范化 HTML 取 `<article>` 内层剥离标签，块级换段、实体解码          |
| **HTML**        | 克隆 ProseMirror DOM + 独立 CSS 模板             | **所见即所得导出**——你在编辑器里看到什么，导出的就是什么              |
| **PDF**         | `webContents.printToPDF()`                | Electron 原生能力，无需额外依赖；已加自动目录 / A4 分页控制 / 可选封面页   |
| **LaTeX**       | `src/export/markdownToLatex.ts`           | **纯 TS 零依赖**，不引入 pandoc；公式与代码块原样保留             |
| **Word (docx)** | 手写 OOXML + `jszip`（`src/export/docx.ts`） | 取 `<article>` 内层 → Mermaid `<svg>` 光栅化为 PNG → 拼装 DOCX 包（含 styles/numbering/图片/超链接）；脚注 → `word/footnotes.xml`，正文引用 → `<w:footnoteReference>` |
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
* **图片内联**：`src/export/imageInline.ts` 用 `DOMParser` 解析产物；**`jade-asset://` 引用先解码回绝对路径**（见 §5.4）再内联；其余按**文档所在目录**解析相对路径（玉笺约定：文档同级同名 `.assets`），经 `file:readBase64` 读取后替换 `src`；已是 `data:` / `http(s):` 的跳过。**PDF 强制内联**——它经隐藏窗口加载 `tmpdir` 下的临时 HTML，相对路径图片本就取不到，这是此前 PDF 丢图的根因。
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

#### 5.7.1 列表标记定制：改 Crepe 渲染的真实元素（2026-09-03）

**亮度基线**：`--hue-list-marker` = `--hue-text-2`（暗 / 亮两模式同值），照搬浮块图标
「从暗淡改明亮」的经验——浮块图标由 `on-surface-variant`（text-3）提到 text-2，强调态用 `--hue-accent`。

**作用对象**：Crepe `listItemBlock` 为每个列表项渲染**真实标记元素**，内容由
`defaultListItemBlockConfig.renderLabel` 给出——无序 `'⦿'` / 有序真实序号 / 任务复选框：

```html
<li class="list-item">
  <div class="label-wrapper"><Icon class="label bullet|ordered|checked|unchecked" /></div>
  <div class="children">…</div>
</li>
```

故直接覆盖 `.label-wrapper` / `.label` 的 `color` 与 `svg` 的 `fill`（两种渲染形态都覆盖；
选择器与 Crepe 同特异性、但排在其后故生效），已勾选用 `svg.checked { fill: var(--hue-accent) }`。
取代 Crepe 默认映射到 `--hue-border-subtle`（极暗）的 `--crepe-color-outline`。

⚠️ **两个必避的坑**（详见 `PHASE3-PLAN.md` §4）：
1. 标记**既非原生 `::marker`，也不存在 `li::before`**——改 `::before` 是改了个不渲染的东西，
   表现为「亮度怎么调看起来都一样」。
2. `.checked` class **就长在 svg 自身上**，须写 `svg.checked`；写成 `.checked svg`
   匹配不到任何元素，勾选态静默失效。

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
  后端其余逻辑（按行切分命中、替换回写、原子写）两范围完全共用。IPC 通道 `VAULT_SEARCH` / `VAULT_REPLACE` 与 preload 的 `searchVault / replaceInVault` 签名同步透传 `file`。`SearchOptions` 另含 `regex` 开关，主进程 `buildSearchRegex` 与前端 `buildRegex` 共用，正则模式 query 直接作正则、非法时降级字面量。
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

**版本快照（本地唯一真源，与 `.mdeditor/` 分离；git 化 Phase A + Phase B 均于 2026-08-31 落地）**

* **存储（git 化 Phase A + B）**：main 进程在 vault 根建 `.yujian-history/<path-hash>/`：
  * `<ISO8601>__<note>.md` —— 快照正文（人类可读，**向后兼容旧全量快照**）；
  * `index.json` —— 元数据清单（git reflog 思想），记录 `tags` / `contentHash` / `parent` / `file` / 字数 / 字节数。
  * **内容哈希去重**：`createSnapshot` 算 `sha1(content)`，与任一已有快照哈希相同则**不写新 `.md`，仅新增一条 index 记录**指向同一文件（内容寻址去重，多个提交共享一份 blob）；`deleteSnapshot` 用**引用计数**——仅当无任何其它条目引用同一 `.md` 时才走 `shell.trashItem` 回收站物理删除（绝不 `rm`）。
  * **`parent` 线性血缘链（**同分支内**）**：新快照 `parent` 指向**同分支**的上一条 → 每条分支是独立线性时间轴（无 merge / 无 DAG）；旧的全量 `.md` 在首次读取时经 `migrate()` 自动生成 `index.json` 并按时间排成 `parent` 链，**不丢任何历史数据**；脏条目（`.md` 已被手动删）自动剔除。
  * **轻量草稿分支（Phase B）**：`branch` 字段（主线常量 `MAIN_BRANCH='main'`），`sanitizeBranch` 去空/限长 32；blob 去重**跨分支共享**（不同分支的相同正文共用一份 `.md`，引用计数删除照旧）。向后兼容：Phase A 落盘的 `index.json` 无 `branch`，`readIndex` 读取时统一补 `branch='main'`/`tags=[]`/`parent??null`。
  * `electron/main/snapshots.ts` 提供 `listSnapshots` / `createSnapshot`（写一份，可带备注 + 标签）/ `restoreSnapshot`（**只读返回内容**，不写磁盘）/ `deleteSnapshot` / `setSnapshotTags`（更新命名标签）。
* ⚠️ **时区修复（2026-08-30）**：原 `nowIso()` 用 `toISOString()` 取的是 **UTC** 墙钟，而 `isoToDate()` 把该数字当**本地**时间解析，导致东八区用户存的快照被整差 8 小时。已改为取 `Date` 的本地时区 `getFullYear/getMonth/.../getSeconds` 生成文件名，与解析端一致；渲染端 `SnapshotPanel` 时间戳经 `src/utils/time.ts` 的 `formatDateTime`（同样走本机时区），并加「本机时区：{IANA}」tooltip（`Intl.DateTimeFormat().resolvedOptions().timeZone` 自动取电脑时区，无需硬编码东八区）。**注意**：此前（bug 期）已落盘的快照文件名仍是 UTC 数字，读回会偏 8 小时；新快照已正确，旧快照可在 `.yujian-history/` 手动清理。
* **命名标签（git tag 思想，Phase A）**：`tags[]` 经 `sanitizeTags`（去空/去重/限长 24/限最多 8 个）落库；面板每行内联 chip 增删，顶部按全部标签筛选；`SnapshotInfo` 增补 `tags?` / `contentHash?` / `parent?`。
* **任意两点对比（git diff A B 思想，Phase A）**：`SnapshotPanel.vue` 每行带 A / B 小按钮，选两份即 `diffLines(快照A, 快照B)` 摊平逐行 add/del/ctx 预览；保留旧"选中快照 vs 当前稿"对比（`diffMode` 区分 `'ab'` / `'selected'` / `'none'`）。
* **时间轴 / 血缘视图（Phase B）**：面板头部「列表 / 时间轴」视图切换（`.vbtn`）；时间轴为竖直提交图——每行左侧血缘导轨（1px 竖线串联 + 8px 节点圆点），**打了标签的快照视为里程碑**（圆点实心强调色 + 青瓷外环），列表按时间倒序（最新在上），首/末行竖线不冒头。时间轴模式面板加宽至 440px（`.snap--tl`）。
* **段落级 cherry-pick（Phase C，UI 已打磨）**：diff 预览按「变更段」聚合成 hunk（相邻变更合并 + ±1 行上下文 + 边界不重叠），每个 hunk 头部标「新增/删除/修改」kind 标签（配 plus/minus/writing 图标）+ GitHub 风格行号范围 `@@ -o,s +n,s @@` + 「摘取」按钮（`snapshotPick`）；diff 头部标注**摘取来源**（快照备注或 B 侧），并提供**统一 / 并排**切换（并排即 GitHub split：左旧右新、del+add 配对、ctx 两侧对齐，面板加宽至 580px）。内联着色沿用 Google Docs 风格（add 绿底+`+` 槽、del 红底+`−` 槽、ctx 灰底+`·` 槽），摘取后整块短暂高亮 + 「已摘取」微态。摘取把该段**对比方（旧版/B）侧**内容经 `App.vue→EditorHost.insertText→MilkdownEditor.insertMarkdownAtCursor` 插入当前文档光标处；所见即所得下用 `parserCtx` 解析为 ProseMirror 节点再 `tr.insert`（语法正确渲染），失败兜底整篇重灌追加。`SnapshotPanel` 经 `@pick` 向 `App.vue` 发文本，`onSnapshotPick` 调 `host.insertText` + toast。
* **分支 UI（Phase B）**：分支 chips（分支名 + 份数）+「+ 另起草稿」内联输入，以**当前正文** Fork 出独立时间轴；同名分支只切换不重建；保存快照写入当前分支；标签筛选作用域 = 当前分支；草稿分支下「恢复」语义变为**「采纳到主稿」**（载入编辑器成为正文并自动切回主线），右键菜单同步；切分支清掉不在该分支的选中项；A↔B 对比**允许跨分支**。未做「删除整个分支」——删净分支内快照即自然消失，规避批量删除。
* IPC：通道 `snapshot:list` / `snapshot:create` / `snapshot:restore` / `snapshot:delete` / `snapshot:setTags`（Phase A 新增）在 `electron/shared/ipc-channels.ts` 集中定义；preload 暴露 `window.api.snapshotList/Create/Restore/Delete/SetTags`（类型自动派生）；`main/index.ts` 注册对应 handler。**Phase B 未新增通道**——分支清单由列表派生；同时修正 preload 与 main handler 此前会**丢弃 `tags`** 的缺陷，现 `note/tags/branch` 三参全链路透传。
* 前端：`src/store/snapshots.ts`（Pinia，**只缓存当前文档的快照列表，不持有内容**；`setTags`；Phase B 增 `activeBranch` / `branches`（派生，主线恒排最前）/ `branchList`，`refresh` 兜底回落主线）；玻璃 `SnapshotPanel.vue`（现**停靠于右列底部块**，与大纲上下并列）：入口为**左缘活动栏「快照」按钮**，打开时经 `App.rightBottom='snapshot'` 触发 `snapshots.refresh` 拉取（与左列库级面板独立、可同时开）：视图切换、分支 chips、备注输入 + 保存、标签筛选 chips、A↔B 任意两点对比、标签 chips 内联增删、左侧时间 + 备注 + 字数差 `deltaChars`、选中→`snapshotRestore` 只读返回→行级 diff 预览、右下恢复/删除 + 右键 `ContextMenu`（restore/delete danger）、空态文案。恢复走 `EditorHost.loadMarkdownExternal`（灌入 + 标 dirty + 自动保存），**不立即覆盖磁盘原文**（守 §5.2 保真红线）。
* 行级 diff 库选型修正：原计划写 `jsdiff`，但 `jsdiff@1.1.1` 实为「JSON 对象 diff」库（装配错误）；正确库是 `diff@^7.0.0`（`diffLines`），已在 `package.json` 落地，`jsdiff` 已卸载；无类型的 `diff@7` 在 `src/types/diff.d.ts` 补了环境声明。
* 自动快照策略（防抖保存 + 定时）已留接口；批次二先落地「手动留档 + 行级 diff 预览 + 回滚」闭环，自动策略在后续打磨中接入同一 `snapshotCreate`。
* ✅ **状态：已于 2026-08-30 由用户运行期验证可用**（基础留档/看 diff/恢复/删除），**git 化 Phase A（标签/任意两点对比/哈希去重/index 元数据/向后兼容迁移）、Phase B（时间轴血缘视图/轻量草稿分支）、Phase C（段落级 cherry-pick）均于 2026-08-31 落地**（typecheck + build 通过，待用户运行期验收）。原「⚠ 实现但未测试」标注已从 `SnapshotPanel.vue` 代码注释、面板 UI 横幅与本小节移除。

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

* 四幕进场 ~360ms：① 侧栏/大纲宽→0+淡出（0–100ms，复用 `is-collapsed`，App 传 `visible && !focusMode`）② 标题栏 `.bar`/标签条 `.tabbar`/状态栏 `.statusbar` 高→0（80–200ms）③ 正文列变宽（`--w-column → --w-column-zen`，随窗口等比例更宽，180–300ms，`@property` 注册长度变量使全部块联动、一次样式重算）④ `.editor::before/::after` 上下 48px 羽化遮罩 + 装饰淡入（280ms 起）。常态列 `clamp(700px,56vw,920px)`、凝神列 `clamp(760px,62vw,1000px)`（`src/styles/tokens.css`）。
* 退场 240ms 三幕反向（`:not([data-zen])` 基态规则承载退场时序——transition 取目标态规则，进退场各自独立时序）。`prefers-reduced-motion` 全部降为 0ms 直接切换。

**雾化五档（`src/editor/zen.ts` + `editor.css`）**

* `buildDecorations` 按**文本块距**生成 `.zen-active` / `.zen-dim-1..5`：按文档序遍历**全部文本块**（含列表项 / 引用 / 表格单元格内的嵌套文本块，距离 = 与当前文本块之间隔了几个文本块），类只挂文本块与顶层叶块（图 / 分割线 / mermaid 按「其前的文本块数」计距）——长列表 / 长表格内部逐块淡出，容器本身不挂类，无透明度复合叠加；容器视觉元素（表格网格 / 引用竖线 / 列表圆点）保持满透明度（结构保留、文字退后）。档位由根节点 `--fog-1..5` CSS 变量承载（快 `[.45,.28,.2,.17,.16]` / 中 `[.55,.38,.28,.22,.18]` / 慢 `[.66,.5,.4,.32,.26]`），换档只改变量。只用 opacity（拒绝逐块 blur）；当前文本块青瓷微光底衬替代被否决的「光标闪烁频率」。

**纸卷滚动（lerp）**

* `centerZenLine` 改为 rAF lerp 追随：只在「脏」（选区/文档变化，plugin `view.update` 判定）时拉锚，收敛即停——滚轮浏览不被抢滚动条；单帧限幅 120px（粘贴大段匀速补偿、缓出刹住）；开启凝神后延迟 320ms 再拉锚，避开布局动画。锚点/平滑度参数来自偏好。

**轻退栏 + 设置面板 + 偏好**

* `ZenRetreatBar.vue`：32px 玻璃胶囊（`position:fixed` 不占布局），文件名 · 字数 · 相对保存时间（30s 自刷新）｜⚙ 设置 / 切换文档（复用标签激活）/ 退出凝神。Esc 状态机在 `App.onKeydown`（设置面板优先、轻退栏可关）。
* `ZenSettings.vue`：玻璃模态，锚点（1/3·黄金分割·正中）/ 雾化（快中慢）/ 滚动（跟手·平滑·极平滑）/ 自动全屏 / 轻退栏，改即生效并 `patchSession({ zenPrefs })`。`SessionState.zenPrefs` 经 `session.ts sanitizeZenPrefs` 逐字段校验。设置入口：轻退栏 ⚙ + 标题栏「更多」菜单（`zen-settings`）。
* 凝神下源码模式居中列：`.shell[data-zen] .source-host .cm-scroller` 对称内边距 `max(0, 50% − var(--w-column-zen)/2)`，行号 + 代码整体收进居中列（列宽 = `--w-column-zen`，随窗口等比例更宽；行号随列移动），修复 CodeMirror 宽窗整屏贴左。常态源码模式也走居中列（`max(24px, 50% − var(--w-column)/2)`，见 `editor.css`）。
* 凝神当前块视觉焦点：`.zen-active` 在开启「放大当前段落」开关时字号 `1.07em` + `scale(1.01)`（青瓷微光底衬保留），离开时由 `.zen-dim-*` 过渡平滑回弹；开关经 `ZenPrefs.blockZoom` 持久化、`App` 根节点 `data-zen-block-zoom` 属性门控。
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

### 5.14 Phase 3 批次一：数据安全与完整性（2026-09-01，已落地）

> 对应 `docs/PHASE3-PLAN.md` 批次一。Obsidian 恰恰缺 vault 级完整性保障，本批次补上「自检 / 备份 / 冲突 / 表格压测」四块信任基础。

**A. vault 级完整性自检（`electron/main/vaultIntegrity.ts`）**

* `scanIntegrity(root, opts?)`：并行扫描五类问题，按严重度分组——
  * `indexDrift`：索引层记录 vs 磁盘实际（`vaultIndex.ts` 的 `meta` 与 `existsSync` / `mtime` 比对），外部改动未刷入或索引条目悬空；
  * `orphanSnapshots`：`.yujian-history/` 下无对应源文件、或源已移动/删除的快照；
  * `missingAssets`：文档里 `![]()` / `[[wikilink]]` 指向但磁盘不存在的资源（与 `checkLinks` 同源但聚焦「资源文件缺失」）；
  * `brokenLinks`：复用 `vault.ts:checkLinks` 的断链结果，并入报告；
  * `emptyIndex`：索引缺失 / 损坏 / 版本不符（此时应静默重建，绝不弹错）。
* 报告结构 `IntegrityReport { groups: { kind, label, items[], fixable }[], total }`，`IntegrityItem { file, detail, fix? }`。
* 一键修复 `repairIntegrity(root, report)`：仅对 `fixable` 项动作——重建索引（`VAULT_INDEX_REBUILD`）、清理孤儿快照（回收站 `shell.trashItem`，绝不 `rm`）、空索引走静默重建；**绝不**自动改写用户文档原文（守 §5.2 红线）。
* IPC：`vault:integrityScan` / `vault:integrityRepair`，preload 暴露 `window.api.scanIntegrity / repairIntegrity`；面板 `src/components/IntegrityPanel.vue`（玻璃浮层，入口：标题栏「更多 ⌄ · 完整性检查」、状态栏告警 chip 点击）。

**B. 整库备份与恢复（`electron/main/vaultBackup.ts`）**

* `backupVault(root, zipPath)`：用 `jszip`（已依赖，导出管线同款）把整个 vault 打包——含 `.md`、`.assets/`、`.mdeditor/` 索引、`.yujian-history/` 快照；跳过 `node_modules` 等大目录。原子写（`tmp + rename`）。
* `restoreVault(zipPath, root)`：解包前校验 zip 结构（必须含至少一个 `.md` 或已知 vault 目录）；解包到 `root`，**先整库快照**以防恢复覆盖后无法回退（恢复是危险操作，UI 弹确认）。
* 与单文件快照（`.yujian-history/`）互补：快照是「文件内版本时间轴」，备份是「整库某一刻的归档」。
* IPC：`vault:backup` / `vault:restore`，preload `window.api.backupVault / restoreVault`；面板 `src/components/BackupPanel.vue`（玻璃浮层，入口：标题栏「更多 ⌄ · 整库备份」）。

**C. 外部修改冲突策略（`App.vue` 的 `onVaultChange`，`src/components/ConflictDialog.vue`）**

* 触发：`watchVault` 的 `change` 命中**当前正在编辑**的文档，且磁盘内容 ≠ 内存内容（归一化 CRLF/LF 后比较）。
* **绝不静默覆盖**：弹出三选一对照对话框——
  * 保留我的（`host.save()`，把内存内容写回）；
  * 采用磁盘（`host.load()`，重新从磁盘载入）；
  * 双方对照（另存一份 `.mine` 副本到文件旁，再 `host.load()` 加载磁盘版，原稿不丢）。
* 防误伤：① 检测时先 `EditorHost.cancelPendingSave()` 取消 800ms 待定自动保存，避免咱的自动保存把外部改动冲掉；② 自身保存回显（磁盘 === 内存）忽略；③ 写入后 5 秒 `conflictSuppressUntil` 窗口内抑制重复弹窗。
* 对话框用 LCS 差异把「我的 / 磁盘」切成行级增删片段并排展示，显示双方字数 + 磁盘修改时间（`FILE_STAT` 通道）。

**D. 表格稳定性压测（`scripts/stress-table.mjs`，`node scripts/stress-table.mjs`）**

* 压测 remark-gfm 序列化层（编辑器 to-markdown 同一底层），19 项用例：往返幂等、增/删行、增/删列、合并列、200 次随机突变序列往返稳定、对齐信息保留。
* 动机：Obsidian 有「表格反复操作损坏」的实证先例（见 `docs/PRODUCT-POLISH-IDEAS.md`）。本压测已全绿（19/19），确认玉笺表格经序列化层不丢列 / 不丢行 / 不乱码 / 不自激振荡。

### 5.15 Phase 3 批次二：双向链接与反链面板（2026-09-02，已落地）

> 对应 `docs/PHASE3-PLAN.md` 批次二。PKM 最高杠杆能力——`[[wikilink]]` 在编辑区内即真节点，点击即跳转 / 一键创建，反链面板实时呈现「谁链接到我」。

**A. 编辑器内真节点（`src/editor/features/wikilink.ts`）**

* `remarkWikilink`（$remark）：递归改写正文文本里的 `[[...]]` 为自定义 mdast 节点 `wikiLink`（拆 `目标` / `别名|` / `#锚点`）。
* `wikiLinkSchema`（$nodeSchema）：行内原子节点 → `toDOM` 渲染 `.yj-wikilink > .yj-wikilink__label`（玉质药丸芯片，`src/styles/editor.css`）；`toMarkdown` handler **原样输出** `[[target]]` / `[[target|alias]]` / `[[target#anchor]]` / `[[target#anchor|alias]]`（守 §5.2 往返保真红线 4/6，绝不用装饰 + 导出后处理；锚点曾在此被丢弃，2026-09-10 修复并由 `npm test` D 段守护）。
* `wikiLinkInputRule`（$inputRule）：敲完 `]]` 即刻把 `[[目标]]` 转成节点（否则当下敲了没反应）。
* `MilkdownEditor` 注册三者，并在宿主 click 上侦测 `span[data-type="wiki_link"]`，`preventDefault` 后 `emit('wikilink', { target, anchor })`；`EditorHost` 透传至 `App`。

**B. 跳转 / 一键创建（`App.onWikilink`）**

* `resolveWikiTarget(root, target)`（IPC `vault:resolveWikilink`）经统一索引的 `byBase`/`byRel` 路径映射解析目标绝对路径；支持文件名或相对路径、忽略 `.md`、忽略 `./`。
* 目标存在 → `openPath(resolved)` 打开；不存在 → `createDoc(root, baseName(target))` 一键创建并打开（PHASE3 需求：missing → one-click create），toast 提示 `wikilinkCreated`。

**C. 反链面板（`src/components/BacklinksPanel.vue`）**

* 玻璃面板，现**停靠于右列底部块**（与大纲上下并列）：入口为**左缘活动栏（`src/components/ActivityBar.vue`）「反链」按钮**（`Icon` 新增 `backlink` 三节点图标）。左右两列各自独立、可同时开（如左列标签 + 右列反链同屏），不再互斥。
* 消费索引已派生的 `backLinks`，经 `getBacklinksWithContext(root, absPath)`（IPC `vault:getBacklinks`）抽出每条来源笔记的**引用行 + 上下文片段**（`BacklinkItem { path, line, snippet }`）。
* 列表行展示来源文件名 / 行号 / 引用片段，点击 → `onOpenResult`（复用搜索跳转，打开并 `revealLine`）。
* 切文档 / 重命名 / 删除后随 watcher 刷新索引，面板 `watch(activePath)` 静默刷新；无库 / 无打开文档 / 空反链均有温和空态。

**D. 索引消费（无新增索引层）**：批次零的 `vaultIndex.ts` 已派生 `backLinks`（目标 → 来源绝对路径集），本批次仅新增查询函数与 IPC，沿用既有的 `ensureIndex` 静默重建契约。

**E. 批次二三项收尾（2026-09-02 同日补齐）**

* **`[[` 自动补全浮层**：`src/editor/features/wikilinkSuggest.ts` 的 `$prose` 插件只做「判定触发 + 报视口坐标 + 拦截 ↑↓/Enter/Tab/Esc」（零 DOM 依赖，与 find-wysiwyg 同源分层）；`src/components/WikiSuggest.vue` 玻璃浮层挂 `body` 下 `position:fixed` 避 `.milkdown-host` 的 `overflow:hidden` 裁切。`MilkdownEditor` 经 `listNotes`（IPC `vault:listNotes`，消费索引 `listNoteTitles` 的纯元数据）拉候选，前缀命中优先于包含命中，选中即把 `[[查询词` 替换成 wikilink 真节点（光标落节点后）；Esc 同一次输入内不再弹回。
* **未链接提及一键包裹**：`getUnlinkedMentions`（IPC `vault:unlinkedMentions`）回读正文扫词，跳过围栏代码块 / 行内代码 / 已成链的 `[[...]]`，软上限 200；`wrapUnlinkedMention`（IPC `vault:wrapMention`）写回前按 `start/end` 回验原文（`line.slice(start,end)===name`），原文已变则返回 `false`、不写坏内容（守批次一「绝不静默覆盖」红线）。反链面板新增「未链接提及」分组 + 每行「包裹成链接」按钮，包裹成功后反链与未链接两分组自洽刷新。
* **断链面板「一键创建」**：`LinkCheckPanel` 每条断链新增创建按钮 → `App.onCreateBrokenLink`：目标带路径（`folder/Note`）建在 vault 对应子目录、裸名建在来源笔记所在目录（保持目录内聚），`createDoc` 创建并打开后刷新列表。

***

### 5.16 Phase 3 批次三（一）：#标签 内联语法 + 标签聚合面板（2026-09-03，已落地）

> 对应 `docs/PHASE3-PLAN.md` 批次三。PKM 第二条杠杆——正文写 `#标签` 即真节点，与 frontmatter `tags` 双轨聚合；标签面板浏览标签树、钻取旗下笔记。MOC 与关系图谱见批次三（二）。

**A. 编辑器内真节点（`src/editor/features/tag.ts`）**

* `remarkTag`（$remark）：递归改写正文文本里的 `#标签` 为自定义 mdast 节点 `tag`（代码块 / 行内代码无 text 子节点，天然不命中）。
* `tagSchema`（$nodeSchema）：行内原子节点 → `toDOM` 渲染 `.yj-tag > .yj-tag__hash(#) + .yj-tag__label(名)`（玉质药丸，中性色，与 wikilink 同族但不用 accent——「分类」而非「导航」）；`toMarkdown` handler **原样输出** `#标签`（守 §5.2 往返保真红线）。
* `tagInputRule`（$inputRule）：标签无闭合定界符，以「标签后的空白」为结束信号，敲空格即刻转节点。
* 语法 `#标签` / `#父/子`（嵌套）；与标题 `# 标题` / `## 标题` 区分（`#` 后须紧跟非空白非 `#` 字符）。中文无词边界，标签延伸到空白 / 标点 / 行尾（与 Obsidian 同，彻底分词属批次四）。

**B. 索引采集（双轨合并，`electron/main/vaultIndex.ts`）**

* `extractInlineTags(content)`：裸文本扫描，正则与 `tag.ts` 的 `buildTagRe` 完全一致（保证「索引采集 = 编辑器显示」）；`#` 在代码里极常见（CSS `#id`、Python `# 注释`），故先剥 frontmatter / 围栏代码块 / 行内代码再扫。
* `parseFile` 把内联标签与 `parseFrontmatter` 的 `fm.tags` 合并去重（统一转小写 key），写入既有 `IndexEntry.tags`（无新增索引结构）。

**C. 标签面板（`src/components/TagPanel.vue`）**

* 玻璃面板，现**停靠于左列底部块**（与目录上下并列）：入口为**左缘活动栏「标签」按钮**（`Icon` 新增 `tag` 书签图标 + `chevron-right` 箭头）。与内容地图切换显示（同属左列底部块），与右列文档级面板独立、可同时开。
* 两视图：`browse`（标签树，按 `/` 嵌套、可展开/折叠、可过滤）→ 点击标签名钻入 `notes`（面包屑 `全部标签 / 父 / 子` + 该标签及全部子标签旗下笔记列表，点击打开）。
* 设计令牌（见 `docs/PHASE3-UI-DESIGN.md` §4.2）：标签项 28px，标签名渲染为玉质药丸芯片 `TagChip`（中性玉色渐变 + 1px 玉色描边 + 5px 圆角，`#` 走 `--hue-text-3`、标签名走 `--hue-text-1`，与编辑器内联 `.yj-tag__label` 同族）；嵌套缩进每级 14px；选中态 `--hue-active` 底 + 左侧 2px accent 竖条；计数徽标 `min-width:20px` 钉死居中并推至右缘对齐；`role=tree/treeitem` + `aria-expanded`。
* **实时刷新（2026-09-04 修复）**：面板挂载时订阅 `window.api.onVaultChange`（preload 现返回取消订阅句柄，卸载时清理避免泄漏）；库内任意改动（正文加 `#标签`、重命名等）经 250ms 防抖后自动重拉 `listTags`，杜绝「明明加了标签面板却没动」的割裂感。
* **重建索引兜底**：底部「重建索引」按钮（`window.api.rebuildIndex`，IPC `vault:indexRebuild`）走统一索引层 `buildIndex` + `saveIndex`，完成后自刷新并通知 App 弹 toast；防陈旧缓存兜底。

**D. 聚合 API（由索引派生，不存原始图）**

* `listTags(root)`（IPC `vault:listTags`）：统计每枚标签命中文件数，按 `/` 推导父级与深度，返回 `TagItem { name, count, parent, depth }`（前端据此在面板构建嵌套树）。
* `getNotesByTag(root, tag)`（IPC `vault:getNotesByTag`）：返回该标签及全部子标签旗下笔记 `TagNoteItem { path, title, base }`（父标签含子标签语义）。
* **聚合一律走 watcher 维护的实时内存索引**（`vault.ts` 的 `getLiveIndex`，IPC 处理器改为 `VaultIndex.<fn>(root, await getLiveIndex(root))`）：此前四函数内部 `ensureIndex` 每次回读磁盘 JSON，而磁盘快照有 800ms 防抖落盘延迟，会导致面板读到陈旧数据、看似不刷新。改为消费内存索引后，编辑保存（watcher 即时 `indexFile` 增量更新）与面板读取零延迟同步。四函数保留 `liveIndex?` 可选参数，未传时仍走 `ensureIndex` 兜底（向后兼容）。
* 三进程均经既有 IPC + preload 通道暴露；无新增索引层字段。

***

### 5.17 Phase 3 批次三（二·上）：内容地图 MOC（2026-09-03，已落地）

> 对应 `docs/PHASE3-PLAN.md` 批次三。PKM 主题入口——任意笔记标为 MOC（frontmatter `moc: true`）后，打开即按「自身每枚标签 / 本图链出 / 挂到本图」三组自动聚合下级笔记，作为主题枢纽。关系图谱见批次三（二·下）。

**A. 索引标记（`electron/main/vaultIndex.ts`）**

* `parseFrontmatter` 在解析 `title` / `tags` 的同一处新增解析 `moc` 字段（YAML 真值判定：`true`/`yes`/`on`/`1` 及其字符串形态），写入 `IndexEntry.moc: boolean`。
* `INDEX_VERSION` 由 1 升 2：**v2 语义变更**——`tags` 现包含正文内联 `#标签`（此前仅 frontmatter），且新增 `moc` 标记；旧版缓存（仅 frontmatter tags、无 moc）会被版本门槛强制重建，否则未改动文件的 `tags`/`moc` 永不被采集（潜伏 bug）。
* 索引仍只存轻量元数据、不缓存正文、不索引全文（守索引铁律）。

**B. 聚合 API（由索引派生，不存原始图）**

* `listMocs(root)`（IPC `vault:listMocs`）：枚举 `entry.moc === true` 的文档，返回 `MocItem { path, title, base, tags }`（全库 MOC 清单，供非 MOC 文档跳转）。
* `getMocOutline(root, path)`（IPC `vault:getMocOutline`）：以 `path` 自身为锚，产出三组 `MocGroup { kind: 'tag'|'outlinks'|'backlinks', tag, notes, truncated }`：
  * `tag`：按自身每枚 `entry.tags` 分组建组，父标签含子标签语义（`t === key || t.startsWith(key + '/')`，与 `getNotesByTag` 一致）；
  * `outlinks`：自身 `outLinks` 指向的文档；
  * `backlinks`：索引派生 `backLinks[path]` 指向本篇的文档。
  * 三组均排除自身、去重、按标题排序；单组软上限 `MAX_MOC_GROUP = 200`，超出置 `truncated: true`（前端提示「条目过多，仅显示前 200 条」）。

**C. 内容地图面板（`src/components/MocPanel.vue`）**

* 玻璃面板，现**停靠于左列底部块**（与目录上下并列）：入口为**左缘活动栏「内容地图(MOC)」按钮**（`Icon` 新增 `map` 图标）。与标签切换显示（同属左列底部块），与右列文档级面板独立、可同时开。
* **一键标记 / 取消标记（2026-09-04 修复，关键可用性）**：面板头部常驻「标记为内容地图 / 取消标记」按钮（`emit('toggle-moc')` → `App.onToggleMoc` 读 `host.getMarkdown()` → `parseFrontmatter` 切 `data.moc` → `serializeFrontmatter` 回写 → `host.loadMarkdownExternal` 落盘）。此前「把笔记变成 MOC」的入口深埋在写作辅助 · 属性面板底部复选框，用户根本发现不了，导致库内 `moc: true` 长期为 0、MOC 面板永远空。现在在 MOC 面板内即可就地操作。
* 两种状态：
  * 当前文档是 MOC（`mocs` 清单含 `activePath`）→ 按上述三组分区渲染，每组可折叠（twisty `chevron-right` 旋转 90°）、计数徽标 `min-width` 钉死居中（动态布局铁律 #2）、`truncated` 提示；点击笔记 → `onOpenResult` 打开。
  * 当前文档不是 MOC → 顶部 `info` 引导「点击下方按钮把本篇标成 MOC」，下列全库 `MocItem` 清单可跳转。
* **实时刷新（2026-09-04 修复）**：挂载时订阅 `onVaultChange`（250ms 防抖）重拉 `listMocs` + `getMocOutline`，正文加 `#标签` 或切 MOC 标记后即时重聚合；切换文档 `watch(activePath)` 同样重聚合。
* **重建索引兜底**：底部「重建索引」按钮（`window.api.rebuildIndex`）走统一索引层，完成后自刷新 + App toast。
* 无库 / 未打开文档 / 空 MOC 均有温和空态。
* （保留）写作辅助面板仍提供 `moc` 复选框（`src/components/WritingAidsPanel.vue`，与 `tags` 同源）作为另一入口；两条路径等价，均经 watcher 自动重建索引。

***

### 5.18 安装即自带《使用说明》（欢迎文档播种）

> 对应需求：用户安装软件后，笔记库应默认自带一份详尽的使用说明。

* **规范源文件**：`resources/使用说明.md`（与用户笔记库内的 `使用说明.md` 同源、内容一致），随包发布——`package.json` 的 electron-builder `build.extraResources` 把 `resources/` 复制到安装包的 `resources/` 目录（`process.resourcesPath/resources/使用说明.md`）。
* **播种时机**：主进程 `electron/main/index.ts` 的 `VAULT_WATCH` 处理器在建立库监听后，**异步**调用 `seedWelcomeDoc(root)`。
* **播种规则（克制、尊重用户）**：
  * 仅当库根目录**不存在** `使用说明.md` **且没有任何** `.md`/`.markdown` 笔记（即全新空库）时才写入；
  * 已有笔记的文件夹（如用户的旧库）**不污染**；用户删掉的《使用说明》**不会被重新塞回**；
  * 源文件按 `process.resourcesPath/resources/使用说明.md`（生产） → `app.getAppPath()/resources/使用说明.md`（开发预览）顺序探测，缺失则静默跳过。
* 播种失败（权限/路径异常）整体 `try/catch` 吞掉，**绝不影响正常打开库**。

***

### 5.19 默认字体：Maple Mono（2026-09-04）

* 软件默认字体由 CSS 变量 `--font-ui` / `--font-mono`（`src/styles/tokens.css`）控制；二者首位均改为 `'Maple Mono'`，回退链保留原系统字体与 `Sarasa Mono SC`（中文缩进兜底）。
* 字体族名取自 TTF 内部 `family_name`：`Maple Mono`（文件名为 `MapleMono-NF-CN-*.ttf`，含中文与 Nerd Font 符号）。
* 引入方式：`src/styles/fonts.css` 以 `@font-face` 声明核心 6 款字重（Regular/Medium/SemiBold/Bold + Italic/BoldItalic），经 `main.ts` 在最前 import；Vite 把 TTF 打进 `out/renderer/assets`。
* **特殊效果字体分级策略**（2026-09-04 细化）：改默认字体后，对「特殊格式」按「能否改用 Maple Mono」做了分级——
  * ✅ 自动继承：表格/引用/正文/标注/frontmatter（`--font-ui`）——两个根令牌带头 Maple Mono 后已自动生效，无需额外改动。
  * ✅ **标题（H1–H6）改用 Maple Mono**：踩坑点——Crepe 用独立令牌 `--crepe-font-title`（各主题默认 `Georgia` 衬线）渲染标题，绕过了我们的 `--font-ui`；我们原本只在 `.milkdown .ProseMirror` 显式设了 body 字体，标题无声明 → 落到 Crepe 衬线默认（即用户目测「H1 往下仍是旧字体」的根因）。已在 `src/styles/editor.css` 的 `.milkdown` 块把 `--crepe-font-title` / `--crepe-font-default` / `--crepe-font-code` 一并重映射为 `--font-ui` / `--font-mono`，与旁边 `--crepe-color-*` 重映射同套路，一处收口；构建产物已含 `--crepe-font-title: var(--font-ui)`。
  * ✅ **代码块 / 源码模式改用 Maple Mono**：CodeMirror 基础主题（`@codemirror/view`）给 `.cm-content` 注入 `font-family: monospace`（写死在 `node_modules/@codemirror/view/dist/index.js`），特异性压过对 `.cm-editor` 的继承，导致代码被钉成系统等宽；源码模式此前只给 `.cm-scroller` 设 `--font-mono` 也无效（字体实际设在 `.cm-content` 上）。已在 `editor.css` 用更高特异性 `.milkdown .milkdown-code-block .cm-content/.cm-line` 与 `.source-host .cm-editor .cm-content/.cm-line` 强制 `var(--font-mono)` 覆盖。行内代码 `.milkdown .ProseMirror code` 本就走 `--font-mono`、不进 CodeMirror，不受影响。
  * ✅ 已改为 Maple Mono：**Mermaid 图**。其文字由 mermaid 库按 `fontFamily` 配置渲染，原先用默认 `trebuchet ms`；现于三处 `mermaid.initialize` 统一设 `fontFamily: "'Maple Mono', ui-monospace, 'Sarasa Mono SC', Consolas, monospace"`（Editor 预览 `features/mermaid.ts`、离线导出 SVG `export/mermaidSvg.ts`、HTML 导出 CDN `export/docTemplate.ts`），与编辑器其余特殊格式观感一致。
  * ❌ 保持原样：**数学公式（MathJax）**——渲染为自包含 SVG 字形路径，字体是 MathJax 内部字形，与 CSS 字体无关，强行换会破坏公式；**图标**——`Icon.vue` 内联 SVG 路径（Lucide），非文字字体。二者均不动。
  * ⚠️ 导出文档正文/代码字体（`docTemplate.ts`/`epub.ts` 用 Noto Sans SC / Sarasa Mono SC）属「跨机器可读性 vs 品牌一致性」取舍，暂维持可读性优先，未强制改 Maple Mono（详见 §5.19 待确认项）。
* 取舍：全家族 18 款约 370MB，仅打包常用的 6 款（约 123MB）；若需更细字重（Thin/Light/ExtraBold）再补 `@font-face` 与 TTF 即可。

### 5.20 侧栏文件树：以人为本的自然排序（2026-09-04）

* **问题（两轮迭代）**：原 `scan`（`electron/main/vault.ts`）用 `name.localeCompare(name, 'zh-Hans-CN')` 排序，但 `localeCompare` 默认**不按数值比较**，导致「第10章」排到「第2章」前、「file10」压「file9」之上（字典序反人类）。第一轮修成 `Intl.Collator(numeric:true)` 后，阿拉伯数字已正确，但用户实测发现**中文数字词「第一章/第五章/第七章」仍按拼音排**（七 qī、五 wǔ、一 yī），因为 `numeric:true` 只认阿拉伯数字串、对中文数字词无感。
* **方案（中文章节感知的自然排序）**：`humanCompare` 改为「token 化 + 中文数字解析」——把字符串拆成片段，数值段（阿拉伯数字串 **与** 中文数字词「一/五/七/十/百/千/万/亿…」）按数值比较，文字段按语种（`Intl.Collator('zh-Hans-CN', { sensitivity:'base' })`）比较。配套的 `parseCnNumber` 用数位累乘解析中文数字（覆盖「一十」「二十」「一千二百三十四」「一亿二千万」等）。效果与系统文件管理器一致且补齐中文数字短板：
  * 阿拉伯数字按**数值**：「第2章」<「第10章」、`file9` < `file10`；
  * 中文数字词按**数值**：「第一章」<「第五章」<「第七章」<「第十章」<「第十一章」<「第二十章」；
  * 二者混排可互比（「第1章」与「第一章」同值并列，稳定）；
  * 文字段按拼音 / 字母、忽略大小写（`Apple` = `apple`）；
  * 仍保持**文件夹优先于文件**（类型短路判断不变）。
* 设计依据（网络调研）：MDN 与多篇博客、开源库 `chinese_number_to_digits` 一致指出 `Intl.Collator` 的 `numeric` 仅处理阿拉伯数字，中文章节排序需先把中文数字转阿拉伯数值再自然排序。
* 排序是主进程 `scan` 的唯一来源；前端 `FileTree.vue` / `Sidebar.vue` 直接渲染已排好序的 `node.children`，无二次排序，改一处全收口。

***

### 5.21 重命名 / 移动自动更新 `[[引用]]`（2026-09-10）

> 对应 `docs/PHASE3-PLAN.md` 批次二「已决策」。此前默认立场是「不自动改写、只报断链」，现按用户决策改为**自动更新**——PKM 里改名 / 搬家若留下一地断链，双链网络会迅速失效。

**A. 纯逻辑（`vaultIndex.ts`，可在 Node 单测）**

* `rewriteWikiLinksInText(content, resolve, newTargetOf)`：逐条 `[[...]]` 拆 `target` / `#锚点` / `|别名`，**只替换 target 片段**，锚点与别名原样保留；断链（`resolve` 返回 `null`）一律不动；新写法与旧写法相同时不计数、不改动；其余正文逐字节保留（含 CRLF）。
* `rewriteLinksForMoves(root, index, moves)`：fs 层编排。受影响来源直接取索引已派生的 `backLinks`（**零额外全库扫描**），只读命中文件；单文件写失败不影响其余（与 `replaceInVault` 同款容错）。返回 `{ sources, files, links }`，`sources` 已按新位置计算。
* 形态保持：原目标含 `/` 视为路径式 → 写新相对路径；否则写新基名。`./` 前缀与 `.md` / `.markdown` 后缀写法一并保留。
* 路径映射复用：新增 `resolveTargetWithMaps(maps, target)`（与 `resolveTarget` 同语义但**不重建映射**），并删掉一份与 `buildPathMaps` 重复的 `buildIndexPathMaps`。

**B. 收口与顺序铁律（`vault.ts`）**

* `rewriteLinksThenRefreshIndex(moves)`：先改写、再刷新索引，**顺序不可换**——改写必须在「磁盘已迁移、索引仍是旧路径」的窗口内进行，否则 `[[旧基名]]` 已解析不到旧绝对路径。
* `refreshIndexAfterMove(root, moves, sources)`：移除旧条目 → 用「含新路径」的映射登记新条目 → 重解析被改写的来源；只动受影响条目，**不触发全库 reconcile**。
* 接入点：`renameItem`（文件 / 文件夹）与 `moveItem`（跨目录）；同目录移动降级为 `renameItem` 从而天然覆盖。目录移动展开为「逐篇文档」的 `MovePair`，来源自身也在移动之列时按新路径读写。
* IPC 返回类型由 `string` 改为 `MoveResult { path, filesUpdated, linksUpdated }`；渲染层在 `linksUpdated > 0` 时提示「已同步更新 N 处引用」（移动成功另复用 `moveDone` 提示）。

**C. 顺带修复**

* `reindexFile` / `deindexFile` 现在会在**文件集变化**时使路径映射失效——此前外部改名后 `byBase` 映射陈旧，新笔记名解析不到、反链会漏。
* `wikilink.ts` 的 `toMarkdown` 此前**丢弃 `#锚点`**（`[[A#小节]]` 存盘退化成 `[[A]]`，属不可逆数据丢失），已修复并由 `npm test` D 段守护。

***

### 5.22 自动化测试与门禁（2026-09-10）

> 背景：项目长期只有 `typecheck` + `lint` 两道德性门禁与一个 `verify:md` 脚本，**没有任何测试套件**；`scripts/stress-table.mjs` 写好却从未接入 npm script。索引 / 引用改写 / 编辑器语法这类「出错是静默的」代码一旦回归，UI 上看不出来。

**测试套件（零新依赖）**

* `npm test` → `scripts/test-core.mjs`。沿用既有「用 esbuild 把 TS 打成 mjs、在 Node 里直接断言」的做法，**不启动 Electron、不引入测试框架**。打包统一走 `scripts/lib/bundle.mjs`（esbuild **JS API**）。
  * ⚠️ 切勿为了图省事改成子进程 `node <node_modules/esbuild/bin/esbuild>`：该路径在 Windows 上是 JS 启动壳、在 Linux/macOS 上是**原生二进制**（ELF / Mach-O）。`node <它>` 只在 Windows 能跑，CI（ubuntu）会直接崩 `SyntaxError: Invalid or unexpected token`（2026-09-10 CI 失败根因）。
  * `bundleTs()` 内置 60s 超时，避免打包子进程卡死把 CI job 拖到超时。
* A / C / C2 / C3：`rewriteWikiLinksInText` 纯函数 + 临时库端到端（文件改名、目录移动、来源自迁移、零命中不写盘、幂等、CRLF 保真）。
* B：索引纯函数（`parseFile` / `deriveBackLinks` / `indexFile` 增量 / `removeFileFromIndex` / 解析映射同源）。
* D：wikilink 语法往返（目标 / 别名 / 锚点一个不丢）——上线首日即抓出 `#锚点` 被丢弃的数据丢失缺陷。
* E：i18n 双语键集合与插值变量逐条对齐。
* F：IPC 契约——每个通道都既有主进程接线又有 preload 暴露（抓出并清理了零引用的 `FILE_LIST_DIR`）。
* G：软错误上报——`reportSoftError` 上报自身永不抛错 / 环形缓冲裁剪 / 分级计数 / sink 注入。
* H：数据安全红线——改名 / 移动 / 删除对 `.assets` 与 `.yujian-history` 的搬运与清理（回收站经 `setTrashImpl` 注入 fake，断言「本体 + 附件 + 历史三项都进回收站」）。
* I：快照 diff 引擎——hunk 行号 / 聚合 / 并排配对（`src/utils/snapshotDiff.ts`，2026-09-11 抽自 `SnapshotPanel.vue`）。
* J：frontmatter 解析 / 回写——正文逐字保留（`src/editor/frontmatter.ts`，数据保真红线）。
* K：标签页路径重映射——文件夹移动按前缀整体改写（`src/store/tabs.ts` 的 `remap`）。
* `npm run stress:table` → 表格往返压测（原 `scripts/stress-table.mjs`，此前未接线）。
* `npm run perf:index` → `scripts/perf-index.mjs`：造 3000 篇临时笔记（`YJ_PERF_FILES` 可放大），断言全量构建上限、单文件增量**绝对**上限、**增量代价不随库规模增长（严格增量性）**、索引体积、堆增量，以及「增量不得触碰无关条目」。把硬约束 4「5000 文件无感知」从人工手测变成门禁。
  * ⚠️ 严格增量性**不要**用「增量 vs 全量/N 的耗时比」来断言：全量是 I/O 密集（N 次读文件）、增量是纯 CPU 且有固定底噪；机器越快 `全量/N` 越小、比值越难看——同一份代码本地 48×、CI 只有 15×，门禁会随机飘红（2026-09-10 实测踩中，属断言设计错误而非性能回归）。正确做法是**同进程内把同一操作跑在两个库规模上**（N 与 N/10）：O(1) 时比值 ≈1（实测 1.06~1.15），退化成 O(n) 时会放大到 ~N/10（证伪实测 10.5×，门禁正确拦住）。
  * 微基准必须用 `performance.now()`——`Date.now()` 的 1ms 粒度对 ~0.01ms 的操作太粗；被测文本须在计时循环**外**预先构造，避免把字符串拼接算进去。

**门禁**

* `npm run check` = `typecheck` + `lint` + `check:encoding` + `test` + `verify:md` + `verify:corpus` —— 与 CI 逐步对齐，提交前一条命令跑完。
* `npm run lint` 覆盖全仓（`src` + `electron`），不再只扫 `src`：主进程是删除 / 移动 / 落盘等最高风险代码所在。
* `npm run check:encoding` → `scripts/check-encoding.mjs`：扫描受版本管理的文本文件，出现 U+FFFD 即失败。合法 UTF-8 解码**永不**产出 U+FFFD，故它是「字符已被静默损坏」的高置信信号——这类损坏不报错、不拦构建，只有人读到才发现（2026-09-10 实测中过一次，单文件 80 字符被抹）。
  * 判读铁律：本仓库 CJK 在部分终端 / 日志管道里会被**二次编码**，肉眼看到的乱码未必是文件问题。判断一律以**码点或字节**为准（`scripts/check-encoding.mjs` 的报告刻意只输出 ASCII）。
* `npm run verify:md` = Markdown 解析 / 数学渲染 / 内联 HTML 回归（30 条，含 2026-09-11 新增的「token 失效必结算」）。
* `npm run verify:corpus` = **Markdown 往返语料矩阵**：`tests/corpus/*.md` 逐个跑「parse → serialize，断言逐字节相等」（当前 18 个用例，覆盖 gfm 脚注 / 硬换行 / 块级 HTML / 引用定义 / 转义字面量 / **行内与块级数学** / wikilink·tag 边界）。流水线为 remark-parse + remark-gfm + **remark-math** + 三个自定义插件；`remark-math` 与编辑器 `Crepe.Feature.Latex` 同包，故数学走真实解析 + 序列化路径而非当普通文本的假绿。新增用例只需往目录丢一个 `.md`，**不需要写 JS**——把补用例的门槛从「会写 JS」降到「会写 Markdown」，避免自定义语法扩建时漏测。
  * 语料必须写成 remark 的**规范形式**：`*` 项目符号（`--` 会被正常化）、`***` 分隔线（`---` 会被改）、表格 `--` 分隔行并按最宽单元格补空格对齐、行尾两空格硬换行→反斜杠 `\`、裸 URL→尖括号形式、字符实体→字面字符、块级公式须写 `$$\n…\n$$`。这些是 remark 上游行为，**不是本项目缺陷**；完整对照表与编写约定见 `tests/corpus/README.md`。
  * 与「未编辑文档一字不改」不冲突：未编辑文档走保真层（原始文本直通），只有真正被编辑、需要序列化时才走这条链路。
  * 已证伪：把 wikiLink handler 的锚点去掉（历史 P0 缺陷）→ `06-wikilink.md` 正确失败并指出差异位置。
* `.github/workflows/ci.yml`：PR 与 main 推送自动跑 `typecheck` / `lint` / `check:encoding` / `test` / `verify:md` / `perf:index` / `build`（此前 CI 只在打 tag 时打包，日常提交无门禁）。
* 工作流统一 **Node 22** + `actions/checkout@v5` / `actions/setup-node@v5`：Node 20 已于 2026-04 EOL，其 action runtime（node20）也随 GitHub 强制切 Node 24 而失效——继续钉 v4 会被 annotation 点名并在切换后硬失败。

***

### 5.23 容错可观测 / 结构收敛（2026-09-10 第二轮审查后）

> 背景：主进程大量 `catch {}`（某次 IO 失败不该让编辑器崩，策略正确）**但没有任何出口**——索引落盘失败、历史迁移失败、`.assets` 搬运失败全都被倒进黑洞。同时 `App.vue` 在 PKM 接线后回涨到 1742 行，`vault.ts` 因顶部 `import { shell } from 'electron'` 无法在 Node 直测。

**（1）软错误可观测层 —— `electron/main/softError.ts`**

* 极薄口子：`reportSoftError(scope, err, level?)`，`level` 为 `'warn' | 'debug'`，**不改变任何控制流**，只把「已知可容忍失败」记下来。
* 有界环形缓冲（容量 200），`reportSoftError` 自身**永不抛错**（内部 try/catch + `describeError` 兜底 `String(err)`），避免「记录失败把应用搞崩」。
* 经 `SOFT_ERRORS_GET` / `SOFT_ERRORS_CLEAR` 两个 IPC 通道透出；`IntegrityPanel.vue` 增加可折叠「被容忍的失败」分区（按 scope 汇总 + 一键清空）。开发态（`!app.isPackaged`）自动 verbose。
* 现共 **44 处**容错 `catch` 接线。其中 5 处是「静默降级」而非普通探测，尤其关键：
  * `atomicWrite.fallback`——rename 三层全败、退回非原子 `copyFile`，**原子性保障失效**；
  * `history.trashFallback` / `snapshot.trashFallback`——回收站不可用、退回 `rm -rf`，**绕过「绝不 rm」红线、删除不可恢复**；
  * `vault.readdir`——目录不可读会让内部文档被整体漏掉（关联数据迁移不完整）；
  * `asset.read`——资源读盘失败（渲染层表现为裂图）。
* 顺带修掉一个**静默数据风险**：`renameItem` / `deleteItem` / `moveItem` 原先 `if (vaultRoot) { 迁移历史/附件 }`，而 `vaultRoot` 仅由 `watchVault` 赋值——早于首次 watch 的改名 / 删除会**静默跳过关联数据迁移**。现改为 `resolveVaultRoot(fromPath)` 自解析（向上查找 `.yujian-history` / `.mdeditor` 标记），解析不到才 `reportSoftError('history.noRoot')`。

**（2）回收站注入 —— `electron/main/trash.ts`**

* `setTrashImpl(fn | null)` + `trashItem(absPath)`；`electron` 以**惰性** `import('electron')` 引入，模块顶层零 Electron 依赖。
* `vault.ts` / `snapshots.ts` 移除顶部 `import { shell }`，改为 `import { trashItem, setTrashImpl } from './trash'` 并**再导出** `setTrashImpl`。
  * ⚠️ 测试注入必须在**同一份打包产物**上调用 `V.setTrashImpl(...)`：esbuild 会把 `./trash` 内联进 `vault.mjs`，对「另打的 trash.mjs」注入无效。
* 收益：`vault.ts` 首次可在 Node 里直测 → 解锁硬约束 6（数据安全红线）的自动化覆盖（测试 H 段）。

**（3）`App.vue` 按能力抽 composable**

* `src/composables/usePkmPanels.ts`——`leftBottom` / `rightBottom` / `onViewToggle` 与快照面板唤醒刷新；左右两列各自独立、可同时开。
* `src/composables/useVaultLinks.ts`——`onWikilink` / `onCreateBrokenLink`（双链目标解析与一键创建）。
* 依赖一律**参数注入**（`vaultPath` / `openPath` / `showToast` …），composable 不直接触碰组件实例。`App.vue` 1742 → 1683 行（`useTabs` 待续，见 `CODE-REVIEW-2026-09-10.md §6`）。

**（4）wikilink 语法单一来源 —— `electron/shared/wikilink-syntax.ts`**

* 索引层（`vaultIndex.ts` 裸正则扫 `[[…]]`）与编辑器层（remark 改写）此前各写一份定界符正则，语义有漂移风险。现收敛为共享模块：`wikiLinkRegex()` / `wikiLinkInputRegex()` / `parseWikiLink()` / `buildWikiLink()` / `findWikiLinks()`。
* 铁律：`wikiLinkRegex()` **每次返回新 RegExp 实例**——共享同一实例会因 `lastIndex` 残留导致 `exec` 漏匹配（带 `g` 标志的经典陷阱）。
* `wikilink.ts` 的 remark 遍历改用最小 `MdNode` 形状（12 → 9 处 `any`）；因 mdast 各节点类型均可满足该形状（字段全可选），调用处无需强转。

***

### 5.24 审查可选项落地（2026-09-11）

> 背景：`docs/CODE-REVIEW-2026-09-10.md` §六 列了 4 项非阻塞可选项。先做**只取证、不改码**的审查（产出 `docs/REVIEW-OPTIONAL-2026-09-11.md`），据此**证伪**「1600 行大组件必须抽 composable」「该新建 `useTabs()`」等提法，再按优先级逐项落地。

**（1）修 `renderMathWithRef` 的 token 失效挂起（真 bug）**

* 场景：内联 `\eqref` 节点的 pending 任务在其视图销毁后失去有效 token 时，`flushPendingRefs` 曾直接 `return`（不 resolve、不再入队），而 1200ms 兜底又因任务已出队（`indexOf < 0`）而跳过 → promise **永久挂起**，DOM 停在占位源码 `$…$`。
* 修复：改为 `task.resolve(svg)` 结算（调用方有 `mine !== this.token` 守卫，不会污染陈旧 DOM）。`verify:md` 新增断言覆盖；把修复 stash 掉后该断言立刻 FAIL（已证伪）。

**（2）抽 `src/utils/snapshotDiff.ts`（纯 diff 引擎 + 单测）**

* 从 `SnapshotPanel.vue` 抽出行/块级 diff 引擎：`buildDiffRows` / `buildHunks` / `splitPairs` / `diffStats` / `hasChanges`。**是 util 不是 composable**——纯逻辑不该藏在组件里。
* 顺带**发现并修掉一个真 bug**：旧 `buildHunks` 把 hunk 内的上下文行也计入 `baseOld/baseNew`，导致 hunk 头行号偏大。改为只统计 hunk 起点之前的行；以 `diff -U1` 为准校验收敛（`mod-mid` 由 `@@ -5,3` 修正为 `@@ -2,3`）。
* `test-core.mjs` 新增 `[I]` 段（14 条断言：与 `diff -U1` 对齐、纯增/删头、双 hunk、null 侧、并排配对）。

**（3）`frontmatter.ts` 补数据保真断言（`test-core` `[J]` 段）**

* frontmatter **不走 remark 链**（编辑器先剥 YAML 头、只编辑正文、再拼回），故不该做成 corpus 的 `.md`（会被当 `***` 分隔线）。真正缺口是它此前零测试。
* `[J]` 段（10 条）：解析已知字段 + 未知字段透传、正文逐字保留、`parse→serialize` 往返逐字节等于原文、空值字段剔除、CRLF 保真。`gray-matter` 的动态 `require('fs')` 在 ESM 产物里会崩 → 用 `createRequire` 桩外置回 Node 原生加载。

**（4）`remapTabPaths` 收进 `useTabsStore`（`remap` action）**

* 审查结论：**不新建 `useTabs()`**——App.vue 里剩余的标签代码全是同时牵动 watcher 抑制 / 会话持久化 / 文件树的编排胶水，搬进 composable 只是搬家不减熵。
* 唯一放错位置的是 `remapTabPaths`：纯粹的「标签列表前缀批量重映射 + activePath 迁移」，不碰编辑器 / 会话 / 文件树，天然属于 store。落地为 `remap(oldPath, newPath) → { activeChanged, affected }`；`App.vue` 只据此拼 watcher 回声抑制的 `immune` 集合，store 保持对 `refreshGuard` 无感。
* `test-core.mjs` 新增 `[K]` 段（7 条：文件夹前缀批量重映射、嵌套后代、activePath 同步、no-op）。

**（5）语料矩阵扩展 + 接 `remark-math`**

* 审查指出原提法有误导：不补 `remark-math` 就往 corpus 丢 math 是**假绿**（`$x$` 被当普通文本，往返必然一致）。
* 现给 harness 接上与编辑器同包的 `remark-math`（内部自注册 from/toMarkdown 扩展），数学语料走真实解析 + 序列化路径。用例 9 → 18：行内/块级数学、gfm 脚注、硬换行、块级 HTML、引用定义、转义字面量、wikilink·tag 边界、删除线/自动链接。
* `tests/corpus/README.md` 补充正常化对照表（两空格硬换行→`\`、裸 URL→尖括号、字符实体→字面字符、多余转义被去掉、块级公式须写 `$$\n…\n$$` 等）。**已知边界**：语料是 mdast 级往返，**未复刻**编辑器 `remarkMathBlockPlugin`（把 `math` 改写成 `code(lang=LaTeX)`）这一步。

**（6）对齐 `\eqref` 三处矛盾文档**

* `ARCHITECTURE §5.3.2` 曾称「已根治」、`EQREF-KNOWN-ISSUE.md` 称「未解决」、`PHASE3-PLAN` 同一文件内自相矛盾，且引用了**代码里不存在**的 `refAutoInputRule`（全库零命中）。
* 现统一为：三个连环坑与 token 挂起**已修**（纯逻辑层 `verify:md` 已覆盖）；用户所报「重载持久 `???`」**端到端待定论**，需 Electron 抓 DOM 取证。单一定义落在 `.workbuddy/memory/EQREF-KNOWN-ISSUE.md`。

**门禁现状（2026-09-11）**：`typecheck` 0 错 / `lint` 0 错（2 处 `v-html` 警告有意保留）/ `check:encoding` 172 文件 0 损坏 / `test` 171 / `verify:md` 30 / `verify:corpus` 18 / `perf:index` 9 项全过。

### 5.25 Phase 3 批次三（二·下）：关系图谱（2026-09-11，已落地）

> 批次三三块（`#标签` + 内容地图 MOC + 关系图谱）至此收官。规格见 `docs/PHASE3-UI-DESIGN.md` §4.3。

**（1）数据完全由索引派生，零新数据层**

* `vaultIndex.buildGraph(index, { center, maxHops, maxNodes })` —— 纯函数（Node 可测，`test-core` `[L]` 段 16 条断言）。
  * 节点 = 索引内文件；边 = `IndexEntry.outLinks`（**已是解析后的绝对路径**），只保留两端都在展示集合内的边，并按「无向对」去重（互链只画一条线）。
  * 由于两端都在集合内，反链方向（w→u）会在处理 w 时被自然补上，**无需额外求并集**。
  * **本地子图**：以 center 为根沿「出链 ∪ 反链」的**无向邻接**做 BFS，取 maxHops 跳内节点，`depth` 记跳数（0=中心）。center 不在库内 → 退化为全局。
  * **全局视图**：超过 `GRAPH_MAX_NODES=300` 时按节点**度降序**取前 300 —— 保留「最连通」的核心子图，是**确定性**采样（不依赖随机、可复现、可单测）。
* IPC `VAULT_GRAPH` → preload `getGraph`；主进程走 `getLiveIndex`，与其它索引消费通道同源。

**（2）渲染：Canvas 2D + d3-force**

* 依赖先翻仓库：`d3-force` **已在 `node_modules`**（mermaid 的传递依赖）。因其纯 JS、无 node-gyp（红线 3），提升为**直接依赖** `d3-force ^3.0.0`（+ `@types/d3-force`）即可安全复用，**未引入任何编译型依赖**。平移 / 缩放 / 拖拽在 Canvas 上自行实现，故不需 `d3-zoom` / `d3-drag`。
* **Canvas 而非 SVG**：节点数多时 SVG DOM 会拖垮渲染（UI-DESIGN §4.3）。
* 底用 `--hue-editor` 纯净实色，**不叠玉质纹理**；节点分三级：中心 r8 走 `--hue-accent`、一跳 r5 走 `--hue-text-2`、二跳及更远 r3.5 走 `--hue-text-3` 且默认不显标签（悬停才出）。
* 主题适配：Canvas 不能直接用 CSS 变量 → 每次绘制经 `getComputedStyle` 取计算值（`--hue-editor` / `--hue-accent` / `--hue-text-1/2/3`），切皮肤自动跟随。
  * ⚠️ `--hue-*` 是**完整色值**（如 `#5fa8a0`）而非三元组，与 `--hue-mark` / `--hue-tint-*` 那组三元组不同 → `withAlpha()` 需自行解析成 `rgba()`，别照抄 `rgb(var(--hue-mark))` 写法。

**（3）交互与护栏**

* 入口：左缘活动栏新增第 7 键「图谱」（`ViewKey` 加 `'graph'`）。图谱是**独立全屏视图**，不进双栏停靠布局 —— 激活时占用整个内容区、隐藏左右停靠栏；`EditorHost` 用 `v-show` 保留实例（不丢编辑状态）。
* 单击选中（高亮邻居、其余淡化至 40%）· 双击打开笔记并退出图谱 · 拖拽平移 · 滚轮缩放 · 拖节点可固定位置。
* 性能：≤300 节点、tick 经 `requestAnimationFrame` 节流、`alphaDecay` 衰减后停算；超限时提示「已显示 N / 共 M，切换本地子图以聚焦」。
* 无障碍：Canvas 不可读 → 提供**等价列表视图**（图谱 / 列表切换，条目为 `<button>`、键盘可操作）。
* `prefers-reduced-motion` → 同步跑 300 个 tick 直接到收敛终态，不做逐帧动画。

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
| **5. 搜索**      | 统一 vault 索引层 + 搜索面板                            | 千篇笔记下搜索响应 < 100ms（索引驱动枚举，免目录递归）                                                                    |
| **6. 导出**      | HTML / PDF / 单 md                               | 导出结果与编辑器内观感一致                                                                        |
| **7. 打磨**      | 主题、体积裁剪、快捷键、设置面板                                | 安装包体积优化，可用                                                                           |
| **8. 分发**      | electron-builder 打包                             | 产出 Windows 安装包，可安装运行                                                                 |
| **9. Phase 2** | 多文档标签+查找替换+版本快照+写作统计+凝神(打字机/禅)模式+导出增强+写作辅助+断链检查 | ✅ 批次一已落地（多文档标签·文件内查找替换·选区字数）；批次二已落地（版本快照·写作统计·凝神模式）；批次三已落地（导出增强·写作辅助·断链检查，见 `docs/PHASE2-PLAN.md`） |
| **10. Phase 3** | PKM：批次零(缺陷+统一索引地基)→一(数据安全)→二(双链+反链)→三(标签+MOC+关系图谱)→四(中文排版+体验)→五(技术写作+发布) | ✅ 批次零已落地（统一索引层`vaultIndex.ts`+`minisearch`死依赖移除）；✅ 批次一已落地（完整性自检·整库备份恢复·外部修改冲突三选一·表格压测19/19）；✅ 批次二已落地（wikilink 真节点·点击跳转/一键创建·反链面板消费索引 `backLinks`；收尾三项：`[[` 自动补全浮层·未链接提及一键包裹·断链面板一键创建，见 §5.15）；批次三~五待启动 |

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
| 8 | **切换文档时内容串写（B 被 A 覆盖）**     | 高  | 保存目标绑定 `fidelity.docPath`（绝不用实时 `props.filePath`）；`load()` 先 `waitSavingIdle()` + 若旧文档脏则 `save()` flush 回旧路径，再用 `loadToken` 丢弃过期加载结果。见 `src/editor/useFidelity.ts` 的 `docPath`/`setDocPath` 与 `EditorHost.vue` 的 `save`/`load` |

***

## 10. 历史决策记录（原「待拍板问题」）

> 本节原为 v1 开工前的 6 个待确认问题。**全部已拍板并落地**，现改写为决策记录，
> 保留「为什么是这样」的来龙去脉——后来者不必翻 git 历史或反复猜。

| # | 当时的疑问 | 结论 | 落地位置 |
| --- | --- | --- | --- |
| 1 | 图片放哪：集中于 `vault/.assets/`，还是与 `.md` 同级？ | **与文档同级、同名 `.assets` 目录**（`笔记.md` ↔ `笔记.assets/`），正文引用一律相对路径。单文件分发时「文档 + 同名目录」可整体搬走，且删除文档时能连带清理。 | `electron/main/assets.ts`；渲染层经 `jade-asset://` 读盘（§5.9），导出时解码回绝对路径 |
| 2 | 自动保存防抖多久？要不要 `.bak`？ | **800ms 防抖**（`AUTOSAVE_DELAY`）；**不用 `.bak`**，改用 `.yujian-history/` 版本快照（内容寻址 + 索引 + 命名标签，可回滚）。 | `src/editor/EditorHost.vue`；`electron/main/snapshots.ts` |
| 3 | 源码模式切换是否自动格式化？ | **不格式化**。源码模式是「看真源」的窗口，任何自动重排都会破坏用户原始排版，与第一号红线「往返保真」直接冲突。 | `src/editor/useFidelity.ts`（脏标记驱动：未编辑则一字不改） |
| 4 | 要不要多标签页？ | **要**，已实现。且与「关联数据随文档迁移」耦合：移动 / 改名文件夹时须按路径前缀批量重映射嵌套文档的标签（`remapTabPaths`），不能只改精确匹配项。 | `src/components/TabBar.vue`、`src/store/tabs.ts` |
| 5 | 图床：先预留接口，还是直接接一个？ | **直接接，且密钥只存主进程**（`safeStorage` 加密），渲染层永远拿不到明文 Key。 | `electron/main/imghost.ts`、`src/components/ImgHostSettings.vue` |
| 6 | AI 辅助写作要不要进路线图？ | **暂不纳入**。现有「写作辅助」是**本地规则**实现（不联网、不需要 API Key）；AI 能力待 Phase 3 之后再单独评估。 | `src/components/WritingAidsPanel.vue` |
***

## 5.26 Phase 3 批次四（一）：命令面板（2026-09-11，已落地）

> 面板增多后的统一任务型入口。规格见 `docs/PHASE3-UI-DESIGN.md` §3（浮起层玻璃体系）。

* 组件：`src/components/CommandPalette.vue`（玻璃模态，`Ctrl+Shift+P` 唤起）。两种模式——**命令模式**（按分组列出全部动作）与**快速打开**（模糊搜笔记路径）。
* 命令规格表：`src/utils/commands.ts` 导出 `COMMANDS`（`CommandId` / `CommandGroup` / `keys`）、`GROUP_ORDER`、`CommandId` 联合类型。新增命令只改此表 + i18n `palette.cmd` 文案，无需动组件。
* 模糊匹配：`src/utils/fuzzy.ts` 逐字符子序列匹配 + 命中位置（高亮）+ 大小写不敏感；命令模式按分组归并并保持组序。
* 接线：`App.vue` 注入 `CommandPalette`，以**捕获阶段** `keydown` 监听实现面板开启时让位守卫（放行 `Ctrl+Shift+P` 关闭面板、屏蔽其它全局快捷键）；`CmdAction` 映射把每条命令派发到既有动作函数（`openPath` / `openVault` / `saveFile` / `saveFileAs` / `graphActive` / `toggleFocus` / `openCompile` / 各浮层 toggle 等）。
* i18n：zh-CN / en-US 各加 `palette` 段（标题、占位、6 个分组名、30+ 命令文案）。
* 测试：`test-core.mjs` `[M]` 段 10 条（命令规格完整性 / `fuzzyRank` 命中·排序·大小写 / 分组归并）。
* 防复发：`.git/hooks/commit-msg` 自动剥离 `Co-Authored-By:` 行（GitHub 贡献者仅计真实 author，详见 2026-09-11 日志「GitHub 署名清洗」）。

## 5.27 Phase 3 批次四（二）：中文排版（渲染层）（2026-09-12，已落地）

> 规格见 `docs/PHASE3-UI-DESIGN.md` §5；依据 W3C《中文排版需求》§3.2.2、GB/T 15834—2011。
> **红线**：纯渲染层，保存时绝不改写源文件（Markdown 往返保真，见 §1 红线 4）。

* **状态模块** `src/typography.ts`：`TypographyState` = `enabled`（总开关）+ `space` / `emphasis` / `punct` / `paraGap` 四子项，**默认全开**。持久化到 `localStorage['yujian.typography']`；`normalizeTypography` 为纯函数（非布尔回落默认、垃圾输入整体回落、不缺键）；存储后端可注入（`setTypographyStorage`，同 `trash.ts` 的 `setTrashImpl` 手法，Node 可测）。`applyTypography` 把状态落到根节点 `data-cjk` / `data-cjk-space` / `data-cjk-emph` / `data-cjk-punct` / `data-cjk-gap`（总开关关闭时子项属性一律 `off`）。
* **样式** `src/styles/editor.css`「中文排版」段，按 `[data-cjk='on']` + 子项属性生效：
  * **中英 / 中数 ¼ em 间距**：`text-autospace: normal`（引擎自动在表意 / 非表意文字间补白，与全角标点相邻不补）；代码块内 `text-autospace: no-autospace`，行内代码仍补。
  * **标点挤压 + 避头尾**：`text-spacing-trim: normal`（收紧行首与连续全角标点）+ `line-break: strict`（严格禁则）。
  * **中文强调**：`em { font-style: normal; color: var(--hue-accent) }`（中文斜体公认难看，规范建议以颜色 / 着重号替代；英文斜体一并变色，子项可关）。
  * **中文段落间距**：`p { margin-bottom: 18px }`（比西文多 4px，补偿全角标点的视觉密度）。正文行高已由 `.ProseMirror` 统一 1.75。
* **关键决策：不做 JS 装饰回退。** 规格原拟「CSS 不支持时用 ProseMirror Decoration 插零宽元素」；实测 `text-autospace` / `text-spacing-trim` 自 **Chromium 140** 起原生支持，Electron 44（Chromium ≫140）已满足 → **纯 CSS 即可，免去装饰插件**（零性能开销、零 DOM 污染、渲染层装饰不进文档模型故导出天然不受影响）。若未来运行环境回退到 <140，间距仅静默不生效，不会破坏排版。
* **设置界面**：`PreferencesSettings.vue` 新增「中文排版」小节——总开关 + 四子项开关（总开关关闭时子项整体弱化且不可点），改动即 `applyTypography` + `saveTypography`；`App.vue` `onMounted` 调 `initTypography()`（紧随 `initAppearance()`）。
* **i18n**：zh-CN / en-US 各加 11 键（`cjkTitle` / `cjkEnabled(+Desc)` / `cjkSpace(+Desc)` / `cjkEmphasis(+Desc)` / `cjkPunct(+Desc)` / `cjkGap(+Desc)`），由 `[E]` 双语对齐守护。
* **测试**：`test-core.mjs` `[N]` 段 6 条（默认全开 / 合法布尔保留 / 非布尔回落 / 垃圾输入整体回落 / 注入存储的持久化往返 / 损坏存储不抛）。
* **效果预览**：`docs/preview/cjk-typography.html`（可交互，逐项开关对照；内嵌 `text-autospace` / `text-spacing-trim` 原生支持检测徽标）。

## 5.28 Phase 3 批次四（三）：大文档分块渲染（2026-09-12，已落地）

> 计划验收：**10 万字文档输入延迟不随文档长度退化**（`PHASE3-PLAN.md` §2.3 / 批次四验收）。
> 风险表第 12 条原担心「虚拟滚动与 Crepe 选区 / 装饰冲突」——本实现即对该风险的处置结论。

* **关键决策：不做「真·虚拟滚动」（DOM 窗口化），改用 Chromium 原生 `content-visibility: auto`。**
  ProseMirror 的选区 / IME / 装饰 / 查找依赖「文档全量在 DOM」这一前提；真正只渲染可视块、其余从 DOM 摘除，会破坏 DOM↔doc 的位置映射，属框架级对抗（需重写 `EditorView` 的节点映射），风险远大于收益，且与 Markdown 往返保真红线冲突。
  `content-visibility: auto` 是 Chromium 为长文档设计的既定机制：**DOM 保持完整**，浏览器仅跳过屏外块的 layout / paint——选区、IME、装饰、查找、导出全部不受影响；纯 CSS、可整体回退、零 JS 开销。
* **适配模块** `src/editor/hugeDoc.ts`：
  * `HUGE_DOC_THRESHOLD = 20_000`（`doc.content.size` 阈值 ≈ 2 万字符，远超一屏）；`HUGE_DOC_CLASS = 'yj-huge-doc'`。
  * 纯函数 `isHugeDoc(contentSize, threshold?)`——严格大于阈值，可 Node 单测、零 DOM 依赖。
  * `createHugeDocPlugin()`：ProseMirror `view` 钩子按当前 `doc.content.size` 给 `view.dom`（即 `.ProseMirror`）切 `yj-huge-doc`；`update` 里用 **O(1)** 的 `content.size`（Fragment 缓存长度）判态，**跨阈才写 classList**，尺寸未变直接短路。
* **样式** `src/styles/editor.css`「大文档分块渲染」段：
  ```css
  .milkdown .ProseMirror.yj-huge-doc > p,  /* …h1–h6 / ul / ol / blockquote / hr… */
  { content-visibility: auto; contain-intrinsic-size: auto 64px; }
  ```
  `contain-intrinsic-size: auto 64px` 的 **auto 前缀**让浏览器记住已渲染过的真实高度，避免滚动条（含阅读进度依赖的 `scrollHeight`）估算跳变。
* **作用域刻意「白名单」而非 `> *`**：`content-visibility: auto` 会始终带上 layout / style / paint 包含，而 Crepe 代码块把 `.language-picker`（`position:absolute`、`z-index:999`）放在 `.milkdown-code-block` **内部** → 若整块纳入 paint 包含会被裁掉。故只取**不含内联绝对定位浮层**的块类型（段落 / 标题 / 列表 / 引用 / 分隔线），**组件块（代码块 / 图片块 / 表格块）一律排除**。
  * 另注：Crepe 块操作手柄 `.milkdown-block-handle` 追加到 `view.dom.parentElement`（`.milkdown` 根，**非**块内），故块级包含不会裁切它。
* **自适应**：仅大文档挂类，普通文档完全不受影响（规避 `content-visibility` 始终带包含的潜在副作用）。
* **附带性能修复**（同源问题，一并处理）：
  * `src/editor/focusBlock.ts`：当前块定位由 `doc.descendants` 全量遍历改为**从光标位置向上 O(深度) 上溯**最近的 `isTextblock` 祖先，大文档下避免每次事务扫全篇。
  * `src/editor/features/emoji.ts`：`props.decorations(state)` 每次渲染都调用，而**纯选区事务复用同一个 `doc` 对象**——原实现每次全量 `descendants` 扫 `:name:`，现按 **doc 对象身份记忆化**（模块级单槽缓存），仅文档真正变化才重算；行为不变，仅去掉随文档长度增长的重复扫描。
* **测试**：`test-core.mjs` `[O]` 段 6 条（阈值 / 类名常量契约 / `isHugeDoc` 严格大于边界 / 自定义阈值 / 假 view+classList 的跨阈增删类 / 尺寸未变不重复 toggle）。

## 5.29 Phase 3 批次四（四）：UI 缺陷修复 —— 命令面板高亮 / 阅读进度条抗回流（2026-09-12，已落地）

> 用户实测反馈两项「体验失准」，均属渲染层缺陷，不触碰数据与控制流。

* **命令面板「多行同时高亮」**（`src/components/CommandPalette.vue`）
  * **根因**：模板内层 `v-for="(row, i) in block.rows"` 的 `i` 是**分组内局部下标**，而 `activeIndex` 是**跨分组全局序号**。以 `i === activeIndex` 判选中 → `activeIndex = 0` 时**每个分组的第一行同时命中**（同源缺陷还导致 `:id="cp-row-${i}"` 在不同分组间重复，破坏 `aria-activedescendant`）。
  * **修复**：`commandGroups` 计算时预分配跨分组全局序号 `flat`（`let flat = 0` 逐行自增），模板的 `:id` / `:class` / `:aria-selected` / `@mouseenter` 一律改用 `flat`；`flatCommands` 直接 `flatMap` 复用同一批行，两者顺序天然一致。
  * **验证**：用真实 `COMMANDS` + 真实 zh-CN 文案 + 真实 `fuzzyRank` 生成「修复前 / 修复后」对照页（临时产物，跑完即删）并以无头 Edge 截图确认——修复前 6 个分组首行同亮，修复后仅真·选中行亮。教训：**凡「分组渲染 + 全局键盘索引」，绑定必须统一到全局序号**。
* **阅读进度条过于灵敏 / 莫名跳动**（`src/components/ReadingProgress.vue` + 新增 `src/utils/progress.ts`）
  * **根因**：进度 = `scrollTop / (scrollHeight - clientHeight)`，分母随**布局回流**变化——开关侧栏 / 大纲、窗口缩放、字体变化都会让内容重排、`scrollHeight` 改变，而用户并未滚动；原实现对 `MutationObserver` 的每次内容变化都直接重算，于是「点个按钮 / 看眼大纲」进度条就跳一下。
  * **修复**：抽出纯函数 `src/utils/progress.ts`（`progressPercent` 夹紧换算、`acceptProgress` 判定是否采纳），组件只负责采样。判定规则：**只有 `scrollTop` 变化才算用户滚动**；仅高度变化（纯回流）只更新锚点、不动刻度；另加 0.15% 死区滤掉亚像素抖动（两端 0% / 100% 永远精确）；`force` 用于换文档 / 拖拽跳转等显式意图。内容变化的复核加 200ms 防抖，避免打字时每帧读 `scrollHeight` 强制布局（配合 §5.28 的输入延迟目标）。
  * **测试**：`test-core.mjs` `[P]` 段 8 条（百分比换算 / 越界夹紧 / 回流不采纳 / 真滚动采纳 / force 覆盖 / 死区 / 两端精确 / 不足一屏采纳）。
  * **效果预览**：`docs/preview/reading-progress-fix.html`（左右并排「修复前 / 修复后」，可点按钮滚动与触发一次模拟重排，直观看刻度是否被改写）。

## 5.30 Phase 3 批次四（五）：中文分词 · 双击选词（2026-09-12，已落地）

> 计划验收：**双击中文按词边界选中**（原行为是整段选中）；`src/editor/features/tag.ts` 里「彻底解决需中文分词，属批次四」的伏笔由此收口。

* **问题**：ProseMirror 的双击选词按「词字符 / 空白」切分，而**中文词间没有空格** → 双击中文常常把整段选走（实测「玉笺是一款跨平台开源」10 字一次选中），`#标签` 识别、复制词、加粗某个词都因此不顺手。
* **纯函数层** `src/utils/cjk-segment.ts`（可 Node 单测）：
  * `isCjkChar(ch)`：汉字（含扩展 A / 兼容区）、日文假名、韩文谚文、CJK 标点与全角符号 → true；拉丁 / 数字 / 半角标点 → false（**西文交回编辑器默认逻辑**，它对西文更好）。
  * `segmentWords(text)`：用 **`Intl.Segmenter('zh-CN', { granularity: 'word' })`** 分词，只返回 `isWordLike` 的段。
  * `wordRangeAt(text, offset)`：取包含该偏移的词；落在空白 / 标点上返回 `null`。
* **关键决策：不引第三方分词库、不自造词典。** `Intl.Segmenter` 是浏览器原生（ICU），**零依赖、跨平台一致、与系统输入法同源**，也正是 Obsidian / Typora 走的路径。代价是 ICU 中文切分偏保守，故补一层**保守**回退 `mergeLoneHan`：**长度为 1 的汉字词**若**紧邻的下一个词也是长度 1 的汉字**，则合并为双字（中文双字词占多数）。实测收益：「开源」「挤压」「玉笺」都能整词选出。保守之处：相邻段只要不是单字汉字（更长、或标点 / 西文 / 空白）就**绝不跨过去合并** → 「我」+「喜欢」不会被拼成「我喜」、「编」也不会粘上后面的逗号。
  * 环境缺 `Intl.Segmenter` 时 `segmentWords` 返回空数组，双击自动退回默认行为，**不崩**。
* **编辑器层** `src/editor/wordSelect.ts`：ProseMirror `props.handleDoubleClick` 插件。
  * **只在单个文本节点内选词**，不跨 inline 节点（wikilink / 公式 / emoji）——既符合「选词不该跨节点」的直觉，也绕开「inline 节点占 1 个位置却对应多字符」导致的偏移错位。
  * 光标处非 CJK → 返回 `false`，交回默认；光标落在 CJK 标点 / 全角符号上（不属于任何词）→ 选中**该字符本身**，比整段可预测得多。
  * 三击选段落（`handleTripleClick`）保持默认，不动。`MilkdownEditor.vue` 于 `createHugeDocPlugin()` 之后注册。
* **测试**：`test-core.mjs` `[Q]` 段 11 条。⚠️ **只断言不变量**（区间有效、`text === text.slice(start,end)`、按序不重叠、偏移必落在区间内、越界与空白返回 `null`、英文整词可切出、双字回退生效且不越界合并），**不断言具体中文切分结果**——ICU 版本升级会微调词典，硬断言会假红。
* **效果预览**：`docs/preview/cjk-word-select.html`（可改示例文本、点任意字，上下对照「原生整段选中」与「按词选中」，含偏移 / 长度 / 内容读数）。

## 5.31 Phase 3 批次四（六）：快捷键自定义（2026-09-12，已落地）

> 规格：`PHASE3-UI-DESIGN.md` §4.7。计划验收：**命令面板可搜到全部功能，且键位可自定义**。

* **单一事实来源（本批次的核心决策）**：默认键位**只写在 `src/utils/commands.ts` 的 `keys` 字段**，不再有第二份表。
  * 原先 `App.vue` 的 `onKeydown` 是一串 `if (k === 's') / 'o' / '\\' / '/'` 硬编码分支，HelpPanel 里还手抄了一份键位表 —— 键位一旦可配，手抄表必然过期，两处必然打架。**故 HelpPanel 的「快捷键」标签页整体删除**（连同其 i18n 键），键位只在「快捷键设置」一处展示。
  * `src/shortcuts.ts` 的 `DEFAULT_BINDINGS` 由 `COMMANDS` **派生**（只取能解析的，写错的默认值不会让应用起不来），不另存一份默认表。
  * 搜索三件套（`Ctrl+F` / `F3` / `Shift+F3`）此前也硬编码在 `onKeydown`，现提成正式命令 `view.search` / `view.nextHit` / `view.prevHit`，与其它命令一视同仁可配。
* **纯函数层** `src/utils/keymap.ts`（零依赖，可 Node 单测）：`parseCombo` / `formatCombo` / `normalizeCombo` / `normalizeKey` / `isBindable` / `eventToCombo` / `eventMatches`。
  * **为什么必须先归一**：键位可配之后必须有一个**唯一标准形**，否则 `Ctrl+Shift+P`、`shift+ctrl+p`、`Ctrl+P+Shift` 会存成三条互相冲突的记录，匹配时还会漏。规范串固定 `Ctrl+Alt+Shift+Key` 顺序，可直接当 Map 键 / 存储值 / 相等比较。
  * **`isBindable` 是安全底线**：只按一个字母（如 `A`）不能作为全局快捷键 —— 那会让人打不出字。要求**带 Ctrl 或 Alt，或本身是 F1~F12**；单独 Shift 不算修饰（避免 `Shift+A`＝大写 A 被当成快捷键）。
  * 两个刻意的简化：**Ctrl 与 Cmd 归一**（`ctrlKey || metaKey`，与既有实现一致，显示统一为 `Ctrl`）；**主键取 `e.key` 而非 `e.code`**（与既有 `onKeydown` 一致，不引入键盘布局差异的第二套语义）。
* **状态层** `src/shortcuts.ts`：默认值 + 用户覆盖 + 冲突判定 + 持久化。
  * **只存覆盖**（`localStorage: yujian.shortcuts`）：默认值改了、用户没碰过的命令会跟着走，不会出现「升级后旧键位被钉死」。覆盖值 `''` 表示**显式解绑**，区别于「未设置 = 用默认值」。
  * **冲突三态** `Conflict`：撞到别的命令（`command`）→ **默认不生效**并报出占用者，由 UI 问过用户后再以 `steal: true` 抢占（抢占时把原主人的键位清空，保证一条键位只有一个主人，不留两个主人）；撞到 `reserved` → **steal 也抢不走**。
  * `RESERVED` 分三类原因：`app`（打开设置本身的入口 `Ctrl+K` / `Ctrl+Shift+P`，放出去会出现「把入口键改掉就再也进不来」的死锁）、`system`（Electron / 浏览器 / 系统先手，拦不到或拦了会破坏基本操作）、`editor`（编辑器正文正在用，占用后正文里该键失效）。
  * **读盘与写入同标准**：`localStorage` 是用户可手改的，故 `loadShortcuts` 除「可解析」外还要 `isBindable` —— 否则塞一个裸字母进来就会进派发表，正文里每按该字母都触发命令且 `preventDefault`。未知命令 / 非字符串 / 不可解析 / 不可绑定一律丢弃。
  * **零 Vue 依赖**：状态变更走 `onShortcutsChange` 订阅 + `getShortcutsVersion()` 版本号，组件把版本号顶进 `ref` 触发 `computed` 重算；存储后端可注入（`setShortcutsStorage`）以便单测。
* **接线** `src/App.vue`：`onKeydown` 改为**查表派发** —— `eventToCombo(e)` → `buildDispatchTable()` 取命令 id → `commandActions[id]()`，不再有任何 `if (k === …)`。派发表是 `computed`，随键位改动实时重建（改完立刻生效，**无需重启**）。
  * `Esc` 不进键位表：它是**上下文相关的「退出」动作**（关面板 / 掀帘 / 退出凝神），不是一条命令。
  * 命令面板 / 快速打开（`onPaletteHotkey`）仍走硬编码捕获路径，与 `RESERVED` 的 `app` 类一致。
* **UI** `src/components/ShortcutsSettings.vue`：命令名（左）· 键位胶囊（中）· 重置（右）；点胶囊进入录入态（**捕获阶段接管并 `stopPropagation`**，免得被全局快捷键抢走；`Tab` 放行不困住键盘用户；`Esc` 取消、`Delete` / `Backspace` 清除绑定）；命中冲突在行下方给 `--hue-danger` 红字 + 「替换 / 取消」；可按命令名 / 命令 id 过滤；分组与命令面板同源（`groupCommands`）。底部「全部恢复默认」带二次确认，并单列「固定键位」（只列 `app` 类）。
  * 入口：`F1` 以及命令 `settings.shortcuts`。帮助面板（`HelpPanel.vue`）缩为**使用指南 + 关于**，`?` 与「关于」都指向它。
* **测试**：`test-core.mjs` `[R]` 段 21 条（归一化顺序/大小写/Cmd≡Ctrl、F 键与命名键、非法输入一律 `null`、`isBindable` 边界、只按修饰键不成键、匹配只认相等、默认键位来自命令目录且避开保留键位、覆盖/冲突/抢占/保留键位抢不走、解绑 ≠ 默认、重置单个与全部、派发表随覆盖变化、持久化往返、脏数据清洗、订阅通知，以及 3 条**安全不变量**：默认键位全部可绑定、派发表只含可绑定组合、存储里的裸字母会被丢弃）。

## 5.32 Phase 3 批次四（七）：中文搜索质量 + 复杂元素临时编辑界面（2026-09-14，已落地）

> 规格：`PHASE3-UI-DESIGN.md` §4.4（临时编辑界面）。计划：批次四「中文分词」的另一半（让**搜索**也按中文词而非字符）、以及表格 / 代码块 / 公式的临时编辑界面。

### 5.32.1 中文搜索质量：全词匹配对中文的修复

* **根因**：JS 原生 `\b` 只认 **ASCII** 词字符（`[A-Za-z0-9_]`），CJK 一律算「非词」。于是「全词匹配」开着时，搜「开」仍会在「开源」里命中 —— `开` 两侧都是汉字，而汉字在 `\b` 眼里不是词字符，左右**都被当成边界**，所谓全词匹配对中文完全是空操作。
* **修复**：`src/utils/regex.ts` 改用 **Unicode 词边界** `(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`，需 `u` 标志。中英文此后语义一致：搜「开」不再命中「开源」「开会」，但能命中被空格 / 标点 / 行首行尾包围的独立「开」。
* **单一来源收敛（重点）**：库级搜索（`electron/main/vault.ts`）原先**另写了一份** `buildSearchRegex`（同样用 `\b`），与渲染层行为不一致。现删除该函数，两处统一调用 `buildRegex`。`regex.ts` 是零依赖纯函数，主进程可直接引用，无 Electron 依赖。
  * ⚠️ 收敛时踩到一个坑：`buildRegex` **始终返回带 `g` 的正则**（装饰层需要逐次 `exec`），而 `searchInFile` 原本用 `re.test()` 在**多行上复用同一个正则** —— 带 `g` 时 `test()` 会推进 `lastIndex`，第二次调用从上一行匹配结束处开始找，会漏匹配。故改用 `String.prototype.search()`（**忽略 `g` 标志、每次从行首匹配**），从机制上杜绝该问题，而不是靠手动重置 `lastIndex`。
* **测试**：`test-core.mjs` `[S]` 段 9 条（中文子串命中、全词不命中「开源」「开会」、被非词字符包围时命中、拉丁 `cat` vs `category` 保持原语义、中英混合 `code` vs `decode`/`codex`、大小写不敏感默认、`u` 标志必须存在、regex 模式 `\d+`）。

### 5.32.2 复杂元素临时编辑界面

**先盘点再动手**（避免重复实现）：Crepe 已覆盖绝大部分 —— 表格增删行列 / 三档对齐 / 行列拖拽重排（`@milkdown/kit/component/table-block`）、代码块（CodeMirror：语言下拉 / 复制 / 行号 / 语法高亮 / 预览）。故本批次**只补真正的缺口**，其余沿用 Crepe。

* **共用玻璃外壳** `src/components/ElementEditPopover.vue`：`.glass` + `--radius-lg` + padding 16px；`Esc` 与「点击外部」=**关闭并应用**，`×` 与「取消」=**关闭且不应用**；打开期间目标块加 2px accent 描边（由面板用 inline style 施加，关闭时**还原旧值**，不污染行内样式）。
  * 定位接受**目标元素**而非矩形：滚动 / 缩放时可重新测量，避免用打开那一刻的过期坐标把浮层甩到屏幕外；`z-index: 70`（高于右键菜单 / WikiSuggest 的 60，低于命令面板的 80）。
  * **外壳不持有任何编辑值**：只发 `dismiss(reason)`，值的所有权在各元素面板里 —— 新增一种元素不必改外壳。
* **公式编辑器** `src/components/MathEditPanel.vue`：上半 LaTeX 源码（等宽 14px）、下半**实时预览**、4 组符号工具条（每组 ≤8，插入后光标自动落进第一个 `{}`）、底部 `\label` 与编号状态。
  * **关键决策：预览直接复用 `mathjax.ts`**（`renderMathToSvg` / `renderLatexContent`），于是「编辑时看到的」与「文档里最终渲染的」是**同一个 MathJax 实例、同一套 `tags:'ams'` 编号语义** —— 不另起预览渲染器，杜绝两套引擎结果打架。
  * **为什么是「替换」而非「叠加」**：Crepe 的 Latex 特性自带 `inlineLatexTooltip`，在 `math_inline` 被整块选中时弹出，但那是个**纯文本框、没有预览**，改 LaTeX 只能盲改；且其 `shouldShow` 是硬编码、**无法通过 config 关闭**。故在 `editor.css` 隐藏 `.milkdown-latex-inline-edit`，由本面板以**完全相同的触发条件**接管 —— 触发语义不变，只是换了个更好的编辑器。
  * 触发两路：`src/editor/mathSelect.ts` 监听 NodeSelection（覆盖键盘导航），外加「点击公式即打开」（覆盖**已选中时再点击不产生 selection 更新** → 取消后点不回来）。
  * 应用走 `tr.setNodeMarkup(pos, null, { value })`，并**主动让出 NodeSelection**（光标移到公式之后）—— 否则事务一更新就又判定「公式被选中」，浮层立刻重开，表现为「点应用没反应」。
* **明确不做：表格列宽拖拽**。Crepe 未覆盖，但 **Markdown 表格语法不承载列宽**，拖出来的宽度重载即丢；持久化则须新建旁路数据层或改写成 HTML 表格，与「Markdown 往返保真」红线冲突（Typora 的同类能力同样是会话级视觉效果）。**宁缺勿假**：与其给一个会静默失效的控件，不如先不做并在文档中写明原因。
* **测试 / 验证**：本次改动以 UI 集成为主，可断言的纯逻辑已入 `[S]` 段；浮层交互与观感经 `docs/preview/math-edit-demo.html`（可交互演示）验证。
  * ⚠️ 演示踩坑：把 `MathJax.tex2svg()` 返回的**整个 `mjx-container`** 塞进 flex 容器会夹带辅助节点，出现重复 / 错位残影；只取其中的 `<svg>` 单节点挂载即消除。

## 5.33 组件瘦身与「可测化」：composable 分层约定（2026-09-14）

**起因**：2026-09-14 审计（`docs/AUDIT-2026-09-14.md`）指出两个看似独立、实则同源的问题——
`App.vue` 达 1797 行（上帝组件），而 **44 个组件共 19493 行（占代码总量 51%）的自动化测试覆盖为 0**。
根因是同一件事：**逻辑堆在组件里，于是既臃肿又无法断言**。
故按「一次抽取同时兑现瘦身与可测」推进，并沉淀为本节约定。

### 抽取顺序与成果

| 抽取块 | 产出 | 效果 |
| --- | --- | --- |
| 导出（单文档 / 合订 / 预览 / 写盘） | `composables/useExport.ts` + `export/exportMeta.ts` | `App.vue` 1797 → 1592 |
| 命令面板热键判定 | `utils/paletteHotkey.ts` | 顺带修掉「已开时按任意键都关」与注释不符的行为 |
| 侧栏搜索 + 替换 | `composables/useSidebarSearch.ts` + `utils/searchNav.ts` | `Sidebar.vue` 1611 → 1436 |

### 约定（新增 composable 时照此办理）

1. **依赖经 `hooks` 以 getter 注入**，不在 composable 里 import 组件、也不反向依赖调用方：
   `vaultPath: () => props.vaultPath` 而非 `vaultPath: props.vaultPath`（后者会丢失响应性）。
   风格与既有 `usePkmPanels` / `useVaultLinks` 一致。
2. **对外抛出用「具名回调」而非 Vue emit 签名**：`{ findHighlight, openResult, replaced }`。
   这样 composable 不感知事件名字符串，改名只动组件一处。
3. **DOM 引用归组件，不归 composable**：模板 `ref="xxx"` 由组件持有，聚焦等动作以
   `focusInput: () => searchInput.value?.focus()` 注入。composable 保持与 DOM 无关。
4. **纯逻辑单独放零依赖模块**（`utils/searchNav.ts`、`export/exportMeta.ts`），
   不要塞在 composable 里 —— 否则一测就牵出 vue / i18n / IPC 整条链。
   判据：**不 import vue、不碰 IPC** 的判定逻辑，就该单独成文件并被 `bundle()` 测到。
5. **抽完即补断言**：`test-core.mjs` 用 esbuild JS API 打包后 `import()`，无需组件测试框架。

### 结构门禁 `scripts/check-structure.mjs`（`npm run check:structure`，已入 CI）

正确性由 `npm run check` 管，本门禁专管**不会让测试变红的慢劣化**：

* **巨石文件**：默认上限 1700 行；`App.vue` 1650、`Sidebar.vue` 1500。涨破即说明又有该抽的块。
* **`any` 逃逸**：既控总量（当前 61，只减不增），更控**越界** ——
  61 处全部位于 `src/editor/features/` 的 5 个文件（ProseMirror / Milkdown 第三方 AST 边界，
  节点类型无法从包导出完整类型，标 `any` 属合理妥协）。**白名单外出现哪怕 1 处即失败**：
  一旦 `any` 扩散到 vault / 索引 / 序列化，「Markdown 往返保真」就失去类型护栏。
* **遗留标记**：`TODO / FIXME / XXX / HACK / WORKAROUND` 必须为零。

想放宽阈值，须**显式改文件并在此说明原因**，而不是让它悄悄涨上去。

## 5.34 `electron/main/vault/` 包：主进程文件系统能力的细颗粒拆分（2026-09-15）

`vault.ts` 曾是主进程头号上帝模块（1134 行 / 12 导出 / 7 类互不相关职责）。现拆为包目录：
`vault.ts` 删除，`./vault` 解析到 `vault/index.ts` 门面，**调用方（`main/index.ts`、
`vaultIntegrity.ts`、`test-core.mjs`）无需改动**。

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `context.ts` | 库根（`vaultRoot`）+ 程序化改动抑制窗 + `resolveVaultRoot` —— **可变状态簇之一** |
| `fsUtils.ts` | 无状态 fs 帮手：存在性 / 权限判定 / 只读递归清除 / 回收站优先删除 / 递归收集文档 |
| `naturalSort.ts` | 中文自然排序（纯函数、零依赖） —— 拆出后从「无法断言」变为可测 |
| `treeOps.ts` | 文件树读写与变更：列表 / 新建 / 重命名 / 删除 / 移动（**关联数据随迁铁律的唯一落点**） |
| `indexStore.ts` | 统一索引生命周期：内存索引 + 映射缓存 + 防抖落盘 + 迁移同步 —— **另一状态簇** |
| `watcher.ts` | 目录监听 + 增量维护；库根写入的唯一入口 |
| `search.ts` | 全文搜索 / 全局替换 |
| `linkCheck.ts` | 链接健康体检（只读，不修改任何文件） |
| `index.ts` | 公开门面：**外部只从此处导入**，内部可继续拆分而不惊动调用方 |

### 依赖方向（单向、无环）

`context → fsUtils`；`treeOps → {context, fsUtils, naturalSort, indexStore}`；
`watcher → {context, indexStore}`；`search → indexStore`；`linkCheck → fsUtils`。

### 两条必须守住的细节

1. **trash 注入必须从门面再导出**：打包会把 `../trash` 内联成独立副本，只在外层模块设注入是无效的。
   测试的 `setTrashImpl` 必须与内部使用**同一份实例**，故门面保留
   `export { setTrashImpl, trashItem } from '../trash'`。
2. **可变状态不跨模块散落**：`vaultRoot` / 抑制窗归 `context`，索引状态归 `indexStore`；
   其余模块一律经函数读写（`setVaultRoot` / `isProgrammaticSuppressed`），不直接持有 `let`。

## 5.35 `electron/main/vaultIndex/` 包：索引层细颗粒拆分（2026-09-15）

`vaultIndex.ts`（1045 行 / 35 导出）是主进程第二大胖文件，混装五类职责。现拆为包目录，
`./vaultIndex` 解析到 `vaultIndex/index.ts` 门面，**调用方零改动**（`main/index.ts`、
`vaultIntegrity.ts`、`vaultBackup.ts`、`vault/*`、`test-core.mjs`、`perf-index.mjs`）。

### 文件职责与依赖方向

| 文件 | 行数 | 职责 | 依赖 |
| --- | --- | --- | --- |
| `types.ts` | ~60 | 全部类型与共享常量（`IndexEntry`/`VaultIndex`/`PathMaps`/`MD_EXT`/`INDEX_VERSION`…） | 无 |
| `metadata.ts` | ~193 | 元数据解析（frontmatter / 标题层级 / 出链 / 内联标签） | types |
| `paths.ts` | ~41 | 文件判定（跳过规则 / 是否 Markdown）+ 路径映射构建 | types |
| `store.ts` | ~220 | 索引构建 / 增量 reconcile / 持久化 / `ensureIndex` | types, metadata, paths |
| `links.ts` | ~79 | 双链解析与反链上下文 | store, paths, metadata |
| `pkm.ts` | ~270 | 标签树 / MOC 大纲 / 未链接提及 | store, metadata |
| `rewrites.ts` | ~132 | 重命名 / 移动时改写全库 `[[wikilink]]` | links, paths |
| `graph.ts` | ~96 | 关系图谱纯函数 | types |
| `index.ts` | ~24 | 公开门面（含原文件的**设计铁律**注释） | 全部 |

依赖严格单向（types → metadata/paths → store → links → rewrites；store → pkm），**无环**。

### 拆分的副产品

- `writeAtomic`（只转调 `atomicWrite` 的二行包装）已删除，调用点直呼 `atomicWrite`。
- `normalizeTag` / `targetKey` / `ensureIndex` 由私有改为对包内导出（跨子模块需要），
  但**不进公开门面**——门面仍等于原 `vaultIndex.ts` 的导出面，对外 API 未变。

## 附录 A：开工前必做的环境配置

```bash
# 1. 配置 Electron 二进制镜像（否则下载极慢）
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron-builder-binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/

# 2. 验证版本锁定正确
npm view vite version        # 应为 7.3.x，不是 8.x
npm view @milkdown/crepe version   # 应为 7.22.1
```

