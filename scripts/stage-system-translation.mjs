import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform !== 'darwin') {
  console.log('System translation staging is only used on macOS.')
  process.exit(0)
}

const root = join(import.meta.dirname, '..')
const archArgumentIndex = process.argv.indexOf('--arch')
const architecture = archArgumentIndex < 0 ? process.arch : process.argv[archArgumentIndex + 1]
if (!architecture || architecture.startsWith('--')) throw new Error('Missing value after --arch')
if (!['x64', 'arm64'].includes(architecture)) {
  throw new Error(`Unsupported system translation architecture: ${architecture}`)
}

const prebuild = join(
  root,
  'native',
  'system-translation',
  'prebuilds',
  `darwin-${architecture}`,
  'dictol-system-translation'
)
if (!existsSync(prebuild)) {
  throw new Error(`Missing system translation prebuild for macOS ${architecture}: ${prebuild}`)
}

const destinationDirectory = join(root, 'resources', 'system-translation')
const destination = join(destinationDirectory, 'dictol-system-translation')
mkdirSync(destinationDirectory, { recursive: true })
copyFileSync(prebuild, destination)
chmodSync(destination, 0o755)
console.log(`Staged macOS ${architecture} system translation helper: ${destination}`)
