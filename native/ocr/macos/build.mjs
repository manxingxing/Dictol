import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(packageRoot, 'macos', 'src')
const targetArg = process.argv.indexOf('--target')
const target = targetArg === -1 ? undefined : process.argv[targetArg + 1]
if (targetArg !== -1 && !target) throw new Error('Missing target after --target')

if (target && !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) {
  throw new Error(`Unsupported target: ${target}`)
}

const targetArch = target?.startsWith('aarch64-')
  ? 'arm64'
  : target?.startsWith('x86_64-')
    ? 'x64'
    : process.arch
if (!['arm64', 'x64'].includes(targetArch)) {
  throw new Error(`Unsupported macOS Screen Capture architecture: ${targetArch}`)
}
if (process.platform !== 'darwin') {
  throw new Error('The macOS Screen Capture addon must be built on macOS')
}

const output = join(packageRoot, 'macos', `dictol-screen-capture.darwin-${targetArch}.node`)
const objectDirectory = join(packageRoot, 'target', `macos-${targetArch}`)
mkdirSync(objectDirectory, { recursive: true })
const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
  encoding: 'utf8'
}).trim()
const includeDirectory = resolve(dirname(process.execPath), '../include/node')
const archFlag = targetArch === 'arm64' ? 'arm64' : 'x86_64'
const commonArgs = ['-isysroot', sdk, '-arch', archFlag, '-O2', '-Wall']
// 部署目标决定最低运行版本；编译 SDK 仍需包含 15.2 的接口声明。
const deploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? '13.0'
if (!/^\d+(\.\d+){0,2}$/.test(deploymentTarget) || Number(deploymentTarget.split('.')[0]) < 13) {
  throw new Error('macOS Screen Capture requires a deployment target of 13.0 or later')
}
commonArgs.push(`-mmacosx-version-min=${deploymentTarget}`)

// .m 编译为 Objective-C，绑定层 .mm 编译为 Objective-C++；两者都开启 ARC。
const objects = []
for (const source of ['capture.m', 'ocr.m', 'word_tokenizer.m', 'addon.mm']) {
  const objcxx = source.endsWith('.mm')
  const object = join(objectDirectory, `${source}.o`)
  objects.push(object)
  execFileSync(
    objcxx ? 'clang++' : 'clang',
    [
      ...(objcxx ? ['-std=c++17'] : []),
      '-c',
      join(sourceRoot, source),
      '-o',
      object,
      ...commonArgs,
      '-Werror=unguarded-availability',
      // 原生函数仅在模块内部链接，公共入口由 Node-API 显式导出。
      '-fvisibility=hidden',
      '-fobjc-arc',
      '-fblocks',
      `-I${includeDirectory}`,
      '-DNODE_GYP_MODULE_NAME=screen_capture'
    ],
    { stdio: 'inherit' }
  )
}
execFileSync(
  'clang++',
  [
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    ...commonArgs,
    ...objects,
    ...[
      'Foundation',
      'CoreGraphics',
      'ScreenCaptureKit',
      'CoreMedia',
      'CoreVideo',
      'CoreImage',
      'ImageIO',
      'Vision',
      'NaturalLanguage'
    ].flatMap((name) => ['-framework', name]),
    '-o',
    output
  ],
  { stdio: 'inherit' }
)
// Node-API 符号由宿主动态提供，但项目内部符号必须已链接，避免加载后调用空地址。
const undefinedSymbols = execFileSync('nm', ['-m', '-u', output], { encoding: 'utf8' })
const unresolved = undefinedSymbols
  .split('\n')
  .filter(
    (line) =>
      line.includes('(dynamically looked up)') &&
      !/\b_(?:napi|node_api)_\w+\s+\(dynamically looked up\)$/.test(line.trim())
  )
if (unresolved.length) {
  throw new Error(
    `macOS Screen Capture addon has unresolved internal symbols:\n${unresolved.join('\n')}`
  )
}
console.log(`Built macOS Screen Capture addon: ${output}`)
