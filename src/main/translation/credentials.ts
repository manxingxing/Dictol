import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type CredentialMap = Record<string, Record<string, string>>

export class TranslationCredentialStore {
  constructor(
    private readonly path = join(app.getPath('userData'), 'translation-credentials.json')
  ) {}

  get(providerId: string): Record<string, string> {
    return { ...this.read()[providerId] }
  }

  save(providerId: string, fields: Record<string, string>): void {
    const all = this.read()
    all[providerId] = { ...all[providerId], ...fields }
    this.write(all)
  }

  delete(providerId: string): void {
    const all = this.read()
    if (!Object.hasOwn(all, providerId)) return
    delete all[providerId]
    this.write(all)
  }

  private read(): CredentialMap {
    if (!existsSync(this.path) || !safeStorage.isEncryptionAvailable()) return {}
    try {
      const encoded = JSON.parse(readFileSync(this.path, 'utf8')) as string
      return JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))) as CredentialMap
    } catch (error) {
      console.warn('Failed to read translation credentials', error)
      return {}
    }
  }

  private write(value: CredentialMap): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法安全保存翻译服务密钥。')
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const encoded = safeStorage.encryptString(JSON.stringify(value)).toString('base64')
    const temporaryPath = `${this.path}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(encoded)}\n`, 'utf8')
    renameSync(temporaryPath, this.path)
  }
}
