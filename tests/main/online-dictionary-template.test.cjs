/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '../..')

function loadModule(entry) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false
  })
  const compiled = new Module(path.join(root, 'online-dictionary-test.cjs'), module)
  compiled.filename = path.join(root, 'online-dictionary-test.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports
}

test('replaces supported placeholders without changing other template text', () => {
  const { fillDictionaryUrlTemplate: fill } = loadModule('src/shared/online-dictionary-template.ts')
  assert.equal(
    fill('https://example.com/{uc_d}/{uc_u}?q=%s&word={w}&again={uc_d}&x={other}', '兔子'),
    'https://example.com/20820/U05154?q=%E5%85%94%E5%AD%90&word=%E5%85%94%E5%AD%90&again=20820&x={other}'
  )
  assert.equal(
    fill('{uc_d}/{uc_u}/%s/{w}', '𠀀字'),
    '131072/U20000/%F0%A0%80%80%E5%AD%97/%F0%A0%80%80%E5%AD%97'
  )
  assert.equal(fill('{uc_u}/{uc_d}', '😀'), 'U1F600/128512')
  assert.equal(fill('%s/{w}', 'a b/%s'), 'a%20b%2F%25s/a%20b%2F%25s')
  assert.equal(fill('https://example.com/{other}', '兔'), 'https://example.com/{other}')
})

test('opens and updates online dictionary tabs using the same template', () => {
  const { useAppStore } = loadModule('src/renderer/src/stores/app-store.ts')
  useAppStore.getState().openOnlineDictionaryTab(
    {
      id: '1',
      name: 'Test',
      faviconUrl: '',
      urlTemplate: 'https://example.com/{uc_d}/{uc_u}/{w}/%s'
    },
    ' 兔子 '
  )
  assert.equal(
    useAppStore.getState().rightSidebarTabs[0].url,
    'https://example.com/20820/U05154/%E5%85%94%E5%AD%90/%E5%85%94%E5%AD%90'
  )
  useAppStore.getState().followSearchInRightSidebarTabs('𠀀')
  assert.equal(
    useAppStore.getState().rightSidebarTabs[0].url,
    'https://example.com/131072/U20000/%F0%A0%80%80/%F0%A0%80%80'
  )
})

test('accepts valid templates with any or no recognized placeholders', async () => {
  const { OnlineDictionaryRepository } = loadModule(
    'src/main/db/repository/online-dictionary-repository.ts'
  )
  const db = { insert: () => ({ values: (values) => ({ returning: async () => [values] }) }) }
  const repository = new OnlineDictionaryRepository(db)
  for (const urlTemplate of [
    'https://example.com/{uc_d}',
    'https://example.com/{other}',
    'https://example.com/'
  ]) {
    const result = await repository.create({ name: 'Test', urlTemplate })
    assert.equal(result.urlTemplate, urlTemplate)
    assert.equal(result.faviconUrl, 'https://example.com/favicon.ico')
  }
  await assert.rejects(
    repository.create({ name: 'Test', urlTemplate: 'file:///tmp/{w}' }),
    /HTTP 或 HTTPS/
  )
})
