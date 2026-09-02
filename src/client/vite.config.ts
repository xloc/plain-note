import { defineConfig, loadEnv } from 'vite-plus'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const devPrefix = mode === 'development' ? 'dev-' : ''
  const apiOrigin = loadEnv(mode, '.', '').PLAIN_NOTE_API_ORIGIN || 'http://localhost:8787'

  return {
    plugins: [
      {
        name: 'dev-assets-mode',
        transformIndexHtml: (html) => html.replaceAll('__DEV_PREFIX__', devPrefix),
      },
      vue(),
      tailwindcss(),
    ],
    server: {
      host: true,
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
    },
  }
})
