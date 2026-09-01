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
      '*.mjs',
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
)
