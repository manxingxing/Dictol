import { dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import { extname, isAbsolute } from 'node:path'

import type {
  DictionaryImportPreview,
  DictionaryImportRequest
} from '../../shared/dictionary-import'
import type { DictionaryInfo } from '../../shared/dictionary-info'
import type { DictionarySummary, ImportedDictionary, ReadyDictionary } from '../db-service'
import {
  createDictionaryImportPreview,
  resolveExternalDictionaryFiles,
  resolveDictionaryImportSelection
} from '../dictionary-import-files'
import { parseDictionaryEntryUrl } from '../dictionary-entry-url'
import { BaseController } from './base-controller'

export class DictionaryController extends BaseController {
  override mount(): void {
    ipcMain.handle('dictionaries:list-ready', this.listReady)
    ipcMain.handle('dictionaries:list', this.listDictionaries)
    ipcMain.handle('dictionaries:select-file', this.selectImportFile)
    ipcMain.handle('dictionaries:get-info', this.getInfo)
    ipcMain.handle('dictionaries:import', this.importDictionary)
    ipcMain.handle('dictionaries:delete', this.deleteDictionary)
    ipcMain.handle('dictionaries:open-directory', this.openDirectory)
    ipcMain.handle('dictionaries:reorder', this.reorderDictionaries)
    ipcMain.handle('dictionaries:update-name', this.updateDictionaryName)
    ipcMain.handle('dictionaries:update-enabled', this.updateDictionaryEnabled)
    ipcMain.handle('dictionaries:update-custom-css', this.updateDictionaryCustomCss)
  }

  listReady = async (): Promise<ReadyDictionary[]> => {
    return this.db.listReadyDictionaries()
  }

  listDictionaries = async (): Promise<DictionarySummary[]> => {
    return this.db.listDictionaries()
  }

  selectImportFile = async (): Promise<DictionaryImportPreview | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'MDX 词典', extensions: ['mdx'] }]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return createDictionaryImportPreview(result.filePaths[0])
  }

  getInfo = async (_event: IpcMainInvokeEvent, dictionaryId: string): Promise<DictionaryInfo> => {
    const numericId = Number(dictionaryId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的词典 ID')
    const { metadata, dictionaryFileNames } =
      await this.runtime.mdictResourceManager.getInfo(numericId)

    return {
      title: metadata.title,
      description: metadata.description,
      dictionaryFileNames,
      entryCount: metadata.entryCount.toString(),
      version: metadata.version,
      engineVersion: metadata.engineVersion,
      requiredVersion: metadata.requiredVersion ?? null,
      format: metadata.format,
      encoding: metadata.encoding,
      encrypted: metadata.encrypted,
      keyCaseSensitive: metadata.keyCaseSensitive,
      stripKey: metadata.stripKey
    }
  }

  importDictionary = async (
    _event: IpcMainInvokeEvent,
    request: unknown
  ): Promise<ImportedDictionary> => {
    if (!isDictionaryImportRequest(request)) {
      throw new Error('请选择有效的 MDX 文件')
    }
    const sourceFiles = request.copyFiles
      ? await resolveDictionaryImportSelection(request)
      : await resolveExternalDictionaryFiles(request.mdxPath)
    return this.db.importDictionaryFromFile(
      request.mdxPath,
      sourceFiles,
      request.copyFiles,
      this.notifyImportReady
    )
  }

  private notifyImportReady = (name: string): void => {
    const message = `词典「${name}」导入完成`
    const mainWindow = this.runtime.mainWindow
    if (mainWindow?.isVisible()) {
      mainWindow.webContents.send('notification:toast', { type: 'success', message })
    } else {
      new Notification({ title: '词典导入完成', body: message }).show()
    }
  }

  deleteDictionary = async (_event: IpcMainInvokeEvent, dictionaryId: string): Promise<void> => {
    const numericId = Number(dictionaryId)
    const validNumericId = Number.isSafeInteger(numericId) && numericId > 0
    this.runtime.activeDictionaryView?.hide()
    if (!validNumericId) throw new Error('无效的词典 ID')

    await this.runtime.mdictResourceManager.close(numericId)
    await this.db.deleteDictionary(dictionaryId)
    await this.runtime.resourceCache.removeDictionary(numericId)
  }

  openDirectory = async (_event: IpcMainInvokeEvent, dictionaryId: string): Promise<void> => {
    const dictionaryPath = await this.db.getDictionaryPath(dictionaryId)
    if (!dictionaryPath) throw new Error('词典目录不存在')

    const error = await shell.openPath(dictionaryPath)
    if (error) throw new Error(error)
  }

  reorderDictionaries = async (
    _event: IpcMainInvokeEvent,
    dictionaryIds: string[]
  ): Promise<void> => {
    await this.db.reorderDictionaries(dictionaryIds)
  }

  updateDictionaryName = async (
    _event: IpcMainInvokeEvent,
    dictionaryId: string,
    name: string
  ): Promise<void> => {
    await this.db.updateDictionaryName(dictionaryId, name)
  }

  updateDictionaryEnabled = async (
    _event: IpcMainInvokeEvent,
    dictionaryId: string,
    enabled: boolean
  ): Promise<void> => {
    await this.db.updateDictionaryEnabled(dictionaryId, enabled)
  }

  updateDictionaryCustomCss = async (
    _event: IpcMainInvokeEvent,
    dictionaryId: string,
    customCss: string
  ): Promise<void> => {
    await this.db.updateDictionaryCustomCss(dictionaryId, customCss)

    const numericId = Number(dictionaryId)
    const view = this.runtime.activeDictionaryView
    const currentEntry = view ? parseDictionaryEntryUrl(view.getURL()) : null
    if (view && !view.isDestroyed && currentEntry?.dictionaryId === numericId) {
      view.reload()
    }
  }
}

function isDictionaryImportRequest(value: unknown): value is DictionaryImportRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as DictionaryImportRequest

  if (typeof request.mdxPath !== 'string') return false
  if (!isAbsolute(request.mdxPath)) return false
  if (extname(request.mdxPath).toLowerCase() !== '.mdx') return false
  if (typeof request.copyFiles !== 'boolean') return false

  const paths = request.selectedRelativePaths
  if (!Array.isArray(paths)) return false
  if (request.copyFiles && paths.length === 0) return false
  if (paths.length > 20_000) return false

  return paths.every((relativePath) => {
    if (typeof relativePath !== 'string') return false
    return relativePath.length > 0 && relativePath.length <= 1_000
  })
}
