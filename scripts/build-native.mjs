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
  const requiredExports = ['Mdx', 'Mdd', 'MddList', 'hashFile']
  const missingExports = requiredExports.filter((name) => !binary.includes(Buffer.from(name)))

  if (missingExports.length > 0) {
    throw new Error(
      `Windows x64 native binding is stale or incompatible: missing ${missingExports.join(', ')}`
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

const run = (directory) => {
  const target = getTarget()
  const args = ['--prefix', directory, 'run', 'build']
  const shouldCrossCompileWindows =
    Boolean(target?.endsWith('-pc-windows-msvc')) && process.platform !== 'win32'
  if (target) {
    args.push('--', '--target', target)
    if (shouldCrossCompileWindows) args.push('--cross-compile')
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

  if (target === WINDOWS_X64_TARGET) {
    verifyWindowsX64Binding(directory)
  }
}

run('native/mdict-node')
