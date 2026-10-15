import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import type { TranslationRequest } from '../../shared/translation'

type SystemTranslationResult = {
  text?: string
  detectedSourceLanguage?: string
  error?: string
}

function helperPath(): string {
  const resources = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
  return join(resources, 'system-translation', 'dictol-system-translation')
}

export function isSystemTranslationAvailable(): boolean {
  return (
    process.platform === 'darwin' &&
    Number.parseInt(release(), 10) >= 24 &&
    existsSync(helperPath())
  )
}

export async function translateWithSystem(
  request: TranslationRequest,
  signal: AbortSignal
): Promise<{ text: string; detectedSourceLanguage?: string }> {
  if (!isSystemTranslationAvailable()) {
    throw new Error('系统翻译需要 macOS 15 或更高版本。')
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'pipe'], signal })
    let output = ''
    let diagnostic = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      diagnostic += chunk
    })
    child.stdin.on('error', reject)
    child.on('error', reject)
    child.on('close', (code) => {
      if (signal.aborted) return
      try {
        const result = JSON.parse(output) as SystemTranslationResult
        if (result.error) throw new Error(result.error)
        if (!result.text?.trim()) throw new Error('系统翻译没有返回译文。')
        resolve({ text: result.text, detectedSourceLanguage: result.detectedSourceLanguage })
      } catch (error) {
        reject(
          error instanceof SyntaxError
            ? new Error(`系统翻译进程异常退出（${code ?? '未知'}）：${diagnostic.slice(0, 300)}`)
            : error
        )
      }
    })
    child.stdin.end(
      JSON.stringify({
        text: request.text,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage
      })
    )
  })
}
