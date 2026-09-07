import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import type {
  DictionaryImportPreview,
  DictionaryImportRequest,
  DictionaryImportSourceFile
} from '../shared/dictionary-import'

const ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const IMAGE_EXTENSIONS = new Set(ICON_EXTENSIONS)
const RESOURCE_EXTENSIONS = new Set([
  '.mdd',
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.otf',
  '.ttf',
  '.woff',
  '.woff2'
])

export type ResourceFile = {
  sourcePath: string
  relativePath: string
}

export async function collectResourceFiles(
  rootPath: string
): Promise<ResourceFile[]> {
  return collectFilesWithExtensions(rootPath, RESOURCE_EXTENSIONS)
}

async function collectFilesWithExtensions(
  rootPath: string,
  extensions: ReadonlySet<string>
): Promise<ResourceFile[]> {
  const files: ResourceFile[] = []

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const sourcePath = join(directory, entry.name)
      const relativePath = join(relativeDirectory, entry.name)

      if (entry.isDirectory()) {
        await visit(sourcePath, relativePath)
        continue
      }
      if (entry.name.startsWith('.')) continue
      if (!entry.isFile() || !extensions.has(extname(entry.name).toLowerCase())) {
        continue
      }

      files.push({ sourcePath, relativePath })
    }
  }

  await visit(rootPath, '')
  return files
}

async function collectDictionaryImportFiles(
  mdxPath: string
): Promise<Array<DictionaryImportSourceFile & { required: boolean }>> {
  const mdxName = basename(mdxPath)
  const mdxBaseName = basename(mdxPath, extname(mdxPath)).toLowerCase()
  const rootPath = dirname(mdxPath)
  const resourceFiles = await collectResourceFiles(rootPath)
  const iconRelativePath = resourceFiles
    .filter(
      (file) =>
        IMAGE_EXTENSIONS.has(extname(file.sourcePath).toLowerCase()) &&
        dirname(file.sourcePath) === rootPath &&
        basename(file.sourcePath, extname(file.sourcePath)).toLowerCase() === mdxBaseName
    )
    .sort(
      (left, right) =>
        ICON_EXTENSIONS.indexOf(extname(left.sourcePath).toLowerCase()) -
        ICON_EXTENSIONS.indexOf(extname(right.sourcePath).toLowerCase())
    )[0]?.relativePath

  return [
    { sourcePath: mdxPath, relativePath: mdxName, required: true },
    ...resourceFiles.map((file) => ({
      ...file,
      required: file.relativePath === iconRelativePath
    }))
  ]
}

export async function createDictionaryImportPreview(
  mdxPath: string
): Promise<DictionaryImportPreview> {
  const sourceFiles = await collectDictionaryImportFiles(mdxPath)

  return {
    mdxPath,
    files: await Promise.all(
      sourceFiles.map(async (file) => ({
        ...file,
        fileSize: (await stat(file.sourcePath)).size
      }))
    )
  }
}

// 所有选择的合法文件，包括mdx, mdd，resource files
export async function resolveDictionaryImportSelection(
  request: DictionaryImportRequest
): Promise<DictionaryImportSourceFile[]> {
  const availableFiles = await collectDictionaryImportFiles(request.mdxPath)
  const selectedPaths = new Set(request.selectedRelativePaths)
  if (selectedPaths.size !== request.selectedRelativePaths.length) {
    throw new Error('导入文件列表包含重复路径')
  }

  const mdxRelativePath = basename(request.mdxPath)
  if (!selectedPaths.has(mdxRelativePath)) throw new Error('MDX 主文件不能取消选择')

  const availableByPath = new Map(availableFiles.map((file) => [file.relativePath, file]))
  const requiredPaths = availableFiles
    .filter((file) => file.required)
    .map((file) => file.relativePath)
  if (requiredPaths.some((relativePath) => !selectedPaths.has(relativePath))) {
    throw new Error('MDX 主文件和同名图标不能取消选择')
  }
  const selectedFiles = request.selectedRelativePaths.map((relativePath) => {
    const file = availableByPath.get(relativePath)
    if (!file) throw new Error(`导入文件已不存在或不再符合导入规则：${relativePath}`)
    return { sourcePath: file.sourcePath, relativePath: file.relativePath }
  })

  return selectedFiles
}

// 仅保留 mdx, mdd 文件
export async function resolveExternalDictionaryFiles(
  mdxPath: string
): Promise<DictionaryImportSourceFile[]> {
  const resourceFiles = await collectResourceFiles(dirname(mdxPath))

  return [
    { sourcePath: mdxPath, relativePath: basename(mdxPath) },
    ...resourceFiles
      .filter((file) => extname(file.relativePath).toLowerCase() === '.mdd')
      .map(({ sourcePath, relativePath }) => ({ sourcePath, relativePath }))
  ]
}
