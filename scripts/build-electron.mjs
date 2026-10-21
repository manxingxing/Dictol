import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: npm run build:electron -- --platform <mac|win> --arch <x64|arm64>\n' +
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
    'Usage: npm run build:electron -- --platform <mac|win> --arch <x64|arm64>\n' +
      'Supported targets: mac x64, mac arm64, win x64'
  )
}

let builderPlatformArgs
const env = process.env
if (platform === 'mac' && process.platform !== 'darwin') {
  throw new Error('macOS packaging must run on macOS.')
} else if (platform === 'mac' && arch === 'x64') builderPlatformArgs = ['--mac', '--x64']
else if (platform === 'mac' && arch === 'arm64') builderPlatformArgs = ['--mac', '--arm64']
else if (platform === 'win' && arch === 'x64') {
  builderPlatformArgs = ['--win', '--x64']
} else {
  throw new Error(`Unsupported Electron packaging target: ${platform} ${arch}`)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const runNpm = (script, extraArgs = []) =>
  execFileSync(npm, ['run', script, ...(extraArgs.length ? ['--', ...extraArgs] : [])], {
    cwd: root,
    env,
    stdio: 'inherit'
  })
const runBinary = (name, commandArgs) => {
  const binary = join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name
  )
  if (!existsSync(binary)) throw new Error(`Missing local build command: ${binary}`)
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/c', binary, ...commandArgs], { cwd: root, env, stdio: 'inherit' })
  } else {
    execFileSync(binary, commandArgs, { cwd: root, env, stdio: 'inherit' })
  }
}

if (platform === 'win') runNpm('win:signing:check')
runNpm('typecheck')
runBinary('electron-vite', ['build'])
if (platform === 'mac') runNpm('system-translation:stage', ['--arch', arch])
runBinary('electron-builder', builderPlatformArgs)
if (platform === 'win') runNpm('windows:sign-artifacts')

console.log(`Electron application packaged for ${platform} ${arch}.`)
