import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)

const addonPath = join(
  import.meta.dirname,
  '..',
  'node_modules',
  '@cherrystudio',
  'mac-system-ocr',
  'build',
  'Release',
  'mac_system_ocr.node'
)
const expectedArchitecture = process.arch === 'arm64' ? 'arm64' : 'x86_64'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function hasExpectedArchitecture() {
  if (!existsSync(addonPath)) return false
  const architectures = execFileSync('lipo', ['-archs', addonPath], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
  return architectures.includes(expectedArchitecture)
}

if (hasExpectedArchitecture()) process.exit(0)

execFileSync('npm', ['rebuild', '@cherrystudio/mac-system-ocr'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, npm_config_arch: process.arch },
  stdio: 'inherit'
})

if (!hasExpectedArchitecture()) {
  throw new Error(`macOS OCR addon missing for ${expectedArchitecture}: ${addonPath}`)
}
