import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OnlineTtsEngineId } from '../../shared/tts'

type StoredKeys = Partial<Record<OnlineTtsEngineId, string>>

export class TtsCredentialStore {
  private readonly path = join(app.getPath('userData'), 'tts-credentials.json')

  private read(): StoredKeys {
    try {
      if (!existsSync(this.path)) return {}
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as StoredKeys
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  get(provider: OnlineTtsEngineId): string {
    const value = this.read()[provider]
    if (!value || !safeStorage.isEncryptionAvailable()) return ''
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return ''
    }
  }

  save(provider: OnlineTtsEngineId, key: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法安全保存 API Key，请先启用系统密钥存储。')
    }
    const values = this.read()
    values[provider] = safeStorage.encryptString(key.trim()).toString('base64')
    mkdirSync(app.getPath('userData'), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(values)}\n`, 'utf8')
    renameSync(temporaryPath, this.path)
  }
}
