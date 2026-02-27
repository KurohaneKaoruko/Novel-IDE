import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type PluginOption } from 'vite'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))

async function loadReactPlugin(): Promise<PluginOption[]> {
  try {
    const reactPluginId = '@vitejs/plugin-react'
    const react = (await import(reactPluginId)).default
    if (!react) {
      return []
    }
    return [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
    ]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[vite-config] @vitejs/plugin-react is missing, falling back to esbuild JSX transform. ${message}`,
    )
    return []
  }
}

export default defineConfig(async () => ({
  root: frontendRoot,
  plugins: await loadReactPlugin(),
  clearScreen: false,
  build: {
    outDir: path.join(frontendRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
}))
