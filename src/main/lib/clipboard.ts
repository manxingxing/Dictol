import { ClipboardItem, clipboard } from 'electron'

export function writeImageToClipboard(mimeType: string, bytes: Uint8Array): Promise<void> {
  const item = new ClipboardItem({
    [mimeType]: new Blob([Uint8Array.from(bytes)], { type: mimeType })
  })
  return clipboard.write([item])
}
