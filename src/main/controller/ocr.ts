import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isOcrConfig, type OcrConfig } from '../../shared/ocr-settings'
import { BaseController } from './base-controller'

export class OcrController extends BaseController {
  override mount(): void {
    if (process.platform !== 'win32') return
    ipcMain.handle('ocr:get-config', this.getConfig)
    ipcMain.handle('ocr:save-config', this.saveConfig)
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): OcrConfig | null => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id) return null
    return this.runtime.appConfig.load().ocr
  }

  private readonly saveConfig = (event: IpcMainInvokeEvent, request: unknown): OcrConfig | null => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id) return null
    if (!isOcrConfig(request)) throw new Error('OCR 设置格式无效。')
    const current = this.runtime.appConfig.load()
    const ocr = {
      engine: request.engine,
      language: request.language,
      captureEngine: request.captureEngine
    }
    this.runtime.appConfig.save({ ...current, ocr })
    return ocr
  }
}
