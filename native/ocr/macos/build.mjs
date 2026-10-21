import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(packageRoot, 'macos', 'src')
const targetIndex = process.argv.indexOf('--target')
const target = targetIndex === -1 ? undefined : process.argv[targetIndex + 1]
if (targetIndex !== -1 && !target) throw new Error('Missing target after --target')
if (process.platform !== 'darwin') throw new Error('Build the macOS OCR addon on macOS')
if (target && !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error(`Unsupported macOS OCR target: ${target}`)
}

const arch = target ? (target.startsWith('aarch64-') ? 'arm64' : 'x64') : process.arch
const archFlag = arch === 'arm64' ? 'arm64' : 'x86_64'
const outputDirectory = join(packageRoot, 'prebuilds', `darwin-${arch}`)
const objectDirectory = join(packageRoot, 'macos', 'target', arch)
mkdirSync(outputDirectory, { recursive: true })
mkdirSync(objectDirectory, { recursive: true })

const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
  encoding: 'utf8'
}).trim()
const includeDirectory = resolve(dirname(process.execPath), '../include/node')
const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? '14.0'
const commonArgs = [
  '-isysroot',
  sdk,
  '-arch',
  archFlag,
  `-mmacosx-version-min=${deploymentTarget}`,
  '-O2',
  '-Wall',
  '-fobjc-arc',
  '-fblocks'
]
const objects = [
  join(objectDirectory, 'ocr.o'),
  join(objectDirectory, 'word_tokenizer.o'),
  join(objectDirectory, 'addon.o')
]
for (const [source, object] of [
  ['ocr.m', objects[0]],
  ['word_tokenizer.m', objects[1]]
]) {
  execFileSync(
    'clang',
    ['-x', 'objective-c', '-c', join(sourceRoot, source), '-o', object, ...commonArgs],
    {
      stdio: 'inherit'
    }
  )
}
execFileSync(
  'clang++',
  [
    '-std=c++17',
    '-x',
    'objective-c++',
    '-c',
    join(sourceRoot, 'addon.mm'),
    '-o',
    objects[2],
    ...commonArgs,
    `-I${includeDirectory}`,
    '-DNODE_GYP_MODULE_NAME=ocr'
  ],
  { stdio: 'inherit' }
)

const output = join(outputDirectory, 'ocr.node')
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
    ...objects,
    '-framework',
    'Foundation',
    '-framework',
    'ImageIO',
    '-framework',
    'Vision',
    '-framework',
    'NaturalLanguage',
    '-o',
    output
  ],
  { stdio: 'inherit' }
)
console.log(`Built macOS OCR addon: ${output}`)
