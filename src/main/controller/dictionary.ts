import { dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import { dirname, extname, isAbsolute } from 'node:path'

import type {
  DictionaryFolderImportPreview,
  DictionaryFolderImportRequest,
  DictionaryImportPreview,
  DictionaryImportRequest
} from '../../shared/dictionary-import'
import type { DictionaryInfo } from '../../shared/dictionary-info'
import type { DictionaryIndexMigrationResult } from '../../shared/dictionary-index-migration'
import type {
  DictionaryIndexInfo,
  DictionaryGroupSummary,
  DictionarySummary,
  ImportedDictionary,
  ReadyDictionary
} from '../db-service'
import { DidxImportService, mapWithConcurrency } from '../didx-import-service'
import { getDictionaryIndexRoot } from '../db/paths'
import {
  createDictionaryImportPreview,
  createDictionaryFolderImportPreview,
  resolveExternalDictionaryFiles,
  resolveDictionaryImportSelection
} from '../dictionary-import-files'
import { parseDictionaryEntryUrl } from '../dictionary-entry-url'
import { dismissSearchPopover } from './search-popover'
import { BaseController } from './base-controller'

export class DictionaryController extends BaseController {
  private migrationTask: Promise<DictionaryIndexMigrationResult> | undefined

  override mount(): void {
    ipcMain.handle('dictionaries:list-ready', this.listReady)
    ipcMain.handle('dictionaries:list', this.listDictionaries)
    ipcMain.handle('dictionaries:select-file', this.selectImportFile)
    ipcMain.handle('dictionaries:select-folder', this.selectImportFolder)
    ipcMain.handle('dictionaries:get-info', this.getInfo)
    ipcMain.handle('dictionaries:get-index-info', this.getIndexInfo)
    ipcMain.handle('dictionaries:open-index-directory', this.openIndexDirectory)
    ipcMain.handle('dictionaries:reindex', this.reindex)
    ipcMain.handle('dictionaries:migrate-indexes', this.migrateIndexes)
    ipcMain.handle('dictionaries:import', this.importDictionary)
    ipcMain.handle('dictionaries:import-folder', this.importDictionaryFolder)
    ipcMain.handle('dictionaries:delete', this.deleteDictionary)
    ipcMain.handle('dictionaries:open-directory', this.openDirectory)
    ipcMain.handle('dictionaries:reorder', this.reorderDictionaries)
    ipcMain.handle('dictionaries:update-name', this.updateDictionaryName)
    ipcMain.handle('dictionaries:update-enabled', this.updateDictionaryEnabled)
    ipcMain.handle('dictionaries:update-custom-css', this.updateDictionaryCustomCss)
    ipcMain.handle('dictionary-groups:list', this.listDictionaryGroups)
    ipcMain.handle('dictionary-groups:create', this.createDictionaryGroup)
    ipcMain.handle('dictionary-groups:update-name', this.updateDictionaryGroupName)
    ipcMain.handle('dictionary-groups:delete', this.deleteDictionaryGroup)
    ipcMain.handle('dictionary-groups:update-members', this.updateDictionaryGroupMembers)
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

  selectImportFolder = async (): Promise<DictionaryFolderImportPreview | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return createDictionaryFolderImportPreview(
      result.filePaths[0],
      await this.db.listDictionaryPaths()
    )
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

  getIndexInfo = async (
    _event: IpcMainInvokeEvent,
    dictionaryId: string
  ): Promise<DictionaryIndexInfo> => {
    const info = await this.db.getDictionaryIndexInfo(dictionaryId)
    if (info.status !== 'ready') return info

    try {
      await this.runtime.dictionaryIndexManager.validate(Number(dictionaryId))
      return info
    } catch (error) {
      console.warn('Dictionary index validation failed', { dictionaryId, error })
      return { ...info, status: 'error' }
    }
  }

  openIndexDirectory = async (_event: IpcMainInvokeEvent, dictionaryId: string): Promise<void> => {
    const { indexPath } = await this.db.getDictionaryIndexInfo(dictionaryId)
    const error = await shell.openPath(dirname(indexPath))
    if (error) throw new Error(error)
  }

  reindex = async (
    _event: IpcMainInvokeEvent,
    dictionaryId: string
  ): Promise<DictionaryIndexInfo> => {
    const numericId = Number(dictionaryId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的词典 ID')
    if (!this.runtime.db) throw new Error('数据库尚未初始化')
    const service = new DidxImportService(this.runtime.db, getDictionaryIndexRoot(), 1)
    await this.runtime.dictionaryIndexManager.change(numericId, () => service.rebuild(numericId))
    return this.db.getDictionaryIndexInfo(dictionaryId)
  }

  migrateIndexes = async (): Promise<DictionaryIndexMigrationResult> => {
    if (this.migrationTask) return this.migrationTask

    const task = this.runIndexMigration()
    this.migrationTask = task
    try {
      return await task
    } finally {
      if (this.migrationTask === task) this.migrationTask = undefined
    }
  }

  private async runIndexMigration(): Promise<DictionaryIndexMigrationResult> {
    const targets = (await this.db.listReadyDictionaries()).filter(
      ({ indexStatus }) => indexStatus !== 'ready'
    )
    dismissSearchPopover(this.runtime)

    if (!this.runtime.db) throw new Error('数据库尚未初始化')
    const service = new DidxImportService(this.runtime.db, getDictionaryIndexRoot(), 2)
    const outcomes = await mapWithConcurrency(targets, 2, async (target) => {
      const dictionaryId = Number(target.id)
      try {
        await this.runtime.dictionaryIndexManager.change(dictionaryId, () =>
          service.rebuild(dictionaryId)
        )
        return { target, error: null }
      } catch (error) {
        return {
          target,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    })

    // Finish every index before spending time removing legacy lookup rows.
    for (const { target, error } of outcomes) {
      if (error !== null) continue
      try {
        await this.db.deleteLegacyDictionaryEntries(Number(target.id))
      } catch (cleanupError) {
        console.warn('Failed to remove migrated legacy dictionary entries', {
          dictionaryId: target.id,
          error: cleanupError
        })
      }
    }

    return {
      succeededDictionaryIds: outcomes
        .filter(({ error }) => error === null)
        .map(({ target }) => target.id),
      failed: outcomes
        .filter((outcome): outcome is typeof outcome & { error: string } => outcome.error !== null)
        .map(({ target, error }) => ({
          dictionaryId: target.id,
          dictionaryName: target.name,
          error
        }))
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

  importDictionaryFolder = async (
    _event: IpcMainInvokeEvent,
    request: unknown
  ): Promise<ImportedDictionary[]> => {
    if (!isDictionaryFolderImportRequest(request)) {
      throw new Error('请选择有效的词典目录')
    }
    return this.db.importDictionariesFromFolder(
      request.rootPath,
      request.copyFiles,
      this.notifyImportReady,
      request.selectedMdxPaths
    )
  }

  private notifyImportReady = (name: string, indexElapsedMs: number): void => {
    const message = `词典「${name}」导入完成，索引耗时 ${formatElapsedMs(indexElapsedMs)}`
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

    await this.runtime.dictionaryIndexManager.change(numericId, async () => {
      await this.runtime.mdictResourceManager.close(numericId)
      await this.db.deleteDictionary(dictionaryId)
      await this.runtime.resourceCache.removeDictionary(numericId)
    })
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

  listDictionaryGroups = async (): Promise<DictionaryGroupSummary[]> => {
    return this.db.listDictionaryGroups()
  }

  createDictionaryGroup = async (
    _event: IpcMainInvokeEvent,
    name: unknown
  ): Promise<DictionaryGroupSummary> => {
    if (typeof name !== 'string') throw new Error('无效的词典组名称')
    return this.db.createDictionaryGroup(name)
  }

  updateDictionaryGroupName = async (
    _event: IpcMainInvokeEvent,
    groupId: string,
    name: unknown
  ): Promise<void> => {
    if (typeof name !== 'string') throw new Error('无效的词典组名称')
    await this.db.updateDictionaryGroupName(groupId, name)
  }

  deleteDictionaryGroup = async (_event: IpcMainInvokeEvent, groupId: string): Promise<void> => {
    if (
      this.runtime.selectionDictionaryGroupId !== undefined &&
      String(this.runtime.selectionDictionaryGroupId) === groupId
    ) {
      throw new Error('该词典组正在用于“取词组”，请先修改取词组后再删除')
    }
    await this.db.deleteDictionaryGroup(groupId)
  }

  updateDictionaryGroupMembers = async (
    _event: IpcMainInvokeEvent,
    groupId: string,
    dictionaryIds: unknown
  ): Promise<void> => {
    if (!Array.isArray(dictionaryIds) || !dictionaryIds.every((id) => typeof id === 'string')) {
      throw new Error('无效的词典组成员')
    }
    await this.db.updateDictionaryGroupMembers(groupId, dictionaryIds)
  }
}

function formatElapsedMs(value: number): string {
  return value < 1000 ? `${Math.round(value)} 毫秒` : `${(value / 1000).toFixed(2)} 秒`
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

function isDictionaryFolderImportRequest(value: unknown): value is DictionaryFolderImportRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as DictionaryFolderImportRequest
  return (
    typeof request.rootPath === 'string' &&
    isAbsolute(request.rootPath) &&
    request.rootPath.length <= 4_000 &&
    typeof request.copyFiles === 'boolean' &&
    Array.isArray(request.selectedMdxPaths) &&
    request.selectedMdxPaths.length <= 20_000 &&
    request.selectedMdxPaths.every(
      (mdxPath) => typeof mdxPath === 'string' && mdxPath.length > 0 && mdxPath.length <= 4_000
    )
  )
}
