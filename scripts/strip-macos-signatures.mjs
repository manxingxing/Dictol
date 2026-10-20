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

function verifySystemTranslationHelper(appPath, architectures) {
  const helper = join(
    appPath,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'resources',
    'system-translation',
    'dictol-system-translation'
  )
  if (!existsSync(helper)) throw new Error(`Missing packaged system translation helper: ${helper}`)

  const stat = lstatSync(helper)
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new Error(`Packaged system translation helper is not executable: ${helper}`)
  }

  try {
    execFileSync('lipo', [helper, '-verify_arch', ...architectures], { stdio: 'ignore' })
  } catch {
    throw new Error(
      `Wrong architecture in packaged system translation helper: ${helper}\n` +
        `expected=${architectures.join(', ')}, file=${fileArchitecture(helper)}`
    )
  }

  console.log(`  • verified system translation helper arch=${architectures.join(', ')}`)
}

function pruneAndVerifyNativeModules(appPath, arch) {
  const unpacked = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
  const otherArch = arch === 'x64' ? 'arm64' : 'x64'
  const expected = [
    join(unpacked, '@dictol', 'mdict-native', `dictol-mdict-node.darwin-${arch}.node`),
    join(
      unpacked,
      '@dictol',
      'accessibility-native',
      'prebuilds',
      `darwin-${arch}`,
      'accessibility.node'
    ),
    join(
      unpacked,
      '@dictol',
      'screen-capture-native',
      'prebuilds',
      `darwin-${arch}`,
      'screen-capture.node'
    ),
    join(unpacked, 'better-sqlite3', 'prebuilds', `darwin-${arch}.node`),
    join(unpacked, 'selection-hook', 'prebuilds', `darwin-${arch}`, 'selection-hook.node')
  ]
  const opposite = [
    join(unpacked, '@dictol', 'mdict-native', `dictol-mdict-node.darwin-${otherArch}.node`),
    join(
      unpacked,
      '@dictol',
      'accessibility-native',
      'prebuilds',
      `darwin-${otherArch}`,
      'accessibility.node'
    ),
    join(
      unpacked,
      '@dictol',
      'screen-capture-native',
      'prebuilds',
      `darwin-${otherArch}`,
      'screen-capture.node'
    ),
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

function verifyRapidOcrAssets(appPath, architectures) {
  const unpacked = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
  const models = join(unpacked, 'resources', 'rapidocr')
  for (const name of [
    'PP-OCRv6_det_small.onnx',
    'PP-OCRv6_rec_small.onnx',
    'ch_ppocr_mobile_v2.0_cls_mobile.onnx',
    'multi_PP-OCRv6_rec_small-dictionary.txt'
  ]) {
    const path = join(models, name)
    if (!existsSync(path)) throw new Error(`Missing packaged RapidOCR model: ${path}`)
  }

  const ortBin = join(unpacked, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
  for (const platform of ['linux', 'win32']) {
    rmSync(join(ortBin, platform), { recursive: true, force: true })
  }
  for (const arch of ['x64', 'arm64']) {
    if (!architectures.includes(arch)) {
      rmSync(join(ortBin, 'darwin', arch), { recursive: true, force: true })
      continue
    }
    const expectedArchitecture = arch === 'x64' ? 'x86_64' : 'arm64'
    const ortArchDirectory = join(ortBin, 'darwin', arch)
    const ortLibrary = existsSync(ortArchDirectory)
      ? readdirSync(ortArchDirectory).find((name) => /^libonnxruntime\..*\.dylib$/.test(name))
      : undefined
    if (!ortLibrary) throw new Error(`Missing packaged ONNX Runtime library: ${ortArchDirectory}`)
    const nativePaths = [
      join(ortArchDirectory, 'onnxruntime_binding.node'),
      join(ortArchDirectory, ortLibrary)
    ]
    const imgRoot = join(unpacked, 'node_modules', '@img')
    const sharpLib = join(imgRoot, `sharp-darwin-${arch}`, 'lib')
    const vipsLib = join(imgRoot, `sharp-libvips-darwin-${arch}`, 'lib')
    for (const [directory, suffix] of [
      [sharpLib, '.node'],
      [vipsLib, '.dylib']
    ]) {
      const name = existsSync(directory)
        ? readdirSync(directory).find((entry) => entry.endsWith(suffix))
        : undefined
      if (!name) throw new Error(`Missing packaged RapidOCR dependency: ${directory}`)
      nativePaths.push(join(directory, name))
    }
    for (const path of nativePaths) {
      if (!existsSync(path) || !fileArchitecture(path).includes(expectedArchitecture)) {
        throw new Error(`Wrong or missing ${arch} RapidOCR native dependency: ${path}`)
      }
    }
  }

  console.log(
    `  • verified RapidOCR models and native dependencies arch=${architectures.join(', ')}`
  )
}

function verifyUniversalNativeModules(appPath) {
  const unpacked = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
  const expected = [
    [join(unpacked, '@dictol', 'mdict-native', 'dictol-mdict-node.darwin-x64.node'), 'x86_64'],
    [join(unpacked, '@dictol', 'mdict-native', 'dictol-mdict-node.darwin-arm64.node'), 'arm64'],
    [
      join(
        unpacked,
        '@dictol',
        'accessibility-native',
        'prebuilds',
        'darwin-x64',
        'accessibility.node'
      ),
      'x86_64'
    ],
    [
      join(
        unpacked,
        '@dictol',
        'accessibility-native',
        'prebuilds',
        'darwin-arm64',
        'accessibility.node'
      ),
      'arm64'
    ],
    [
      join(
        unpacked,
        '@dictol',
        'screen-capture-native',
        'prebuilds',
        'darwin-x64',
        'screen-capture.node'
      ),
      'x86_64'
    ],
    [
      join(
        unpacked,
        '@dictol',
        'screen-capture-native',
        'prebuilds',
        'darwin-arm64',
        'screen-capture.node'
      ),
      'arm64'
    ],
    [join(unpacked, 'better-sqlite3', 'prebuilds', 'darwin-x64.node'), 'x86_64'],
    [join(unpacked, 'better-sqlite3', 'prebuilds', 'darwin-arm64.node'), 'arm64'],
    [join(unpacked, 'selection-hook', 'prebuilds', 'darwin-x64', 'selection-hook.node'), 'x86_64'],
    [join(unpacked, 'selection-hook', 'prebuilds', 'darwin-arm64', 'selection-hook.node'), 'arm64']
  ]

  for (const [path, architecture] of expected) {
    if (!existsSync(path)) throw new Error(`Missing universal macOS native module: ${path}`)
    const description = fileArchitecture(path)
    if (!description.includes(architecture)) {
      throw new Error(
        `Wrong architecture in universal macOS native module: ${path}\n` +
          `expected=${architecture}, file=${description}`
      )
    }
  }

  const adblock = join(unpacked, 'adblock-rs', 'js', 'index.node')
  if (!existsSync(adblock)) throw new Error(`Missing universal macOS native module: ${adblock}`)
  const adblockDescription = fileArchitecture(adblock)
  if (!adblockDescription.includes('x86_64') || !adblockDescription.includes('arm64')) {
    throw new Error(
      `adblock-rs must contain x86_64 and arm64 slices in a universal build: ${adblockDescription}`
    )
  }

  console.log(`  • verified universal macOS native modules count=${expected.length + 1}`)
}

function verifyWindowsNativeModules(appOutDir, arch) {
  if (arch !== 'x64') throw new Error(`Only Windows x64 is supported, received: ${arch}`)

  const unpacked = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
  const expected = [
    join(unpacked, '@dictol', 'mdict-native', 'dictol-mdict-node.win32-x64-msvc.node'),
    join(
      unpacked,
      '@dictol',
      'accessibility-native',
      'prebuilds',
      'win32-x64',
      'accessibility.node'
    ),
    join(
      unpacked,
      '@dictol',
      'screen-capture-native',
      'prebuilds',
      'win32-x64',
      'screen-capture.node'
    ),
    join(unpacked, 'adblock-rs', 'js', 'index.node'),
    join(unpacked, 'better-sqlite3', 'prebuilds', 'win32-x64.node'),
    join(unpacked, 'selection-hook', 'prebuilds', 'win32-x64', 'selection-hook.node')
  ]

  const nativePackageRoots = [
    join(unpacked, '@dictol', 'mdict-native'),
    join(unpacked, '@dictol', 'accessibility-native'),
    join(unpacked, '@dictol', 'screen-capture-native'),
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
  const macOnlyExports = ['recognizeMacText', 'chineseWordRange']
  const unexpectedExports = macOnlyExports.filter((name) => mdictBinary.includes(Buffer.from(name)))
  if (unexpectedExports.length > 0) {
    throw new Error(
      `Packaged Windows mdict binding contains macOS-only exports: ${unexpectedExports.join(', ')}`
    )
  }
  const screenCaptureAddonExports = [
    'captureScreenRegion',
    'captureWindowsDisplayAtPoint',
    'captureWindowsScreenRegion',
    'getWindowsDisplayBoundsAtPoint',
    'stopWindowsScreenCaptureSessions'
  ]
  const unexpectedCaptureExports = screenCaptureAddonExports.filter((name) =>
    mdictBinary.includes(Buffer.from(name))
  )
  if (unexpectedCaptureExports.length > 0) {
    throw new Error(
      `Packaged Windows mdict binding contains screen capture exports: ${unexpectedCaptureExports.join(', ')}`
    )
  }

  const accessibilityBinary = readFileSync(expected[1])
  if (!accessibilityBinary.includes(Buffer.from('readAccessibleText'))) {
    throw new Error('Packaged Windows Accessibility binding is missing readAccessibleText')
  }

  const screenCaptureBinary = readFileSync(expected[2])
  const screenCaptureExports = [
    'captureWindowsDisplayAtPoint',
    'captureWindowsScreenRegion',
    'getWindowsDisplayBoundsAtPoint',
    'stopWindowsScreenCaptureSessions'
  ]
  const missingCaptureExports = screenCaptureExports.filter(
    (name) => !screenCaptureBinary.includes(Buffer.from(name))
  )
  if (missingCaptureExports.length > 0) {
    throw new Error(
      `Packaged Windows screen capture binding is missing exports: ${missingCaptureExports.join(', ')}`
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

  const universal = context.arch === 4 || context.arch === 'universal'
  if (universal || process.env.DICTOL_MAC_UNIVERSAL === '1') {
    verifySystemTranslationHelper(appPath, ['x86_64', 'arm64'])
    verifyUniversalNativeModules(appPath)
    verifyRapidOcrAssets(appPath, ['x64', 'arm64'])
  } else {
    const arch = targetDarwinArch(context)
    verifySystemTranslationHelper(appPath, [arch === 'x64' ? 'x86_64' : 'arm64'])
    pruneAndVerifyNativeModules(appPath, arch)
    verifyRapidOcrAssets(appPath, [arch])
  }

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
