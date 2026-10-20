import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'

const WINDOWS_X64_TARGET = 'x86_64-pc-windows-msvc'

const getTarget = () => {
  const targetArgumentIndex = process.argv.indexOf('--target')
  if (targetArgumentIndex !== -1) {
    const target = process.argv[targetArgumentIndex + 1]
    if (!target) throw new Error('Missing value after --target')
    return target
  }

  return process.env.DICTOL_NATIVE_TARGET
}

const verifyWindowsX64Binding = (directory) => {
  const binaryPath = join(directory, 'dictol-mdict-node.win32-x64-msvc.node')
  const binary = readFileSync(binaryPath)
  const requiredExports = ['Mdx', 'Mdd', 'MddList', 'hashFile', 'recognizeWindowsText']
  const missingExports = requiredExports.filter((name) => !binary.includes(Buffer.from(name)))

  if (missingExports.length > 0) {
    throw new Error(
      `Windows x64 native binding is stale or incompatible: missing ${missingExports.join(', ')}`
    )
  }

  const macOnlyExports = ['recognizeMacText', 'chineseWordRange']
  const unexpectedExports = macOnlyExports.filter((name) => binary.includes(Buffer.from(name)))
  if (unexpectedExports.length > 0) {
    throw new Error(
      `Windows x64 native binding contains macOS-only exports: ${unexpectedExports.join(', ')}`
    )
  }
  const screenCaptureExports = [
    'captureScreenRegion',
    'captureWindowsDisplayAtPoint',
    'captureWindowsScreenRegion',
    'getWindowsDisplayBoundsAtPoint',
    'stopWindowsScreenCaptureSessions'
  ]
  const unexpectedCaptureExports = screenCaptureExports.filter((name) =>
    binary.includes(Buffer.from(name))
  )
  if (unexpectedCaptureExports.length > 0) {
    throw new Error(
      `Windows mdict binding contains screen capture exports: ${unexpectedCaptureExports.join(', ')}`
    )
  }
  const generatedJs = readFileSync(join(directory, 'index.js'), 'utf8')
  const unexpectedJsExports = macOnlyExports.filter((name) =>
    generatedJs.includes(`module.exports.${name} =`)
  )
  if (unexpectedJsExports.length > 0) {
    throw new Error(
      `Windows x64 JS binding contains macOS-only exports: ${unexpectedJsExports.join(', ')}`
    )
  }

  const size = statSync(binaryPath).size
  console.log(`Verified Windows x64 native binding exports (${size} bytes)`)
}

const prepareWindowsCrossCompileEnvironment = () => {
  const sysroot = execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim()
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length)

  if (!host) throw new Error('Unable to determine the Rust host target')

  const llvmArPath = join(sysroot, 'lib', 'rustlib', host, 'bin', 'llvm-ar')
  if (!existsSync(llvmArPath)) {
    throw new Error(
      'Missing Rust LLVM tools. Install them with: rustup component add llvm-tools-preview'
    )
  }
  const toolDirectory = mkdtempSync(join(tmpdir(), 'dictol-llvm-tools-'))
  symlinkSync(llvmArPath, join(toolDirectory, 'llvm-lib'))

  return {
    env: {
      ...process.env,
      PATH: `${toolDirectory}${delimiter}${process.env.PATH ?? ''}`
    },
    cleanup: () => rmSync(toolDirectory, { recursive: true, force: true })
  }
}

const run = (directory, { includeAllPlatformTypes = false } = {}) => {
  const target = getTarget()
  const args = ['--prefix', directory, 'run', 'build']
  const shouldCrossCompileWindows =
    Boolean(target?.endsWith('-pc-windows-msvc')) && process.platform !== 'win32'
  if (target) {
    args.push('--', '--target', target)
    if (shouldCrossCompileWindows) args.push('--cross-compile')
  }
  // Keep the shared declaration file complete for typechecking both platform
  // implementations when building Windows from a macOS checkout.
  if (
    includeAllPlatformTypes &&
    !(target?.includes('apple-darwin') ?? process.platform === 'darwin')
  ) {
    if (!target) args.push('--')
    args.push('--dts', 'target/non-macos-index.d.ts')
  }

  const crossCompileEnvironment = shouldCrossCompileWindows
    ? prepareWindowsCrossCompileEnvironment()
    : undefined

  try {
    if (process.platform === 'win32') {
      execFileSync('cmd.exe', ['/c', 'npm', ...args], {
        stdio: 'inherit',
        env: crossCompileEnvironment?.env
      })
    } else {
      execFileSync('npm', args, {
        stdio: 'inherit',
        env: crossCompileEnvironment?.env
      })
    }
  } finally {
    crossCompileEnvironment?.cleanup()
  }

  if (directory.endsWith('mdict-node') && target === WINDOWS_X64_TARGET) {
    verifyWindowsX64Binding(directory)
  }
}

run('native/mdict-node', { includeAllPlatformTypes: true })
const target = getTarget()
if (target?.endsWith('-apple-darwin') || target?.endsWith('-pc-windows-msvc')) {
  const shouldCrossCompileWindows =
    target.endsWith('-pc-windows-msvc') && process.platform !== 'win32'
  const crossCompileEnvironment = shouldCrossCompileWindows
    ? prepareWindowsCrossCompileEnvironment()
    : undefined
  try {
    execFileSync(process.execPath, ['native/accessibility/build.mjs', '--target', target], {
      stdio: 'inherit',
      env: crossCompileEnvironment?.env
    })
  } finally {
    crossCompileEnvironment?.cleanup()
  }
} else if (!target && ['darwin', 'win32'].includes(process.platform)) {
  execFileSync(process.execPath, ['native/accessibility/build.mjs'], { stdio: 'inherit' })
}

const shouldBuildScreenCapture = target
  ? (target.endsWith('-apple-darwin') && process.platform === 'darwin') ||
    (target.endsWith('-pc-windows-msvc') && process.platform === 'win32')
  : ['darwin', 'win32'].includes(process.platform)
if (shouldBuildScreenCapture) {
  execFileSync(
    process.execPath,
    ['native/screen-capture/build.mjs', ...(target ? ['--target', target] : [])],
    {
      stdio: 'inherit'
    }
  )
}
