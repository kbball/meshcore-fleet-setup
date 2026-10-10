import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // domain and app stay free of browser/infrastructure; layering is enforced here
    files: ['src/domain/**', 'src/app/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/adapters/*', '**/ui/*', 'react', 'react-dom'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // tests may wire in the memory adapter
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
)
