import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // Drizzle is only used by the Electron main process. Bundle the used
      // SQLite implementation so electron-builder does not ship its unused
      // database drivers.
      externalizeDeps: {
        exclude: ['drizzle-orm']
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'dictionary-import-worker': resolve('src/main/dictionary-import-worker.ts'),
          'wordbook-export-worker': resolve('src/main/wordbook-export-worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          dictionary: resolve('src/preload/dictionary.ts'),
          'search-popover': resolve('src/preload/search-popover.ts'),
          'selection-toolbar': resolve('src/preload/selection-toolbar.ts'),
          'selection-explanation': resolve('src/preload/selection-explanation.ts'),
          'selection-entry': resolve('src/preload/selection-entry.ts'),
          'custom-css-editor': resolve('src/preload/custom-css-editor.ts'),
          'find-bar': resolve('src/preload/find-bar.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'search-popover': resolve('src/renderer/search-popover.html'),
          'selection-toolbar': resolve('src/renderer/selection-toolbar.html'),
          'selection-explanation': resolve('src/renderer/selection-explanation.html'),
          'find-bar': resolve('src/renderer/find-bar.html'),
          'custom-css-editor': resolve('src/renderer/custom-css-editor.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
