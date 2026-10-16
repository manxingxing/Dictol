import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(import.meta.dirname, '..')
const addonPath = join(root, 'node_modules', 'adblock-rs', 'js', 'index.node')
const ocrAddonPath = join(
  root,
  'node_modules',
  '@cherrystudio',
  'mac-system-ocr',
  'build',
  'Release',
  'mac_system_ocr.node'
)
const nativeDirectory = join(root, 'native', 'mdict-node')
const targets = [
  { rust: 'x86_64-apple-darwin', napi: 'darwin-x64', lipo: 'x86_64', nodeArch: 'x64' },
  { rust: 'aarch64-apple-darwin', napi: 'darwin-arm64', lipo: 'arm64', nodeArch: 'arm64' }
]

if (process.platform !== 'darwin') {
  throw new Error('The universal macOS build must run on macOS (lipo and macOS SDK required).')
}
if (!existsSync(addonPath)) throw new Error(`Missing adblock-rs addon: ${addonPath}`)
if (!existsSync(ocrAddonPath)) throw new Error(`Missing macOS OCR addon: ${ocrAddonPath}`)

const tempDirectory = mkdtempSync(join(tmpdir(), 'dictol-mac-universal-'))
const originalAddon = join(tempDirectory, 'adblock-index.original.node')
const originalOcrAddon = join(tempDirectory, 'mac-system-ocr.original.node')
copyFileSync(addonPath, originalAddon)
copyFileSync(ocrAddonPath, originalOcrAddon)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const binary = (name) => {
  const path = join(root, 'node_modules', '.bin', name)
  if (!existsSync(path)) throw new Error(`Missing local build command: ${path}`)
  return path
}

const runNpm = (args, env = {}) =>
  execFileSync(npm, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  })

const runBinary = (name, args, env = {}) =>
  execFileSync(binary(name), args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  })

const buildNativeForTarget = (target) => {
  runNpm(['run', 'native:build'], { DICTOL_NATIVE_TARGET: target.rust })
  const addon = join(nativeDirectory, `dictol-mdict-node.${target.napi}.node`)
  if (!existsSync(addon)) {
    throw new Error(`Native binding build did not produce ${target.napi}: ${addon}`)
  }
  verifyArchitecture(addon, target.lipo)
}

const buildAdblockForTarget = (target, outputPath) => {
  runNpm(['run', 'adblock:build', '--', '--target', target.rust])
  verifyArchitecture(addonPath, target.lipo)
  copyFileSync(addonPath, outputPath)
}

const buildOcrForTarget = (target, outputPath) => {
  runNpm(['rebuild', '@cherrystudio/mac-system-ocr'], { npm_config_arch: target.nodeArch })
  verifyArchitecture(ocrAddonPath, target.lipo)
  copyFileSync(ocrAddonPath, outputPath)
}

const verifyArchitecture = (path, architecture) => {
  const description = execFileSync('file', ['-b', path], { encoding: 'utf8' })
  if (!description.includes(architecture)) {
    throw new Error(
      `Built native module has the wrong architecture: ${path}\n` +
        `expected=${architecture}, file=${description.trim()}`
    )
  }
}

try {
  for (const target of targets) buildNativeForTarget(target)
  runNpm(['run', 'system-translation:build', '--', '--universal'])

  const x64Adblock = join(tempDirectory, 'adblock-x64.node')
  const arm64Adblock = join(tempDirectory, 'adblock-arm64.node')
  const universalAdblock = join(tempDirectory, 'adblock-universal.node')
  buildAdblockForTarget(targets[0], x64Adblock)
  buildAdblockForTarget(targets[1], arm64Adblock)
  execFileSync('lipo', ['-create', x64Adblock, arm64Adblock, '-output', universalAdblock], {
    stdio: 'inherit'
  })
  execFileSync('lipo', [universalAdblock, '-verify_arch', 'x86_64', 'arm64'], {
    stdio: 'inherit'
  })
  copyFileSync(universalAdblock, addonPath)

  const x64Ocr = join(tempDirectory, 'ocr-x64.node')
  const arm64Ocr = join(tempDirectory, 'ocr-arm64.node')
  const universalOcr = join(tempDirectory, 'ocr-universal.node')
  buildOcrForTarget(targets[0], x64Ocr)
  buildOcrForTarget(targets[1], arm64Ocr)
  execFileSync('lipo', ['-create', x64Ocr, arm64Ocr, '-output', universalOcr], {
    stdio: 'inherit'
  })
  execFileSync('lipo', [universalOcr, '-verify_arch', 'x86_64', 'arm64'], {
    stdio: 'inherit'
  })
  copyFileSync(universalOcr, ocrAddonPath)

  runNpm(['run', 'typecheck'])
  runBinary('electron-vite', ['build'])
  runBinary('electron-builder', ['--mac', '--universal', ...process.argv.slice(2)], {
    DICTOL_MAC_UNIVERSAL: '1'
  })
} finally {
  copyFileSync(originalAddon, addonPath)
  copyFileSync(originalOcrAddon, ocrAddonPath)
  rmSync(tempDirectory, { recursive: true, force: true })
}
