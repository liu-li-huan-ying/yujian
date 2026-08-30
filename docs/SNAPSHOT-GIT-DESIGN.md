# 版本快照「git 化」设计草案（2026-08-31）

> 背景：用户希望把现有的"按文档全量副本"快照，升级成类似 git 的版本管理，或借鉴优秀思路。
> 本文档先对比成熟方案、列出当前实现的差距，再给出**借鉴而非照搬**的落地方案与分期范围。
> 状态：**Phase A 已落地（2026-08-31）**——命名标签、任意两点对比、内容哈希去重、index.json 元数据层、向后兼容迁移均已完成（见 §5）。Phase B / C 仍为规划。

---

## 一、当前实现（基线）

`electron/main/snapshots.ts`：

- 布局 `<vault>/.yujian-history/<pathHash>/<ISO>__<note>.md`，每份快照是**完整 .md 文件**。
- **去重只比对"最新一份"**：内容与之相同则复用，否则写新文件。
- 列表/恢复/删除走 IPC；删除走系统回收站。
- 行级 diff 在 `SnapshotPanel.vue` 用 `diffLines` **现算**（只支持"当前稿 ↔ 选中快照"）。
- 备注（note）相当于 commit message。

优点：简单、文件人类可读、可直接打开备份。
缺点（见下"差距"）。

---

## 二、成熟方案对比

| 方案 | 模型 | 适合写作吗 | 可借鉴点 |
|---|---|---|---|
| **Git** | blob/tree/commit 对象 + DAG + refs(branch/tag) + packfile(增量) | 过重、概念门槛高 | tag（里程碑）、`diff A B`、提交图 |
| **Google Docs / Notion 版本历史** | 自动按时间留档 + 命名版本 + 时间轴拖拽还原 | **最贴合** | 命名版本、时间轴、一键还原 |
| **Apple Time Machine** | 周期全量 + 增量、任意时间点浏览 | 思路可借 | "任意两点对比" |
| **Obsidian** | 本身无快照，靠 vault 接 git 或文件系统 | — | 证明写作者要的是"留档+还原"，不是分支合并 |
| **Typora / 一般 Markdown 编辑器** | 基本无版本管理 | — | — |

**结论**：写作者要的是 **"留档、命名里程碑、任意两点对比、一键还原"**，**不是**分支合并/冲突解决。
git 里真正值得借的是 **tag（命名里程碑）** 和 **`diff A B`（任意两点对比）**，而不是 DAG/merge。

---

## 三、当前实现的差距（shortcomings）

1. **只能"当前稿 vs 选中快照"对比**，不能"快照 A vs 快照 B"——这是 git `diff A B` 的基本能力，写作场景（"这版和上周那版差在哪"）极常用。
2. **没有命名里程碑（tag）**：note 只是自由文本，无法把某份标记为"终稿 / 投稿版 / v1.0"。
3. **去重粒度过粗**：只比对最新一份，中间出现过的相同内容仍各存一份。应按**内容哈希**去重（相同内容只存一份，多个提交指向同一 blob——这正是 git 的对象模型）。
4. **没有 lineage（血缘）**：看不出"这份是基于哪份改的"，时间轴是扁平列表。
5. **全量副本**：文档普遍 <100KB，空间不是问题；但若想"git 化"观感，可加轻量 `index.json` 元数据层。
6. **无分支/草稿**：想做"如果换个结尾"的 what-if 草稿，现在只能另存文件。

---

## 四、git 风格设计（借鉴而非照搬）

### 4.1 数据模型：`index.json` 元数据 + 内容哈希去重

保留"每文档一个可读 .md 备份"的人性化优势，新增一个 `index.json` 作为"对象索引"：

```
.yujian-history/<pathHash>/
  index.json            # 提交清单（git 的 reflog/commit 元数据）
  blobs/
    <sha1-of-content>.md   # 内容按哈希存，相同内容只存一份（git blob 思想）
```

`index.json` 每条记录：
```jsonc
{
  "id": "2026-08-31T10-20-00",      // 时间戳即 commit id（可排序）
  "parent": "2026-08-30T21-52-00",  // 上一份快照 id（血缘链）
  "contentHash": "a1b2c3…",         // 指向 blobs/<hash>.md
  "note": "发布前",
  "tags": ["v1.0", "终稿"],         // 命名里程碑（git tag 思想）
  "branch": "main",                  // 预留：草稿分支
  "createdAt": 1693...,
  "size": 1234
}
```

- **内容哈希去重**：创建时算 `sha1(content)`，已存在则只新增一条 index 记录（指向同一 blob），不复制正文。多个提交共享一份 blob，省空间也更"git 味"。
- **parent 链**：天然形成线性 lineage，可在 UI 画时间轴/提交图。
- **tags**：数组，一份快照可贴多个标签；UI 支持"打标签 / 按标签筛选"。

> 不引入真实 packfile/delta 压缩——Markdown 太小，收益为负，复杂度暴涨。只借"内容寻址 + 索引"这一层思想。

### 4.2 借鉴 git 的能力映射

| git 概念 | 在玉笺的落点 | 是否采纳 |
|---|---|---|
| commit（带 message） | 快照 + note | ✅ 已有 |
| tag（命名里程碑） | `tags[]`：终稿/投稿版/v1.0 | ✅ **采纳（高价值）** |
| `git diff A B` | 任意两份快照对比 | ✅ **采纳（高价值）** |
| commit graph / lineage | parent 链 + 时间轴图 | ◐ 采纳轻量版（线性时间轴，非 DAG） |
| branch（草稿分支） | `branch` 字段 + "另起草稿" | ◐ 采纳**轻量版**（见 4.3） |
| merge / rebase / conflict | — | ❌ 不采纳（写作者用不到，门槛过高） |
| cherry-pick / revert 段落 | "从旧版摘一段回来" | ❌ 暂不做（复杂度高，ROI 低） |

### 4.3 轻量"草稿分支"（而非真 git 分支）

git 分支对写作者太重。更务实的形态：
- 主时间轴 `main` 照常连续留档。
- "另起草稿"= 基于当前稿 Fork 出一条 `draft/<name>` 时间轴，独立留档、独立还原。
- 不合并、不冲突解决；想采纳草稿内容就"复制到主稿"。
- 这满足"what-if 草稿"需求，又不会产生 merge 地狱。

---

## 五、分期实施范围（建议）

### Phase A — 高价值、低风险 ✅ 已落地（2026-08-31）
1. ✅ **命名标签 tags[]**：快照可打标签（内联 chip 增删，限长 24、最多 8 个、去空去重）、按标签筛选、UI 标记"终稿"等。
2. ✅ **任意两点对比**：`diffLines(快照A, 快照B)`，面板每行带 A / B 小按钮，选两份即摊平逐行 add/del/ctx 预览；保留旧"选中快照 vs 当前稿"对比。
3. ✅ **内容哈希去重**：`sha1(content)` 作键，相同正文只存一份 `.md`，多个提交共享（引用计数）；`index.json` 记录元数据 + `parent` 线性血缘链。
4. ✅ **数据向后兼容**：旧的全量 `.md` 快照在首次读取（`readIndex`）时自动 `migrate` 成 `index.json`（按时间排 `parent` 链），不丢任何历史数据；脏条目（`.md` 已被手动删）自动剔除。

### 当前实现（Phase A 落点）

**存储层**（`electron/main/snapshots.ts`）：
- 布局 `<vault>/.yujian-history/<pathHash>/`：`index.json`（元数据清单）+ `<ISO>__<note>.md`（正文，向后兼容）。
- `contentSha1(content)` 去重：`createSnapshot` 命中相同哈希则**仅新增一条 index 记录**指向同一 `.md`，不复制正文；`deleteSnapshot` 用**引用计数**——仅当无任何其它条目引用同一 `.md` 时才走 `shell.trashItem` 回收站物理删除。
- `tags` 经 `sanitizeTags`（去空/去重/限长24/限8）落库；`setSnapshotTags` 更新后写回 `index.json`。
- `parent` 链：新快照 `parent` 指向上一份，`migrate` 把旧快照按时间排成线性血缘。

**IPC**：`shared/ipc-channels.ts` 新增 `SNAPSHOT_SET_TAGS`；`preload` 暴露 `snapshotSetTags`；`main/index.ts` 注册 handler；`SnapshotInfo` 接口增补 `tags?` / `contentHash?` / `parent?`。

**前端**：`store/snapshots.ts` 新增 `setTags`（调 IPC 后 `refresh`）；`SnapshotPanel.vue` 重写——标签筛选 chips、A↔B 任意两点对比、标签 chips 内联增删、保留旧选中对比；i18n（zh-CN / en-US）补齐 `snapshotTags` 等双语 key。

**行为红线**：删除仍走系统回收站（绝不 `rm`）；恢复仍只读返回、灌入编辑器标脏、不立即覆盖磁盘原文（守 §5.2 保真红线）。

### Phase B — 中风险、体验提升
5. **线性时间轴 / 血缘视图**：基于 parent 链画提交图。
6. **轻量草稿分支**：`branch` 字段 + 另起草稿。

### Phase C — 高复杂度、ROI 低（暂缓）
7. 段落级 cherry-pick / revert。

---

## 六、开放问题（待你拍板）

> Phase A 已于 2026-08-31 落地，以下遗留项待后续拍板（影响 Phase B / C 范围）。

- **Phase B / C 何时做？** 线性时间轴/血缘视图、轻量草稿分支、段落级 cherry-pick 仍规划中，未排期。
- **"命名标签"要不要预设常用词**（终稿/投稿版/v1.0）让用户一键选？当前为自由输入，未预设。
- **草稿分支（Phase B 轻量版）是否本期就要**，还是先只做 A？
