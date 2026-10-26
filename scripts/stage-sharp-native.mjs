import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export default function stageSharpNative(context) {
  const platform = context.electronPlatformName
  if (platform !== 'darwin' && platform !== 'win32') return
  const arch =
    context.arch === 1 || context.arch === 'x64'
      ? 'x64'
      : context.arch === 3 || context.arch === 'arm64'
        ? 'arm64'
        : String(context.arch)
  const target = `${platform}-${arch}`
  if (!['darwin-x64', 'darwin-arm64', 'win32-x64'].includes(target)) {
    throw new Error(`Unsupported sharp package target: ${target}`)
  }

  const sharpPackage = JSON.parse(readFileSync(join(root, 'node_modules', 'sharp', 'package.json')))
  for (const name of [`@img/sharp-${target}`, `@img/sharp-libvips-${target}`]) {
    const version = sharpPackage.optionalDependencies[name]
    if (!version) {
      if (name === `@img/sharp-${target}`) throw new Error(`sharp does not provide ${name}`)
      continue
    }

    const packagePath = join(root, 'node_modules', name)
    const manifestPath = join(packagePath, 'package.json')
    if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath)).version === version)
      continue

    const stagingPath = mkdtempSync(join(tmpdir(), 'dictol-sharp-'))
    try {
      const tarball = execFileSync(
        npm,
        ['pack', `${name}@${version}`, '--pack-destination', stagingPath, '--silent'],
        { cwd: root, encoding: 'utf8' }
      ).trim()
      rmSync(packagePath, { recursive: true, force: true })
      mkdirSync(packagePath, { recursive: true })
      execFileSync('tar', [
        '-xzf',
        join(stagingPath, tarball),
        '-C',
        packagePath,
        '--strip-components=1'
      ])
    } finally {
      rmSync(stagingPath, { recursive: true, force: true })
    }

    if (JSON.parse(readFileSync(manifestPath)).version !== version) {
      throw new Error(`Failed to stage ${name}@${version}`)
    }
    console.log(`Staged ${name}@${version} for ${target}`)
  }
}
