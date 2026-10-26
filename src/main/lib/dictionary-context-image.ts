import { writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { dialog, nativeImage, type BrowserWindow, type WebContents } from 'electron'
import sharp from 'sharp'
import { writeImageToClipboard } from './clipboard'

export interface DictionaryContextImage {
  mimeType: string
  bytes: Buffer
}

// 右键 - 复制图片
export async function copyContextImageToClipboard(
  webContents: WebContents,
  params: Electron.ContextMenuParams
): Promise<void> {
  const image = await readDictionaryContextImage(webContents, params)
  if (!image) { // fallback
    webContents.copyImageAt(params.x, params.y)
    return
  }

  // svg 目前无法写入到剪贴板，先转成 png
  if (image.mimeType.toLowerCase() === 'image/svg+xml') {
    const png = await convertDictionaryContextImageToPng(image)
    if (!png) throw new Error('无法将 SVG 图片转换为 PNG')
    await writeImageToClipboard('image/png', png)
  } else {
    await writeImageToClipboard(image.mimeType, image.bytes)
  }
}

// 右键 - 下载图片
export async function downloadContextImage(
  window: BrowserWindow,
  webContents: WebContents,
  params: Electron.ContextMenuParams
): Promise<void> {
  const image = await readDictionaryContextImage(webContents, params)
  if (!image) throw new Error('无法读取图片')
  await saveContextImage(window, params.srcURL, image)
}

// 弹出保存文件对话框，把 image(bytes, mimeType)原样保存到目标文件夹
export async function saveContextImage(
  window: BrowserWindow,
  srcURL: string,
  image: DictionaryContextImage
): Promise<void> {
  const { fileName, extension } = getImageFileName(srcURL, image.mimeType)
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: '下载图片',
    defaultPath: fileName,
    filters: extension ? [{ name: '图片', extensions: [extension] }] : undefined
  })

  if (canceled || !filePath) return
  await writeFile(filePath, image.bytes)
}

// 右键所处的图片 -> { bytes, mimeType }
export async function readDictionaryContextImage(
  webContents: WebContents,
  params: Electron.ContextMenuParams
): Promise<DictionaryContextImage | null> {
  try {
    if (params.srcURL.startsWith('data:image/')) {
      return readDataImageUrl(params.srcURL)
    }

    const response = await webContents.session.fetch(params.srcURL)
    if (!response.ok) return null

    const mimeType =
      response.headers.get('content-type')?.split(';', 1)[0].trim() || 'application/octet-stream'
    const bytes = Buffer.from(await response.arrayBuffer())
    return { mimeType, bytes }
  } catch (error) {
    console.warn('Failed to read dictionary image', {
      srcURL: params.srcURL,
      error
    })
    return null
  }
}

// data:// url ->  { mimeType, bytes }
function readDataImageUrl(dataUrl: string): DictionaryContextImage | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null

  const metadata = dataUrl.slice('data:'.length, comma).split(';')
  const mimeType = metadata[0].toLowerCase()
  if (!mimeType.startsWith('image/')) return null

  const payload = dataUrl.slice(comma + 1)
  const bytes = metadata.slice(1).some((parameter) => parameter.toLowerCase() === 'base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))

  return { mimeType, bytes }
}

// 计算保存图片时的默认文件名
function getImageFileName(srcURL: string, mimeType: string): {
  fileName: string
  extension?: string
} {
  const extension = imageExtensionFromMimeType(mimeType)
  let fileName = ''

  if (!srcURL.startsWith('data:')) {
    try {
      fileName = basename(decodeURIComponent(new URL(srcURL).pathname))
    } catch {
      // Fall back to a MIME-based name if the source URL has no usable path.
    }
  }

  if (!fileName || fileName === '.' || fileName === '/') fileName = 'image'
  if (extension) {
    const currentExtension = extname(fileName)
    fileName = currentExtension
      ? `${fileName.slice(0, -currentExtension.length)}.${extension}`
      : `${fileName}.${extension}`
  }

  return { fileName, extension }
}

// 根据 mimeType 设置文件后缀
function imageExtensionFromMimeType(mimeType: string): string | undefined {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/avif':
      return 'avif'
    case 'image/bmp':
      return 'bmp'
    case 'image/svg+xml':
      return 'svg'
    case 'image/tiff':
      return 'tif'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico'
    default:
      return undefined
  }
}

// bytes -> png bytes
export async function convertDictionaryContextImageToPng({
  mimeType,
  bytes
}: DictionaryContextImage): Promise<Buffer | null> {
  try {
    if (mimeType.toLowerCase() === 'image/svg+xml') {
      return await sharp(bytes, { limitInputPixels: 30_000_000 }).png().toBuffer()
    }

    const image = nativeImage.createFromBuffer(bytes)
    return image.isEmpty() ? null : image.toPNG()
  } catch (error) {
    console.warn('Failed to convert dictionary image to PNG', { mimeType, error })
    return null
  }
}
