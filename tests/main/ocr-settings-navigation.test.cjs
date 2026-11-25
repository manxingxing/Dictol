const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { MemoryRouter, Routes, Route } = require('react-router-dom')

for (const platform of ['win32', 'darwin']) {
  test(platform + ' settings navigation exposes OCR only on Windows', async () => {
    const root = path.resolve(__dirname, '../..')
    const result = await esbuild.build({
      entryPoints: [path.join(root, 'src/renderer/src/pages/SettingsPage.tsx')],
      tsconfig: path.join(root, 'tsconfig.web.json'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['react', 'react-dom', 'react-router-dom'],
      write: false
    })
    const previousWindow = globalThis.window
    globalThis.window = { dictol: { platform } }
    try {
      const compiled = new Module(__filename, module)
      compiled.filename = __filename
      compiled.paths = module.paths
      compiled._compile(result.outputFiles[0].text, __filename)
      const markup = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/settings/appearance'] },
          React.createElement(
            Routes,
            null,
            React.createElement(
              Route,
              { path: '/settings', element: React.createElement(compiled.exports.SettingsPage) },
              React.createElement(Route, {
                path: 'appearance',
                element: React.createElement('span')
              })
            )
          )
        )
      )
      assert.equal(markup.includes('href="/settings/ocr"'), platform === 'win32')
    } finally {
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    }
  })
}
