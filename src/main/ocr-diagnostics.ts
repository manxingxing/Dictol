import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MacOcrResult } from '@dictol/mdict-native'
import { app, type Point } from 'electron'
import type { CapturedImage } from './ocr-screen-capture'
import type { OcrTextHit } from './ocr-text'

/** Explicit opt-in: screenshots and recognized text can contain private screen content. */
export async function recordMacOcrDiagnostic(
  mode: 'dictionary' | 'ai',
  pass: 'initial' | 'japanese-fallback' | 'expanded',
  captured: CapturedImage,
  pointer: Point,
  result: MacOcrResult,
  hit: OcrTextHit | null
): Promise<void> {
  if (process.env.DICTOL_OCR_DIAGNOSTICS !== '1') return
  try {
    const directory = join(app.getPath('userData'), 'ocr-diagnostics')
    await mkdir(directory, { recursive: true })
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}-${pass}-${randomUUID().slice(0, 8)}`
    const imagePath = join(directory, `${name}.png`)
    const jsonPath = join(directory, `${name}.json`)
    const svgPath = join(directory, `${name}.svg`)
    const { width, height } = captured.size
    const lineRects = result.observations
      .map((line) =>
        rect(line.x, 1 - line.y - line.height, line.width, line.height, width, height, '#0ea5e9')
      )
      .join('\n')
    const seen = new Set<string>()
    const wordRects = result.observations
      .flatMap((line) =>
        line.characters.flatMap((box) => {
          const key = [box.x, box.y, box.width, box.height]
            .map((value) => value.toFixed(4))
            .join(',')
          if (seen.has(key)) return []
          seen.add(key)
          return [
            rect(box.x, 1 - box.y - box.height, box.width, box.height, width, height, '#8b5cf6')
          ]
        })
      )
      .join('\n')
    const selected = hit
      ? rect(
          hit.bounds.x,
          hit.bounds.y,
          hit.bounds.width,
          hit.bounds.height,
          width,
          height,
          '#eab308',
          true
        )
      : ''
    const pointerX = captured.pointer.x * width
    const pointerY = captured.pointer.y * height
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<image href="${name}.png" width="${width}" height="${height}"/>
${lineRects}
${wordRects}
${selected}
<circle cx="${pointerX}" cy="${pointerY}" r="7" fill="none" stroke="#ef4444" stroke-width="2"/>
<path d="M ${pointerX - 14} ${pointerY} h 28 M ${pointerX} ${pointerY - 14} v 28" stroke="#ef4444" stroke-width="2"/>
</svg>`
    await Promise.all([
      writeFile(imagePath, captured.buffer),
      writeFile(svgPath, svg),
      writeFile(
        jsonPath,
        JSON.stringify(
          {
            mode,
            pass,
            backend: captured.backend,
            regionDip: captured.region,
            imagePixels: captured.size,
            pointerScreen: pointer,
            pointerInImage: captured.pointer,
            selected: hit,
            observations: result.observations
          },
          null,
          2
        )
      )
    ])
    console.info('[OCR] diagnostic saved', { svgPath, jsonPath })
  } catch (error) {
    console.warn('[OCR] Could not save diagnostic', error)
  }
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
  stroke: string,
  selected = false
): string {
  return `<rect x="${x * imageWidth}" y="${y * imageHeight}" width="${width * imageWidth}" height="${height * imageHeight}" fill="${selected ? '#eab308' : 'none'}" fill-opacity="0.2" stroke="${stroke}" stroke-width="${selected ? 2 : 1}"/>`
}
