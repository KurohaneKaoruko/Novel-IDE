import { defineConfig, type PluginOption } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))

async function loadReactPlugin(): Promise<PluginOption[]> {
  try {
    const reactPluginId = '@vitejs/plugin-react'
    const react = (await import(reactPluginId)).default
    if (!react) {
      return []
    }
    return [react()]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[vitest-config] @vitejs/plugin-react is missing, continuing without it. ${message}`)
    return []
  }
}

export default defineConfig(async () => ({
  root: frontendRoot,
  plugins: await loadReactPlugin(),
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['__tests__/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
}))
