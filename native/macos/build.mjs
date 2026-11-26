import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const sourceRoot = join(packageRoot, 'src')
const targetArg = process.argv.indexOf('--target')
const target = targetArg === -1 ? undefined : process.argv[targetArg + 1]
if (targetArg !== -1 && !target) throw new Error('Missing target after --target')

if (target && !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error(`Unsupported macOS panel target: ${target}`)
}

const targetArch = target?.startsWith('aarch64-')
  ? 'arm64'
  : target?.startsWith('x86_64-')
    ? 'x64'
    : process.arch
if (!['arm64', 'x64'].includes(targetArch)) {
  throw new Error(`Unsupported macOS panel architecture: ${targetArch}`)
}
if (process.platform !== 'darwin') {
  throw new Error('The macOS panel addon must be built on macOS')
}

const outputDirectory = join(packageRoot, 'prebuilds', `darwin-${targetArch}`)
mkdirSync(outputDirectory, { recursive: true })
const output = join(outputDirectory, 'macos.node')
const objectDirectory = join(packageRoot, 'target', `macos-${targetArch}`)
mkdirSync(objectDirectory, { recursive: true })
const bridgeObject = join(objectDirectory, 'selection_panel.o')
const addonObject = join(objectDirectory, 'addon.o')
const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
  encoding: 'utf8'
}).trim()
const includeDirectory = resolve(dirname(process.execPath), '../include/node')
const archFlag = targetArch === 'arm64' ? 'arm64' : 'x86_64'
const commonArgs = ['-isysroot', sdk, '-arch', archFlag, '-O2', '-Wall']
const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? '13.0'
commonArgs.push(`-mmacosx-version-min=${deploymentTarget}`)

execFileSync(
  'clang',
  [
    '-x',
    'objective-c',
    '-c',
    join(sourceRoot, 'selection_panel.m'),
    '-o',
    bridgeObject,
    ...commonArgs,
    '-fobjc-arc',
    '-fblocks'
  ],
  { stdio: 'inherit' }
)
execFileSync(
  'clang++',
  [
    '-std=c++17',
    '-x',
    'objective-c++',
    '-c',
    join(sourceRoot, 'addon.mm'),
    '-o',
    addonObject,
    ...commonArgs,
    '-fobjc-arc',
    '-fblocks',
    `-I${includeDirectory}`,
    '-DNODE_GYP_MODULE_NAME=macos'
  ],
  { stdio: 'inherit' }
)
execFileSync(
  'clang++',
  [
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-isysroot',
    sdk,
    '-arch',
    archFlag,
    `-mmacosx-version-min=${deploymentTarget}`,
    bridgeObject,
    addonObject,
    '-framework',
    'AppKit',
    '-o',
    output
  ],
  { stdio: 'inherit' }
)

console.log(`Built macOS panel addon: ${output}`)
