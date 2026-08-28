import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    printWidth: 120,
    semi: false,
    singleQuote: true,
    sortPackageJson: false,
    sortTailwindcss: {
      stylesheet: './src/client/src/style.css',
    },
  },
})
