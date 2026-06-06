// Fast in-editor mirror of the boundary rules. dependency-cruiser is the authoritative
// graph firewall (see .dependency-cruiser.cjs); ESLint catches the obvious cases per-file.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.vite/**', 'out/**', 'node_modules/**', 'plans/**', 'scripts/**', '*.config.*', '**/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../main/*', '../pty-host/*', '../preload/*', '@main/*', '@pty-host/*', '@preload/*'],
              message: 'Processes talk only through shared/ipc — do not import another process directly.',
            },
          ],
        },
      ],
    },
  },
);
