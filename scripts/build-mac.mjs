import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const arch = process.argv[2]
const targets = {
  x64: { native: 'x86_64-apple-darwin', builder: '--x64' },
  arm64: { native: 'aarch64-apple-darwin', builder: '--arm64' }
}

const target = targets[arch]
if (!target) throw new Error(`Expected macOS architecture x64 or arm64, received: ${arch}`)

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

const runNpm = (args, env = {}) =>
  execFileSync(npm, args, {
    cwd: root,
    env: { ...process.env, ...env },
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
  runNpm(['run', 'native:build'], { DICTOL_NATIVE_TARGET: target.native })
  runNpm(['run', 'adblock:build', '--', '--target', target.native])
  runNpm(['run', 'typecheck'])
  runBinary('electron-vite', ['build'])
  runBinary('electron-builder', ['--mac', target.builder, ...process.argv.slice(3)])
} catch (error) {
  buildError = error
}

let restoreError
try {
  // Cross-building adblock-rs replaces the shared workspace addon. Always
  // restore the host addon, including when packaging or validation fails.
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
  console.error('macOS build failed; host adblock restore was attempted.')
  process.exitCode = 1
} else if (restoreError) {
  console.error('macOS build succeeded, but restoring the host adblock addon failed.')
  process.exitCode = 1
}
