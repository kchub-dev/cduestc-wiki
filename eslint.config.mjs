import antfu from '@antfu/eslint-config'

export default antfu({
    stylistic: {
        indent: 4,
    },
    rules: {
        'jsonc/indent': ['error', 2],
        'vue/block-lang': ['warn', {
            script: { lang: ['ts', 'tsx'] },
        }],
        'vue/enforce-style-attribute': ['warn', {
            allow: ['scoped'],
        }],
        'yaml/indent': ['error', 2],
    },
}, {
    files: ['**/*.json'],
    rules: {
        'jsonc/sort-keys': 'off',
        'style/eol-last': 'off',
    },
}, {
    // 浏览器扩展代码：chrome API 全局 + 允许 console 调试输出
    files: ['extension/**/*.js'],
    languageOptions: {
        globals: {
            chrome: 'readonly',
        },
    },
    rules: {
        'no-console': 'off',
    },
}, {
    // 扩展的 Node 工具脚本（图标生成等）
    files: ['extension/tools/**/*.mjs'],
    rules: {
        'no-console': 'off',
        'node/prefer-global/buffer': 'off',
    },
})
