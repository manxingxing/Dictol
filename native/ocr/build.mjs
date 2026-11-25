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
  const outputPath = join(outputDirectory, 'ocr.node')
  copyFileSync(source, outputPath)
  const binary = readFileSync(outputPath)
  const exports =
    platform === 'darwin'
      ? [
          'captureScreenRegion',
          'captureDisplay',
          'captureWindow',
          'listShareableDisplays',
          'listShareableWindows',
          'hasScreenCapturePermission',
          'recognizeMacPng',
          'captureAndRecognizeMacText',
          'captureMacOcrImage',
          'chineseWordRange'
        ]
      : [
          'captureScreenRegion',
          'captureDisplay',
          'captureWindow',
          'listShareableDisplays',
          'listShareableWindows',
          'getWindowsDisplayBoundsAtPoint',
          'recognizeWindowsText',
          'captureAndRecognizeWindowsText',
          'captureWindowsOcrImage'
        ]
  const missing = exports.filter((name) => !binary.includes(Buffer.from(name)))
  if (missing.length)
    throw new Error(`Screen capture addon is missing exports: ${missing.join(', ')}`)
  if (platform === 'darwin') execFileSync('codesign', ['--force', '--sign', '-', outputPath])
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
  if (target !== 'x86_64-pc-windows-msvc') throw new Error(`Unsupported target: ${target}`)
  if (process.platform === 'win32') {
    buildProject('windows', target)
    copyBuild(
      join(packageRoot, 'windows', 'dictol-screen-capture.win32-x64-msvc.node'),
      'win32',
      'x64'
    )
  } else {
    execFileSync('cargo', ['xwin', 'build', '--release', '--target', target], {
      cwd: join(packageRoot, 'windows'),
      stdio: 'inherit'
    })
    const source = join(
      packageRoot,
      'windows',
      'target',
      target,
      'release',
      'dictol_screen_capture_native.dll'
    )
    const temporary = join(packageRoot, 'windows', 'dictol-screen-capture.win32-x64-msvc.node')
    copyFileSync(source, temporary)
    copyBuild(temporary, 'win32', 'x64')
  }
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
