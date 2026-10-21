import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const targetIndex = process.argv.indexOf('--target')
const target = targetIndex === -1 ? undefined : process.argv[targetIndex + 1]
if (targetIndex !== -1 && !target) throw new Error('Missing target after --target')

function buildMac(targetTriple) {
  execFileSync(
    process.execPath,
    [join(packageRoot, 'macos', 'build.mjs'), '--target', targetTriple],
    {
      stdio: 'inherit'
    }
  )
}

function buildWindows(targetTriple) {
  if (process.platform !== 'win32') throw new Error('Build the Windows OCR addon on Windows')
  if (targetTriple !== 'x86_64-pc-windows-msvc') {
    throw new Error(`Unsupported Windows OCR target: ${targetTriple}`)
  }
  execFileSync(
    'cmd.exe',
    [
      '/c',
      'npm',
      '--prefix',
      join(packageRoot, 'windows'),
      'run',
      'build',
      '--',
      '--target',
      targetTriple
    ],
    {
      stdio: 'inherit'
    }
  )
  const source = join(packageRoot, 'windows', 'dictol-ocr.win32-x64-msvc.node')
  const outputDirectory = join(packageRoot, 'prebuilds', 'win32-x64')
  mkdirSync(outputDirectory, { recursive: true })
  const output = join(outputDirectory, 'ocr.node')
  copyFileSync(source, output)
  if (!readFileSync(output).includes(Buffer.from('recognizeWindowsText'))) {
    throw new Error(`Windows OCR addon is missing recognizeWindowsText: ${output}`)
  }
  unlinkSync(source)
  console.log(`Built Windows OCR addon: ${output}`)
}

if (target?.endsWith('-apple-darwin')) {
  if (process.platform !== 'darwin') throw new Error('Build the macOS OCR addon on macOS')
  buildMac(target)
} else if (target?.endsWith('-pc-windows-msvc')) {
  buildWindows(target)
} else if (target) {
  throw new Error(`Unsupported OCR target: ${target}`)
} else if (process.platform === 'darwin') {
  buildMac(process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
} else if (process.platform === 'win32') {
  buildWindows('x86_64-pc-windows-msvc')
} else {
  throw new Error(`OCR native build is unsupported on ${process.platform}`)
}
