import { copyFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const targetIndex = process.argv.indexOf('--target')
const target = targetIndex === -1 ? undefined : process.argv[targetIndex + 1]
if (targetIndex !== -1 && !target) throw new Error('Missing target after --target')

function buildProject(project, targetTriple) {
  const args = ['--prefix', join(packageRoot, project), 'run', 'build']
  if (targetTriple) args.push('--', '--target', targetTriple)
  execFileSync(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/c', 'npm', ...args] : args,
    { stdio: 'inherit' }
  )
}

function copyBuild(source, platform, arch) {
  const outputDirectory = join(packageRoot, 'prebuilds', `${platform}-${arch}`)
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, 'screen-capture.node')
  copyFileSync(source, outputPath)
  const binary = readFileSync(outputPath)
  const exports =
    platform === 'darwin'
      ? ['captureScreenRegion', 'hasScreenCapturePermission']
      : [
          'captureWindowsDisplayAtPoint',
          'captureWindowsScreenRegion',
          'getWindowsDisplayBoundsAtPoint',
          'stopWindowsScreenCaptureSessions'
        ]
  const missing = exports.filter((name) => !binary.includes(Buffer.from(name)))
  if (missing.length)
    throw new Error(`Screen capture addon is missing exports: ${missing.join(', ')}`)
  unlinkSync(source)
  console.log(`Built Screen Capture addon: ${outputPath}`)
}

if (target?.endsWith('-apple-darwin')) {
  if (process.platform !== 'darwin') {
    throw new Error('The macOS Screen Capture addon must be built on macOS')
  }
  const arch = target.startsWith('aarch64-') ? 'arm64' : 'x64'
  buildProject('macos', target)
  copyBuild(join(packageRoot, 'macos', `dictol-screen-capture.darwin-${arch}.node`), `darwin`, arch)
} else if (target?.endsWith('-pc-windows-msvc')) {
  if (process.platform !== 'win32') {
    throw new Error('Build the Windows Screen Capture addon on a Windows host')
  }
  buildProject('windows', target)
  copyBuild(
    join(packageRoot, 'windows', 'dictol-screen-capture.win32-x64-msvc.node'),
    'win32',
    'x64'
  )
} else if (target) {
  throw new Error(`Unsupported Screen Capture target: ${target}`)
} else if (process.platform === 'darwin') {
  const arch = process.arch
  const targetTriple = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  buildProject('macos', targetTriple)
  copyBuild(join(packageRoot, 'macos', `dictol-screen-capture.darwin-${arch}.node`), 'darwin', arch)
} else if (process.platform === 'win32') {
  buildProject('windows', 'x86_64-pc-windows-msvc')
  copyBuild(
    join(packageRoot, 'windows', 'dictol-screen-capture.win32-x64-msvc.node'),
    'win32',
    'x64'
  )
} else {
  throw new Error(`Screen Capture native build is unsupported on ${process.platform}`)
}
