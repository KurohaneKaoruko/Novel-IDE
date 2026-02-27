import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const reactRefresh = await import('eslint-plugin-react-refresh')
  .then((mod) => mod.default ?? mod)
  .catch(() => null)

if (!reactRefresh) {
  console.warn(
    '[eslint-config] eslint-plugin-react-refresh is missing, Vite-specific refresh rules are disabled.',
  )
}

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      ...(reactRefresh ? [reactRefresh.configs.vite] : []),
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
