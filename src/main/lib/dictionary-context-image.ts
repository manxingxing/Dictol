import { nativeImage, type WebContents } from 'electron'

export async function readDictionaryContextImage(
  webContents: WebContents,
  params: Electron.ContextMenuParams
): Promise<Buffer | null> {
  if (params.srcURL.startsWith('data:image/')) {
    const image = nativeImage.createFromDataURL(params.srcURL)
    return image.isEmpty() ? null : image.toPNG()
  }

  try {
    const response = await webContents.session.fetch(params.srcURL)
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer())
      const image = nativeImage.createFromBuffer(bytes)
      if (!image.isEmpty()) return image.toPNG()
    }
  } catch (error) {
    console.warn('Failed to read dictionary image', {
      srcURL: params.srcURL,
      error
    })
  }
  return null
}
