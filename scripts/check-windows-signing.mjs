import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const certificateFile = process.env.WIN_CSC_FILE ?? join(root, 'build', 'codesign.pfx')

if (!process.env.WIN_CSC_PASSWORD) {
  throw new Error(
    'WIN_CSC_PASSWORD must be set before building Windows. The installer and native modules must use the same signing secret.'
  )
}

if (!existsSync(certificateFile)) {
  throw new Error(`Windows signing certificate does not exist: ${certificateFile}`)
}

console.log(`Verified Windows signing configuration: ${certificateFile}`)
