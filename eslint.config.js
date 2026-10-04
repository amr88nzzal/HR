import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'reference/**',
      'docs/**',
      'spikes/**',
      'coverage/**',
    ],
  },
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
  {
    // حدود الوحدات (CONVENTIONS.md قسم 7.4): لا يُستورد من وحدة أخرى إلا عبر index.ts الخاص بها
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: 'apps/api/tsconfig.json' } },
      'boundaries/elements': [
        { type: 'module', pattern: 'apps/api/src/modules/*', capture: ['name'] },
        { type: 'shared', pattern: 'apps/api/src/shared' },
        { type: 'db', pattern: 'apps/api/src/db' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'module' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            { from: { element: { type: 'module' } }, allow: { to: { element: { type: 'db' } } } },
            {
              from: { element: { type: 'module' } },
              allow: {
                to: { element: { type: 'module', captured: { name: '{{from.captured.name}}' } } },
              },
            },
            {
              from: { element: { type: 'module' } },
              allow: { to: { element: { type: 'module' }, file: { path: '**/index.ts' } } },
            },
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            { from: { element: { type: 'shared' } }, allow: { to: { element: { type: 'db' } } } },
            { from: { element: { type: 'db' } }, allow: { to: { element: { type: 'db' } } } },
          ],
        },
      ],
    },
  },
  { files: ['**/*.config.{js,ts}'], rules: { 'no-restricted-exports': 'off' } },
);
