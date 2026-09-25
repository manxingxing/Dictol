import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const signer = process.env.OSSLSIGNCODE ?? 'osslsigncode'
const certificateFile = process.env.WIN_CSC_FILE ?? join(root, 'build', 'codesign.pfx')
const certificatePassword = process.env.WIN_CSC_PASSWORD

if (!certificatePassword)
  throw new Error('WIN_CSC_PASSWORD must be set before signing Windows artifacts')
if (!existsSync(certificateFile))
  throw new Error(`Windows signing certificate does not exist: ${certificateFile}`)

const files = []
const visit = (directory) => {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      visit(path)
    } else if (['.exe', '.dll'].includes(extname(path).toLowerCase())) {
      files.push(path)
    }
  }
}

visit(join(root, 'dist', 'win-unpacked'))
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const installer = join(root, 'dist', `dictol-${version}-x64-setup.exe`)
if (existsSync(installer)) files.push(installer)
if (files.length === 0) throw new Error('No Windows PE artifacts found to sign')

for (const input of files) signFile(input)

function signFile(input) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dictol-sign-artifact-'))
  const output = join(temporaryDirectory, basename(input))
  try {
    execFileSync(
      signer,
      [
        'sign',
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
    console.log(`Signed Windows artifact: ${input}`)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}
