import { defineConfig, type PluginOption } from 'vite'

async function loadReactPlugin(): Promise<PluginOption[]> {
  try {
    const react = (await import('@vitejs/plugin-react')).default
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
  plugins: await loadReactPlugin(),
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
}))
