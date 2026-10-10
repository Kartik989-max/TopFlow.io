import tseslint from 'typescript-eslint';

export default tseslint.config(
  tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', 'tests/**', '*.log'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
'@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-constant-condition': 'off',
    },
  },
);
