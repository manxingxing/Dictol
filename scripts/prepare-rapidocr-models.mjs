import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadModels } from 'rapidocr-node'

const modelDirectory = join(import.meta.dirname, '..', 'resources', 'rapidocr')
await mkdir(modelDirectory, { recursive: true })
const paths = await downloadModels({
  modelDirectory,
  detectionModel: { ocrVersion: 'PP-OCRv6', langType: 'ch', modelType: 'small' },
  recognitionModel: { ocrVersion: 'PP-OCRv6', langType: 'ch', modelType: 'small' }
})
console.info('[RapidOCR] prepared small models', paths)
