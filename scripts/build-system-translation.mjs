import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'darwin') {
  console.log('System translation is only built on macOS.')
  process.exit(0)
}

const root = join(import.meta.dirname, '..')
const source = join(root, 'native', 'system-translation', 'main.swift')
const destinationDirectory = join(root, 'resources', 'system-translation')
const destination = join(destinationDirectory, 'dictol-system-translation')
const buildDirectory = mkdtempSync(join(tmpdir(), 'dictol-system-translation-'))
const moduleCache = join(tmpdir(), 'dictol-system-translation-module-cache')
const archArgumentIndex = process.argv.indexOf('--arch')
const architectures = process.argv.includes('--universal')
  ? ['x64', 'arm64']
  : [archArgumentIndex < 0 ? process.arch : process.argv[archArgumentIndex + 1]]
const targets = { x64: 'x86_64-apple-macos15.0', arm64: 'arm64-apple-macos15.0' }

try {
  const binaries = architectures.map((architecture) => {
    const target = targets[architecture]
    if (!target) throw new Error(`Unsupported macOS architecture: ${architecture}`)
    const binary = join(buildDirectory, architecture)
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-parse-as-library',
        '-O',
        '-target',
        target,
        '-module-cache-path',
        moduleCache,
        '-o',
        binary,
        source
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: moduleCache,
          SWIFT_MODULE_CACHE_PATH: moduleCache
        }
      }
    )
    return binary
  })

  mkdirSync(destinationDirectory, { recursive: true })
  if (binaries.length === 1) {
    copyFileSync(binaries[0], destination)
  } else {
    execFileSync('lipo', ['-create', ...binaries, '-output', destination], { stdio: 'inherit' })
  }
  chmodSync(destination, 0o755)
  console.log(`Built system translation helper: ${destination}`)
} finally {
  rmSync(buildDirectory, { recursive: true, force: true })
}
