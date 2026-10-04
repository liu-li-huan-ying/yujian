import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

// 玉笺 ESLint 扁平配置（ESLint 9 flat config）
// 设计原则：
//  - 不全盘启用 recommended 预设（本仓此前无 lint，全套会一次性爆出大量存量，反而无人修）。
//  - 仅开启 CODE-REVIEW P2-1 明确点名、且高价值的规则，并跑绿，让工具链真正可用。
//  - micromark / remark 扩展层（src/editor/features/**）内部 API（effects/ok/nok 等）本就无类型，
//    用「按路径豁免」关闭 no-explicit-any，避免到处写 eslint-disable 注释。
//  - scripts/**.mjs（门禁脚本自身）也纳入 lint：它们是九道门禁的**实现**，
//    一个变量名打错 / 条件写反都会让门禁「假绿」而不报任何错——见下方 scripts 段的注释。

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      '_npmcache/**',
      'tmp/**',
      'electron/**/dist/**',
    ],
  },

  // 基础 JS 安全规则（关掉与 TS 重复的两项，交给 TS 版处理）
  {
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },

  // TypeScript 文件
  {
    files: ['**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // Vue 单文件组件：vue-eslint-parser 解析模板，<script lang="ts"> 委托给 TS 解析器
  {
    files: ['**/*.vue'],
    plugins: { vue: pluginVue, '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: vueParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { parser: tseslint.parser, ecmaFeatures: { vue: true } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'vue/no-unused-components': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
    },
  },

  // micromark / remark 扩展层：内部 API 无类型，any 属合理，精确豁免
  {
    files: ['src/editor/features/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── 门禁脚本自身（scripts/**/*.mjs）────────────────────────────────
  //
  // 为什么它们必须进 lint（2026-10-04）：这 17 个文件 / 5500+ 行是**九道门禁的实现**。
  // 门禁的特殊风险是「假绿」——一个变量名打错、一个 `if (m[2])` 索引错位、一次条件写反，
  // 都**不会让任何测试变红**，因为测试的就是它自己：`check:design` 若在 badZ.push 那行
  // 拼错变量名，它会默默放过所有违规而 CI 全绿。`no-undef` 正是抓这类 bug 最锋利的刀，
  // 而本段落地前 `*.mjs` 被全局 ignore 掉了（实测零 `no-undef` 违规，说明底子干净、改造低风险）。
  //
  // globals 手写而不用 `globals` 包：只列本仓实际用到的 8 个（console/process/setTimeout/
  // clearTimeout/__dirname/performance/globalThis/URL，实测 grep 所得），不引新依赖。
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        __dirname: 'readonly',
        performance: 'readonly',
        globalThis: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      // no-unused-vars：门禁里大量 `st = st.apply(...)` 这类 ProseMirror 链式写法，
      // 其返回值不再被读取 → 属**已知误报**，用局部 eslint-disable 精确豁免（见 test-core.mjs），
      // 而非全局关规则——关掉整条规则等于让「死导入 / 死变量」重新堆积（verify-markdown.mjs
      // 的 join 就是活证据）。ignoreRestSiblings 沿用 TS 段口径。
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
)
