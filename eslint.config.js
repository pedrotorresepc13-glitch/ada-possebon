import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // HOLO original, protótipo legado e bibliotecas de terceiros ficam fora do lint da ADA.
    ignores: [
      'vendor/**', 'props/**', 'holo.html', 'server.py', 'studio/**', 'services/**', 'index.html',
      '**/dist/**', '**/node_modules/**', '.data/**', 'coverage/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error'
    }
  }
);
