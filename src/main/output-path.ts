import { is } from '@electron-toolkit/utils'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function resolvePreloadPath(fileName: string): string {
  return resolveOutputFile('preload', fileName)
}

export function resolveRendererPath(fileName: string): string {
  return resolveOutputFile('renderer', fileName)
}

export function resolveRendererUrl(fileName: string): string {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && rendererUrl) {
    return `${rendererUrl}/${fileName}`
  } else {
    return pathToFileURL(resolveRendererPath(fileName)).href
  }
}

function resolveOutputFile(directory: 'preload' | 'renderer', fileName: string): string {
  const candidates = [
    join(__dirname, '..', directory, fileName),
    join(__dirname, '..', '..', directory, fileName)
  ]
  return candidates.find(existsSync) ?? candidates[0]
}
