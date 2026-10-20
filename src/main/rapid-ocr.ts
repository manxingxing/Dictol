import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { app, nativeImage } from 'electron'
import type { TextBox } from 'rapidocr-node'
import type { OcrObservation } from './ocr-text'

type OcrResult = { observations: OcrObservation[] }
type UncertainLine = { index: number; box: TextBox; text: string; confidence: number }
type WorkerResult = {
  observations: OcrObservation[]
  uncertainLines: UncertainLine[]
  candidate?: { text: string; confidence: number }
}
type WorkerResponse = { id: number; result?: WorkerResult; error?: string }

let worker: Worker | undefined
let nextRequestId = 0
const pending = new Map<
  number,
  { resolve: (result: WorkerResult) => void; reject: (error: Error) => void }
>()

export async function recognizeRapidText(
  png: Buffer,
  options: { retryLowConfidenceLines?: boolean } = {}
): Promise<OcrResult> {
  const result = await recognizeInWorker(png, options.retryLowConfidenceLines === true)
  const observations = result.observations
  if (!options.retryLowConfidenceLines || !result.uncertainLines.length) return { observations }

  const image = nativeImage.createFromBuffer(png)
  const { width, height } = image.getSize()
  let recovered = 0
  for (const line of result.uncertainLines) {
    const left = Math.max(0, Math.floor(Math.min(...line.box.map((point) => point.x))) - 2)
    const right = Math.min(width, Math.ceil(Math.max(...line.box.map((point) => point.x))) + 2)
    const top = Math.max(0, Math.floor(Math.min(...line.box.map((point) => point.y))) - 3)
    const bottom = Math.min(height, Math.ceil(Math.max(...line.box.map((point) => point.y))) + 3)
    if (right <= left || bottom <= top) continue

    const crop = image.crop({ x: left, y: top, width: right - left, height: bottom - top })
    const retry = await recognizeInWorker(crop.toPNG(), false, true)
    const candidate = retry.candidate
    if (
      !candidate ||
      candidate.confidence < Math.max(0.85, line.confidence + 0.1) ||
      candidate.text.trim().length < Math.max(2, line.text.trim().length * 0.8)
    )
      continue
    observations[line.index] = {
      ...observations[line.index],
      text: candidate.text.trim(),
      confidence: candidate.confidence,
      characters: undefined
    }
    recovered++
  }
  console.info('[RapidOCR] retried low-confidence lines', {
    attempted: result.uncertainLines.length,
    recovered
  })
  return { observations }
}

function recognizeInWorker(
  png: Buffer,
  includeLowConfidenceLines: boolean,
  recognitionOnly = false
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const id = ++nextRequestId
    pending.set(id, { resolve, reject })
    try {
      getWorker().postMessage({ id, png, includeLowConfidenceLines, recognitionOnly })
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
}

function getWorker(): Worker {
  if (worker) return worker
  const modelDirectory = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'rapidocr')
    : join(app.getAppPath(), 'resources', 'rapidocr')
  const current = new Worker(join(__dirname, 'rapid-ocr-worker.js'), {
    workerData: {
      modelDirectory,
      // Keep a CPU available for the Electron UI while OCR is running.
      intraOpNumThreads: Math.max(1, Math.min(2, availableParallelism() - 1))
    }
  })
  current.on('message', ({ id, result, error }: WorkerResponse) => {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (error) request.reject(new Error(error))
    else if (result) request.resolve(result)
    else request.reject(new Error('RapidOCR Worker 未返回识别结果'))
  })
  const fail = (error: Error): void => {
    if (worker !== current) return
    worker = undefined
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  current.once('error', fail)
  current.once('exit', (code) => fail(new Error(`RapidOCR Worker 异常退出（${code}）`)))
  current.unref()
  worker = current
  return current
}
