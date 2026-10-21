import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const packageDirectory = import.meta.dirname
const root = join(packageDirectory, '..', '..')
const args = process.argv.slice(2)
const debug = args.includes('--debug')
const napiArgs = args.filter((arg) => arg !== '--debug')
const targetIndex = napiArgs.indexOf('--target')
const explicitTarget = targetIndex < 0 ? undefined : napiArgs[targetIndex + 1]
if (targetIndex >= 0 && (!explicitTarget || explicitTarget.startsWith('--'))) {
  throw new Error('Missing value after --target')
}

const targets = {
  'x86_64-apple-darwin': { directory: 'darwin-x64', suffix: 'darwin-x64' },
  'aarch64-apple-darwin': { directory: 'darwin-arm64', suffix: 'darwin-arm64' },
  'x86_64-pc-windows-msvc': { directory: 'win32-x64', suffix: 'win32-x64-msvc' },
  'x86_64-unknown-linux-gnu': { directory: 'linux-x64-gnu', suffix: 'linux-x64-gnu' },
  'aarch64-unknown-linux-gnu': { directory: 'linux-arm64-gnu', suffix: 'linux-arm64-gnu' }
}
const hostTarget = {
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu'
}[`${process.platform}-${process.arch}`]
const rustTarget = explicitTarget ?? hostTarget
const output = targets[rustTarget]
if (!output) throw new Error(`No mdict prebuild layout configured for Rust target: ${rustTarget}`)

const napi = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'napi.cmd' : 'napi')
if (!existsSync(napi)) throw new Error(`Missing local NAPI-RS CLI: ${napi}`)
const commandArgs = ['build', '--platform', ...(debug ? [] : ['--release']), ...napiArgs]
if (process.platform === 'win32') {
  execFileSync('cmd.exe', ['/c', napi, ...commandArgs], {
    cwd: packageDirectory,
    stdio: 'inherit'
  })
} else {
  execFileSync(napi, commandArgs, { cwd: packageDirectory, stdio: 'inherit' })
}

const binaryName = `dictol-mdict-node.${output.suffix}.node`
const source = join(packageDirectory, binaryName)
if (!existsSync(source)) throw new Error(`NAPI-RS did not produce ${source}`)

const prebuildDirectory = join(packageDirectory, 'prebuilds', output.directory)
const destination = join(prebuildDirectory, binaryName)
const temporary = `${destination}.${process.pid}.tmp`
mkdirSync(prebuildDirectory, { recursive: true })
copyFileSync(source, temporary)
rmSync(destination, { force: true })
renameSync(temporary, destination)
rmSync(source)
console.log(`Generated mdict prebuild: ${destination}`)
