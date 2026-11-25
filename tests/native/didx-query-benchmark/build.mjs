import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

const directory = import.meta.dirname
const args = [
  'build',
  '--release',
  '--locked',
  '--manifest-path',
  join(directory, 'Cargo.toml'),
  '--target-dir',
  join(directory, 'target')
]
if (!process.argv.includes('--online')) args.push('--offline')
execFileSync('cargo', args, { stdio: 'inherit' })
const library = {
  win32: 'dictol_didx_query_benchmark.dll',
  darwin: 'libdictol_didx_query_benchmark.dylib',
  linux: 'libdictol_didx_query_benchmark.so'
}[process.platform]
if (!library) throw new Error(`Unsupported platform: ${process.platform}`)
copyFileSync(join(directory, 'target', 'release', library), join(directory, 'benchmark.node'))
console.log('Built isolated release addon (production prebuilds unchanged).')
