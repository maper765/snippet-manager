const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'package-lock.json']
  },
  // Main process e preload — ambiente Node.js
  {
    files: ['main.js', 'preload.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off'
    }
  },
  // Renderer — ambiente browser + globais das libs via CDN
  {
    files: ['renderer.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        hljs: 'readonly',
        marked: 'readonly',
        DOMPurify: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off'
    }
  },
  prettier // desliga regras do ESLint que conflitam com Prettier; tem que ser o último
];
