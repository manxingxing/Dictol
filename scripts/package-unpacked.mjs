import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const binary = join(
  import.meta.dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
)
execFileSync(binary, ['--dir', ...process.argv.slice(2)], {
  cwd: join(import.meta.dirname, '..'),
  env: process.env,
  stdio: 'inherit'
})
