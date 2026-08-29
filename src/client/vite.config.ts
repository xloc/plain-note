import { defineConfig } from 'vite-plus'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const devPrefix = mode === 'development' ? 'dev-' : ''

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
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
    },
  }
})
