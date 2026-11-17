/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const rootDirectory = join(import.meta.dirname, '..')
const packageDirectory = join(rootDirectory, 'node_modules', 'adblock-rs')
const jsDirectory = join(packageDirectory, 'js')
const addonPath = join(jsDirectory, 'index.node')
const cargoCpArtifact = join(rootDirectory, 'node_modules', '.bin', 'cargo-cp-artifact')
const windowsTarget = 'x86_64-pc-windows-msvc'

if (process.platform === 'darwin') process.env.MACOSX_DEPLOYMENT_TARGET ??= '13.0'

const targetArgumentIndex = process.argv.indexOf('--target')
const target =
  targetArgumentIndex === -1
    ? process.env.DICTOL_ADBLOCK_TARGET
    : process.argv[targetArgumentIndex + 1]

if (!existsSync(packageDirectory)) {
  throw new Error('adblock-rs is not installed; run npm install first')
}

const previousAddonPath = `${addonPath}.previous`
if (existsSync(addonPath)) renameSync(addonPath, previousAddonPath)

try {
  if (!target) {
    runHostBuild()
  } else if (target === windowsTarget) {
    runWindowsCrossBuild()
  } else {
    runRustTargetBuild(target)
  }
} catch (error) {
  if (existsSync(addonPath)) unlinkSync(addonPath)
  if (existsSync(previousAddonPath)) renameSync(previousAddonPath, addonPath)
  throw error
}

if (existsSync(previousAddonPath)) unlinkSync(previousAddonPath)

verifyAddon(target)

function runHostBuild() {
  run('npm', ['--prefix', packageDirectory, 'run', 'build-release'])
}

function runWindowsCrossBuild() {
  if (process.platform === 'win32') {
    run('npm', ['--prefix', packageDirectory, 'run', 'build-release', '--', '--target', target])
    return
  }

  const environment = {
    ...process.env,
    // adblock-rs pins a Rust toolchain that does not necessarily have the
    // target installed. The existing Dictol cross-build setup uses stable.
    RUSTUP_TOOLCHAIN: process.env.DICTOL_RUST_TOOLCHAIN ?? 'stable'
  }

  run(
    cargoCpArtifact,
    [
      '-a',
      'cdylib',
      'adblock-rs',
      'index.node',
      '--',
      'cargo',
      'xwin',
      'build',
      '--message-format=json-render-diagnostics',
      '--release',
      '--target',
      target
    ],
    { cwd: jsDirectory, env: environment }
  )
}

function runRustTargetBuild(rustTarget) {
  const environment = {
    ...process.env,
    RUSTUP_TOOLCHAIN: process.env.DICTOL_RUST_TOOLCHAIN ?? 'stable'
  }

  run(
    cargoCpArtifact,
    [
      '-a',
      'cdylib',
      'adblock-rs',
      'index.node',
      '--',
      'cargo',
      'build',
      '--message-format=json-render-diagnostics',
      '--release',
      '--target',
      rustTarget
    ],
    { cwd: jsDirectory, env: environment }
  )
}

function verifyAddon(rustTarget) {
  const addon = readFileSync(addonPath)
  if (rustTarget === windowsTarget && !isWindowsX64Pe(addon)) {
    throw new Error(`adblock-rs addon is not a Windows x64 PE binary: ${addonPath}`)
  }
  if (rustTarget !== windowsTarget && !isMachO(addon)) {
    throw new Error(`adblock-rs addon is not a macOS Mach-O binary: ${addonPath}`)
  }

  console.log(
    `Verified adblock-rs native addon (${rustTarget ?? process.platform}, ${addon.byteLength} bytes)`
  )
}

function isWindowsX64Pe(binary) {
  if (binary[0] !== 0x4d || binary[1] !== 0x5a) return false
  const peHeaderOffset = binary.readUInt32LE(0x3c)
  return (
    binary.toString('ascii', peHeaderOffset, peHeaderOffset + 4) === 'PE\0\0' &&
    binary.readUInt16LE(peHeaderOffset + 4) === 0x8664
  )
}

function isMachO(binary) {
  const magic = binary.readUInt32BE(0)
  return (
    magic === 0xfeedface ||
    magic === 0xfeedfacf ||
    magic === 0xcefaedfe ||
    magic === 0xcffaedfe ||
    magic === 0xcafebabe
  )
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}
