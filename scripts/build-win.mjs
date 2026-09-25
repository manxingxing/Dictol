import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const bin = (name) => {
  const command = join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name
  )
  if (!existsSync(command)) throw new Error(`Missing local build command: ${command}`)
  return command
}

const runNpm = (args) =>
  execFileSync(npm, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })

const runBinary = (name, args) =>
  execFileSync(bin(name), args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })

let buildError
try {
  runNpm(['run', 'win:signing:check'])
  runNpm(['run', 'native:build:win-x64'])
  runNpm(['run', 'adblock:build:win-x64'])
  runNpm(['run', 'native:sign:win-x64'])
  runNpm(['run', 'typecheck'])
  runBinary('electron-vite', ['build'])
  runBinary('electron-builder', ['--win', '--x64', ...process.argv.slice(2)])
  runNpm(['run', 'windows:sign-artifacts'])
} catch (error) {
  buildError = error
}

let restoreError
try {
  // Cross-building adblock-rs replaces the shared workspace addon. Restore
  // the host addon even when signing, packaging, or validation fails.
  const hostTarget =
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'aarch64-apple-darwin'
        : 'x86_64-apple-darwin'
      : undefined
  const args = ['run', 'adblock:build']
  if (hostTarget) args.push('--', '--target', hostTarget)
  runNpm(args)
} catch (error) {
  restoreError = error
}

if (buildError) {
  console.error('Windows build failed; host adblock restore was attempted.')
  process.exitCode = 1
} else if (restoreError) {
  console.error('Windows build succeeded, but restoring the host adblock addon failed.')
  process.exitCode = 1
}
