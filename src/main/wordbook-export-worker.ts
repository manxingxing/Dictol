import ExcelJS from 'exceljs'
import { parentPort, workerData } from 'node:worker_threads'

import { openDrizzleDB } from './db/drizzle'
import {
  WordbookRepository,
  type WordbookWordWithWordbook
} from './db/repository/wordbook-repository'

type ExportRequest =
  | { scope: 'all' }
  | { scope: 'wordbook'; wordbookId: number }
  | { scope: 'selected'; wordIds: number[] }

type ExportWorkerData = {
  databasePath: string
  temporaryPath: string
  request: ExportRequest
}

type ExportSheet = {
  name: string
  words: WordbookWordWithWordbook[]
}

if (!parentPort) throw new Error('Wordbook export worker must run in a worker thread')

const input = workerData as ExportWorkerData

void exportWordbooks(input)
  .then(() => parentPort?.postMessage({ ok: true, temporaryPath: input.temporaryPath }))
  .catch((error: unknown) => {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : '导出生词本失败'
    })
  })

async function exportWordbooks({
  databasePath,
  temporaryPath,
  request
}: ExportWorkerData): Promise<void> {
  const { db, orm } = openDrizzleDB(databasePath)

  try {
    const repository = new WordbookRepository(orm)
    const sheets = await loadSheets(repository, request)
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Dictol'
    workbook.created = new Date()
    workbook.modified = new Date()

    const usedNames = new Set<string>()
    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(toSheetName(sheet.name, usedNames))
      worksheet.columns = [
        { header: '单词', key: 'word', width: 28 },
        { header: '音标', key: 'phonetic', width: 22 },
        { header: '中文释义', key: 'translation', width: 48 },
        { header: '英文释义', key: 'definition', width: 56 },
        { header: '标签', key: 'tags', width: 32 },
        { header: '星级', key: 'star', width: 10 },
        { header: '生词本', key: 'wordbookName', width: 22 },
        { header: '添加时间', key: 'createdAt', width: 24 }
      ]
      worksheet.getRow(1).font = { bold: true }
      worksheet.views = [{ state: 'frozen', ySplit: 1 }]
      for (const word of sheet.words) {
        worksheet.addRow({
          word: word.word,
          phonetic: word.phonetic,
          translation: word.translation,
          definition: word.definition,
          tags: word.tags.map((tag) => tag.name).join(', '),
          star: word.star,
          wordbookName: word.wordbookName,
          createdAt: word.createdAt
        })
      }
      worksheet.autoFilter = { from: 'A1', to: 'H1' }
    }

    await workbook.xlsx.writeFile(temporaryPath)
  } finally {
    db.close()
  }
}

async function loadSheets(
  repository: WordbookRepository,
  request: ExportRequest
): Promise<ExportSheet[]> {
  if (request.scope === 'all') {
    const wordbooks = await repository.listAll()
    return await Promise.all(
      wordbooks.map(async (wordbook) => ({
        name: wordbook.name,
        words: await repository.listWords(wordbook.id)
      }))
    )
  }

  if (request.scope === 'wordbook') {
    const wordbook = await repository.findById(request.wordbookId)
    if (!wordbook) throw new Error('生词本不存在')
    return [{ name: wordbook.name, words: await repository.listWords(wordbook.id) }]
  }

  return [{ name: '所选单词', words: await repository.listWordsByIds(request.wordIds) }]
}

function toSheetName(name: string, usedNames: Set<string>): string {
  const base =
    name
      .replace(/[\\/:*?\u005B\u005D]/g, ' ')
      .trim()
      .slice(0, 31) || '生词本'
  let candidate = base
  let index = 2
  while (usedNames.has(candidate)) {
    const suffix = ` (${index})`
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    index += 1
  }
  usedNames.add(candidate)
  return candidate
}
