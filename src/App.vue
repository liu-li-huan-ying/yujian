<script setup lang="ts">
import { ref } from 'vue'

type EditorMode = 'wysiwyg' | 'source'
const mode = ref<EditorMode>('wysiwyg')

const tree = [
  { folder: '技术笔记', files: ['electron-架构.md', 'vite-版本锁定.md', 'prosemirror-节点.md'] },
  { folder: '随笔', files: ['读书记.md'] }
]

const outline = [
  { text: 'Electron 进程模型', level: 1 },
  { text: '主进程', level: 2 },
  { text: '渲染进程', level: 2 },
  { text: 'IPC 通道设计', level: 2 },
  { text: '安全基线', level: 3 }
]
</script>

<template>
  <div class="shell">
    <header class="titlebar jade">
      <div class="titlebar__inner">
        <span class="titlebar__name">electron-架构</span>
        <span class="titlebar__ext">.md</span>
        <div class="spacer" />
        <div class="seg">
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'wysiwyg' }"
            @click="mode = 'wysiwyg'"
          >
            所见即所得
          </button>
          <button
            class="seg__item"
            :class="{ 'seg__item--on': mode === 'source' }"
            @click="mode = 'source'"
          >
            源码
          </button>
        </div>
      </div>
    </header>

    <div class="body">
      <aside class="sidebar jade">
        <div class="sidebar__inner">
          <div class="pick"><span>我的笔记库</span><span class="chev" /></div>
          <div class="search"><span>搜索</span><span class="kbd">Ctrl K</span></div>
          <div class="label">文件</div>
          <div class="tree">
            <template v-for="group in tree" :key="group.folder">
              <div class="tree__folder"><span class="tri" />{{ group.folder }}</div>
              <div
                v-for="(f, i) in group.files"
                :key="f"
                class="tree__file"
                :class="{ 'tree__file--on': group.folder === '技术笔记' && i === 0 }"
              >
                {{ f }}
              </div>
            </template>
          </div>
          <div class="sidebar__foot">128 篇文档</div>
        </div>
      </aside>

      <main class="editor">
        <div class="crumb">
          <span>我的笔记库</span><span class="sep">/</span><span>技术笔记</span
          ><span class="sep">/</span><span class="crumb__now">electron-架构.md</span>
        </div>
        <div class="canvas">
          <div class="column">
            <h1>Electron 进程模型</h1>
            <p>
              Electron 应用由主进程、预加载脚本与渲染进程三类构成。理解它们的权限边界，是设计
              IPC 通道的前提。
            </p>

            <h2>主进程</h2>
            <p>
              每个应用有且仅有一个主进程，拥有完整的 Node.js 权限，负责窗口生命周期与全部系统级操作。
            </p>

            <div class="code">
              <div class="code__bar">TypeScript</div>
              <pre><span class="k">const</span> win = <span class="k">new</span> <span class="f">BrowserWindow</span>({
  webPreferences: {
    contextIsolation: <span class="s">true</span>,
    nodeIntegration: <span class="s">false</span>,
  },
})</pre>
            </div>

            <blockquote>注意：图床密钥必须留在主进程。打包后的渲染层脚本可被轻易反编译。</blockquote>

            <h2>渲染进程</h2>
            <p>
              每个窗口对应一个独立的渲染进程，运行在 Chromium 沙箱中，不应直接接触文件系统。
            </p>
          </div>
        </div>
      </main>

      <aside class="outline jade">
        <div class="outline__inner">
          <div class="outline__head">大纲</div>
          <div
            v-for="(o, i) in outline"
            :key="o.text"
            class="outline__item"
            :class="[
              `outline__item--l${o.level}`,
              { 'outline__item--on': i === 1 }
            ]"
          >
            {{ o.text }}
          </div>
        </div>
      </aside>
    </div>

    <footer class="statusbar jade">
      <div class="statusbar__inner">
        <div class="statusbar__grp">
          <span>1,284 字</span>
          <span>约 5 分钟</span>
        </div>
        <div class="statusbar__grp">
          <span><i class="dot" />已保存</span>
          <span>行 42, 列 8</span>
          <span>UTF-8</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hue-editor);
}

/* ── 标题栏 ─────────────────────────────── */
.titlebar {
  height: var(--h-titlebar);
  flex-shrink: 0;
  border-bottom: 1px solid var(--hue-border-subtle);
}
.titlebar__inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 0 14px;
}
.titlebar__name {
  font-size: 13px;
  color: var(--hue-text-1);
}
.titlebar__ext {
  font-size: 12px;
  color: var(--hue-text-3);
}
.spacer {
  flex: 1;
}
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: 7px;
  background: var(--hue-highlight);
}
.seg__item {
  border: none;
  background: transparent;
  font-size: 11px;
  padding: 3px 10px;
  color: var(--hue-text-3);
}
.seg__item--on {
  background: var(--hue-accent);
  color: var(--hue-editor);
  font-weight: 500;
}

/* ── 主体三栏 ───────────────────────────── */
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ── 侧边栏 ─────────────────────────────── */
.sidebar {
  width: var(--w-sidebar);
  flex-shrink: 0;
  border-right: 1px solid var(--hue-border-subtle);
  display: flex;
}
.sidebar__inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px 0 0;
}
.pick,
.search {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 12px 8px;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--hue-highlight);
}
.chev {
  width: 7px;
  height: 7px;
  border-right: 1.4px solid var(--hue-text-3);
  border-bottom: 1.4px solid var(--hue-text-3);
  transform: rotate(45deg);
}
.kbd {
  margin-left: auto;
  font-size: 11px;
  color: var(--hue-text-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 0 4px;
}
.label {
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--hue-text-3);
  padding: 2px 14px 6px;
}
.tree {
  padding: 0 6px;
  overflow-y: auto;
}
.tree__folder {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  padding: 6px 8px;
  color: var(--hue-text-2);
}
.tri {
  width: 0;
  height: 0;
  border-left: 4px solid var(--hue-text-3);
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
}
.tree__file {
  font-size: 12.5px;
  padding: 6px 8px 6px 26px;
  border-radius: var(--radius-md);
  color: var(--hue-text-2);
  cursor: default;
}
.tree__file--on {
  background: var(--hue-active);
  color: var(--hue-text-1);
  font-weight: 500;
}
.sidebar__foot {
  margin-top: auto;
  height: var(--h-row);
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: 11px;
  color: var(--hue-text-3);
  border-top: 1px solid var(--hue-border-subtle);
}

/* ── 编辑区（纯净实色，无材质）───────────── */
.editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--hue-editor);
}
.crumb {
  height: var(--h-crumb);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 22px;
  font-size: 11px;
  color: var(--hue-text-3);
  border-bottom: 1px solid var(--hue-border-subtle);
  flex-shrink: 0;
}
.crumb__now {
  color: var(--hue-text-2);
}
.sep {
  opacity: 0.5;
}
.canvas {
  flex: 1;
  overflow-y: auto;
  padding: 24px 30px 64px;
}
.column {
  max-width: var(--w-column);
  margin: 0 auto;
}
.column h1 {
  font-size: 28px;
  font-weight: 500;
  line-height: 1.35;
  margin: 0 0 12px;
  color: var(--hue-text-1);
}
.column h2 {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.4;
  margin: 28px 0 8px;
  color: var(--hue-text-1);
}
.column p {
  font-size: 16px;
  line-height: 1.75;
  margin: 0 0 14px;
  color: var(--hue-text-2);
}
.code {
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin: 16px 0;
  background: var(--hue-code);
  border: 1px solid var(--border-subtle);
}
.code__bar {
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 11px;
  color: var(--hue-text-3);
  border-bottom: 1px solid var(--border-subtle);
}
.code pre {
  margin: 0;
  padding: 11px 13px;
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.6;
  color: var(--hue-text-1);
  overflow-x: auto;
}
.k {
  color: var(--hue-accent);
}
.s {
  color: var(--hue-success);
}
.f {
  color: #8fb8d8;
}
blockquote {
  margin: 18px 0;
  padding: 2px 0 2px 14px;
  border-left: 2px solid var(--hue-accent);
  font-size: 15px;
  line-height: 1.7;
  color: var(--hue-text-3);
}

/* ── 大纲 ───────────────────────────────── */
.outline {
  width: var(--w-outline);
  flex-shrink: 0;
  border-left: 1px solid var(--hue-border-subtle);
  display: flex;
}
.outline__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 8px;
}
.outline__head {
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--hue-text-3);
  padding: 6px 8px 8px;
}
.outline__item {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  color: var(--hue-text-2);
  cursor: default;
}
.outline__item--l1 {
  padding-left: 8px;
}
.outline__item--l2 {
  padding-left: 22px;
}
.outline__item--l3 {
  padding-left: 34px;
}
.outline__item--on {
  background: var(--hue-active);
  color: var(--hue-text-1);
}

/* ── 状态栏 ─────────────────────────────── */
.statusbar {
  height: var(--h-statusbar);
  flex-shrink: 0;
  border-top: 1px solid var(--hue-border-subtle);
}
.statusbar__inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 14px;
  font-size: 11px;
  color: var(--hue-text-3);
}
.statusbar__grp {
  display: flex;
  gap: 14px;
  align-items: center;
}
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hue-success);
  margin-right: 5px;
  vertical-align: middle;
}
</style>
