import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import type { RapidOCR } from 'rapidocr-node'
import { toRapidOcrObservations } from './rapid-ocr-observations'

type Request = {
  id: number
  png: Uint8Array
  includeLowConfidenceLines: boolean
  recognitionOnly: boolean
}

const { modelDirectory, intraOpNumThreads } = workerData as {
  modelDirectory: string
  intraOpNumThreads: number
}
let enginePromise: Promise<RapidOCR> | undefined
let queue = Promise.resolve()

parentPort?.on('message', (request: Request) => {
  queue = queue.then(async () => {
    try {
      const engine = await getEngine()
      const result = await engine.recognize(
        Buffer.from(request.png),
        request.recognitionOnly ? { useDetection: false, useClassifier: false } : {}
      )
      const observations = result.type === 'ocr' ? toRapidOcrObservations(result) : []
      const uncertainLines =
        request.includeLowConfidenceLines && result.type === 'ocr'
          ? result.lines.flatMap((line, index) =>
              line.confidence < 0.8
                ? [{ index, box: line.box, text: line.text, confidence: line.confidence }]
                : []
            )
          : []
      const candidate = result.type === 'recognition' ? result.results[0] : undefined
      parentPort?.postMessage({
        id: request.id,
        result: {
          observations,
          uncertainLines,
          candidate: candidate && { text: candidate.text, confidence: candidate.confidence }
        }
      })
    } catch (error) {
      parentPort?.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
})

function getEngine(): Promise<RapidOCR> {
  if (!enginePromise) {
    enginePromise = import('rapidocr-node').then(({ RapidOCR }) =>
      RapidOCR.create({
        modelDirectory,
        autoDownloadModels: false,
        logLevel: 'warning',
        detectionModelPath: join(modelDirectory, 'PP-OCRv6_det_small.onnx'),
        classifierModelPath: join(modelDirectory, 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'),
        recognitionModelPath: join(modelDirectory, 'PP-OCRv6_rec_small.onnx'),
        dictionaryPath: join(modelDirectory, 'multi_PP-OCRv6_rec_small-dictionary.txt'),
        limitType: 'max',
        limitSideLength: 1024,
        returnWordBoxes: true,
        returnSingleCharBoxes: true,
        intraOpNumThreads,
        interOpNumThreads: 1
      })
    )
  }
  return enginePromise
}
