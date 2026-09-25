import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * electron-builder skips the outer app signature when mac.identity is null,
 * but native addons and downloaded Electron frameworks can still carry
 * ad-hoc signatures. Remove those signatures too so the macOS artifact is
 * consistently unsigned.
 */
function collectCandidates(root) {
  const files = []
  const bundles = []

  const visit = (path) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return

    if (stat.isDirectory()) {
      if (path.endsWith('.app') || path.endsWith('.framework')) bundles.push(path)
      for (const entry of readdirSync(path)) visit(join(path, entry))
      return
    }

    if (
      path.includes('/Contents/MacOS/') ||
      path.includes('/Contents/Frameworks/') ||
      path.endsWith('.node') ||
      path.endsWith('.dylib')
    ) {
      files.push(path)
    }
  }

  visit(root)
  return { bundles, files }
}

function targetDarwinArch(context) {
  // builder-util's Arch enum is ia32=0, x64=1, armv7l=2, arm64=3.
  if (context.arch === 1 || context.arch === 'x64') return 'x64'
  if (context.arch === 3 || context.arch === 'arm64') return 'arm64'
  throw new Error(`Unsupported macOS package architecture: ${String(context.arch)}`)
}

function fileArchitecture(path) {
  return execFileSync('file', ['-b', path], { encoding: 'utf8' }).trim()
}

function isWindowsX64Pe(path) {
  const binary = readFileSync(path)
  if (binary.length < 0x40 || binary[0] !== 0x4d || binary[1] !== 0x5a) return false

  const peHeaderOffset = binary.readUInt32LE(0x3c)
  return (
    peHeaderOffset + 6 <= binary.length &&
    binary.toString('ascii', peHeaderOffset, peHeaderOffset + 4) === 'PE\0\0' &&
    binary.readUInt16LE(peHeaderOffset + 4) === 0x8664
  )
}

function resolveAppBundle(appOutDir) {
  if (appOutDir.endsWith('.app')) return appOutDir

  const appBundle = readdirSync(appOutDir).find((entry) => entry.endsWith('.app'))
  if (!appBundle) throw new Error(`Packaged macOS app bundle not found in: ${appOutDir}`)
  return join(appOutDir, appBundle)
}

function pruneAndVerifyNativeModules(appPath, arch) {
  const unpacked = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
  const otherArch = arch === 'x64' ? 'arm64' : 'x64'
  const expected = [
    join(unpacked, '@dictol', 'mdict-native', `dictol-mdict-node.darwin-${arch}.node`),
    join(unpacked, 'better-sqlite3', 'prebuilds', `darwin-${arch}.node`),
    join(unpacked, 'selection-hook', 'prebuilds', `darwin-${arch}`, 'selection-hook.node')
  ]
  const opposite = [
    join(unpacked, '@dictol', 'mdict-native', `dictol-mdict-node.darwin-${otherArch}.node`),
    join(unpacked, 'better-sqlite3', 'prebuilds', `darwin-${otherArch}.node`),
    join(unpacked, 'selection-hook', 'prebuilds', `darwin-${otherArch}`, 'selection-hook.node')
  ]

  for (const path of opposite) {
    if (existsSync(path)) rmSync(path)
  }

  const adblock = join(unpacked, 'adblock-rs', 'js', 'index.node')
  expected.push(adblock)

  for (const path of expected) {
    if (!existsSync(path)) throw new Error(`Missing ${arch} macOS native module: ${path}`)

    const description = fileArchitecture(path)
    const expectedLabel = arch === 'arm64' ? 'arm64' : 'x86_64'
    if (!description.includes(expectedLabel)) {
      throw new Error(
        `Wrong architecture in macOS native module: ${path}\n` +
          `expected=${expectedLabel}, file=${description}`
      )
    }
  }

  console.log(`  • verified macOS native modules arch=${arch} count=${expected.length}`)
}

function verifyWindowsNativeModules(appOutDir, arch) {
  if (arch !== 'x64') throw new Error(`Only Windows x64 is supported, received: ${arch}`)

  const unpacked = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
  const expected = [
    join(unpacked, '@dictol', 'mdict-native', 'dictol-mdict-node.win32-x64-msvc.node'),
    join(unpacked, 'adblock-rs', 'js', 'index.node'),
    join(unpacked, 'better-sqlite3', 'prebuilds', 'win32-x64.node'),
    join(unpacked, 'selection-hook', 'prebuilds', 'win32-x64', 'selection-hook.node')
  ]

  const nativePackageRoots = [
    join(unpacked, '@dictol', 'mdict-native'),
    join(unpacked, 'adblock-rs'),
    join(unpacked, 'better-sqlite3'),
    join(unpacked, 'selection-hook')
  ]

  const expectedSet = new Set(expected)
  const unexpected = []
  const visit = (path) => {
    if (!existsSync(path)) return
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry))
      return
    }
    if (path.endsWith('.node') && !expectedSet.has(path)) unexpected.push(path)
  }
  for (const root of nativePackageRoots) visit(root)
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected Windows native modules found in packaged app:\n${unexpected.join('\n')}`
    )
  }

  const executable = join(appOutDir, 'dictol.exe')
  if (!existsSync(executable) || !isWindowsX64Pe(executable)) {
    throw new Error(
      `Windows x64 executable is missing or has the wrong architecture: ${executable}`
    )
  }

  for (const path of expected) {
    if (!existsSync(path) || !isWindowsX64Pe(path)) {
      throw new Error(`Windows x64 native module is missing or has the wrong architecture: ${path}`)
    }
  }

  const mdict = expected[0]
  const mdictBinary = readFileSync(mdict)
  const requiredExports = ['Mdx', 'Mdd', 'MddList', 'hashFile']
  const missingExports = requiredExports.filter((name) => !mdictBinary.includes(Buffer.from(name)))
  if (missingExports.length > 0) {
    throw new Error(
      `Packaged Windows mdict binding is missing exports: ${missingExports.join(', ')}`
    )
  }

  console.log(`  • verified Windows native modules arch=${arch} count=${expected.length}`)
}

export default async function stripMacOSSignatures(context) {
  if (context.electronPlatformName === 'win32') {
    const arch = context.arch === 1 || context.arch === 'x64' ? 'x64' : String(context.arch)
    verifyWindowsNativeModules(context.appOutDir, arch)
    return
  }
  if (context.electronPlatformName !== 'darwin') return

  const appPath = resolveAppBundle(context.appOutDir)
  if (!existsSync(appPath)) throw new Error(`Packaged app does not exist: ${appPath}`)

  const arch = targetDarwinArch(context)
  pruneAndVerifyNativeModules(appPath, arch)

  const { bundles, files } = collectCandidates(appPath)
  const candidates = [appPath, ...bundles, ...files]
  let removed = 0

  for (const candidate of candidates) {
    try {
      execFileSync('codesign', ['--remove-signature', candidate], { stdio: 'ignore' })
      removed += 1
    } catch {
      // Non-signable files and already unsigned objects are expected here.
    }
  }

  console.log(`  • stripped macOS code signatures count=${removed}`)
}
