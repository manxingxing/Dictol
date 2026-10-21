import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const signer = process.env.OSSLSIGNCODE ?? 'osslsigncode'
const certificateFile = process.env.WIN_CSC_FILE ?? join(root, 'build', 'codesign.pfx')
const certificatePassword = process.env.WIN_CSC_PASSWORD

if (!certificatePassword) {
  throw new Error('WIN_CSC_PASSWORD must be set when signing Windows native modules')
}

const files = [
  join(root, 'native', 'mdict-node', 'dictol-mdict-node.win32-x64-msvc.node'),
  join(root, 'native', 'ocr', 'prebuilds', 'win32-x64', 'ocr.node'),
  join(root, 'node_modules', 'adblock-rs', 'js', 'index.node'),
  join(root, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node'),
  join(root, 'node_modules', 'selection-hook', 'prebuilds', 'win32-x64', 'selection-hook.node')
]

const missing = files.filter((file) => !existsSync(file))
if (missing.length > 0) {
  throw new Error(`Cannot sign missing Windows native modules:\n${missing.join('\n')}`)
}

for (const input of files) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dictol-sign-'))
  const output = join(temporaryDirectory, 'signed.node')
  try {
    execFileSync(
      signer,
      [
        'sign',
        // The Homebrew OpenSSL 3 signer handles this PFX more reliably with
        // legacy-provider auto-loading disabled.
        '-nolegacy',
        '-pkcs12',
        certificateFile,
        '-pass',
        certificatePassword,
        '-h',
        'sha256',
        '-in',
        input,
        '-out',
        output
      ],
      { stdio: 'inherit' }
    )
    renameSync(output, input)
    console.log(`Signed Windows native module: ${input}`)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}
