import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const requestedTarget = process.argv.indexOf('--target')
const target = requestedTarget === -1 ? undefined : process.argv[requestedTarget + 1]
if (requestedTarget !== -1 && !target) throw new Error('Missing target after --target')

const buildMac = (arch) => {
  execFileSync(
    process.execPath,
    [
      join(packageRoot, 'macos', 'build.mjs'),
      '--target',
      arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    ],
    { stdio: 'inherit' }
  )
}

const buildWindows = (targetTriple) => {
  if (targetTriple !== 'x86_64-pc-windows-msvc') {
    throw new Error(`Unsupported Windows Accessibility target: ${targetTriple}`)
  }
  const crossCompile = process.platform !== 'win32'
  const npmArgs = [
    '--prefix',
    join(packageRoot, 'windows'),
    'run',
    'build',
    '--',
    '--target',
    targetTriple
  ]
  if (crossCompile) npmArgs.push('--cross-compile')
  if (crossCompile) {
    execFileSync('npm', npmArgs, { stdio: 'inherit' })
  } else {
    execFileSync('cmd.exe', ['/c', 'npm', ...npmArgs], { stdio: 'inherit' })
  }

  const libraryPath = join(packageRoot, 'windows', 'dictol-accessibility.win32-x64-msvc.node')
  const outputDirectory = join(packageRoot, 'prebuilds', 'win32-x64')
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, 'accessibility.node')
  copyFileSync(libraryPath, outputPath)
  if (!readFileSync(outputPath).includes(Buffer.from('readAccessibleText'))) {
    throw new Error(`Windows Accessibility addon is missing readAccessibleText: ${outputPath}`)
  }
  console.log(`Built Windows Accessibility addon: ${resolve(outputPath)}`)
}

if (target?.endsWith('-apple-darwin')) {
  buildMac(target.startsWith('aarch64-') ? 'arm64' : 'x64')
} else if (target?.endsWith('-pc-windows-msvc')) {
  buildWindows(target)
} else if (target) {
  throw new Error(`Unsupported Accessibility target: ${target}`)
} else if (process.platform === 'darwin') {
  buildMac(process.arch)
} else if (process.platform === 'win32') {
  buildWindows('x86_64-pc-windows-msvc')
} else {
  throw new Error(`Accessibility native build is unsupported on ${process.platform}`)
}
