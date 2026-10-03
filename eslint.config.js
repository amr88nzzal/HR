import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'reference/**', 'docs/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // قواعد المشروع (CONVENTIONS.md): دوال arrow، وبلا export default
      'func-style': ['error', 'expression'],
      'no-restricted-exports': ['error', { restrictDefaultExports: { direct: true } }],
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['**/*.config.{js,ts}'], rules: { 'no-restricted-exports': 'off' } },
);
