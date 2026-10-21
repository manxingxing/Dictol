import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: npm run build:native -- --platform <mac|win> --arch <x64|arm64>\n' +
      'Targets: mac x64, mac arm64, win x64'
  )
  process.exit(0)
}
const options = new Map()
for (let index = 0; index < args.length; index += 2) {
  const name = args[index]
  const value = args[index + 1]
  if (!['--platform', '--arch'].includes(name) || !value || value.startsWith('--')) {
    throw new Error('Only --platform and --arch are supported; run with --help for usage.')
  }
  if (options.has(name)) throw new Error(`Duplicate option: ${name}`)
  options.set(name, value)
}

const platform = options.get('--platform')
const arch = options.get('--arch')
if (!platform || !arch || args.length !== options.size * 2) {
  throw new Error(
    'Usage: npm run build:native -- --platform <mac|win> --arch <x64|arm64>\n' +
      'Supported targets: mac x64, mac arm64, win x64'
  )
}

if (platform === 'mac' && process.platform !== 'darwin') {
  throw new Error('macOS native dependencies must be built on macOS.')
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const runNpm = (script, extraArgs = [], env = {}) =>
  execFileSync(npm, ['run', script, ...(extraArgs.length ? ['--', ...extraArgs] : [])], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  })

if (platform === 'mac' && ['x64', 'arm64'].includes(arch)) {
  const target = arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin'
  runNpm('native:build', [], {
    DICTOL_NATIVE_TARGET: target,
    MACOSX_DEPLOYMENT_TARGET: '14.0'
  })
  runNpm('system-translation:build', ['--arch', arch])
  runNpm('adblock:build', ['--target', target])
} else if (platform === 'win' && arch === 'x64') {
  runNpm('win:signing:check')
  runNpm('native:build:win-x64')
  runNpm('adblock:build:win-x64')
  runNpm('native:sign:win-x64')
} else {
  throw new Error(`Unsupported native build target: ${platform} ${arch}`)
}

console.log(`Native dependencies are ready for ${platform} ${arch}.`)
