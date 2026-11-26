import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // The browser utility process needs its own bundle, separate from main.
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'browser-worker/index': resolve('src/main/browser-worker/index.ts'),
          'desktop-worker/index': resolve('src/main/desktop-worker/index.ts')
        }
      }
    }
  },
  // Sandboxed preload scripts cannot use ESM imports; emit a self-contained CJS bundle.
  preload: {
    build: {
      lib: { formats: ['cjs'] },
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
