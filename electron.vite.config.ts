import { basename, resolve } from 'path'
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
    plugins: [
      {
        name: 'inline-tts-in-sandboxed-preloads',
        enforce: 'pre',
        resolveId(source, importer) {
          // Sandboxed Electron preloads cannot require a Rollup shared chunk.
          // Give each preload its own copy while keeping one TTS source module.
          if (source === './tts' && importer?.startsWith(resolve('src/preload/'))) {
            return `${resolve('src/preload/tts.ts')}?preload=${basename(importer)}`
          }
          return null
        }
      }
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          dictionary: resolve('src/preload/dictionary.ts'),
          'search-popover': resolve('src/preload/search-popover.ts'),
          'selection-toolbar': resolve('src/preload/selection-toolbar.ts'),
          'selection-explanation': resolve('src/preload/selection-explanation.ts'),
          'external-excerpt': resolve('src/preload/external-excerpt.ts'),
          'selection-entry': resolve('src/preload/selection-entry.ts'),
          'custom-css-editor': resolve('src/preload/custom-css-editor.ts'),
          'find-bar': resolve('src/preload/find-bar.ts'),
          browse: resolve('src/preload/browse.ts')
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
          'external-excerpt': resolve('src/renderer/external-excerpt.html'),
          'find-bar': resolve('src/renderer/find-bar.html'),
          'custom-css-editor': resolve('src/renderer/custom-css-editor.html'),
          browse: resolve('src/renderer/browse.html')
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
