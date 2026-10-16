import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
if (process.platform !== 'linux') {
  throw new Error(
    'Linux packaging must run on Linux so the SQLite extension matches the target runtime.'
  )
}

const bin = (name) => {
  const command = join(root, 'node_modules', '.bin', name)
  if (!existsSync(command)) throw new Error(`Missing local build command: ${command}`)
  return command
}
const runBinary = (name, args, env = {}) =>
  execFileSync(bin(name), args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  })

runBinary('electron-vite', ['build'])
runBinary('electron-builder', ['--linux', ...process.argv.slice(2)])
