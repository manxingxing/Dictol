import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

import type {
  DictionaryFolderImportPreview,
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

export async function collectResourceFiles(rootPath: string): Promise<ResourceFile[]> {
  return collectFilesWithExtensions(rootPath, RESOURCE_EXTENSIONS)
}

/** 收集一个词典目录下的伴随资源，不会把其他 MDX 当成资源。 */
export async function collectDictionaryCompanionFiles(rootPath: string): Promise<ResourceFile[]> {
  return collectResourceFiles(rootPath)
}

async function collectFilesWithExtensions(
  rootPath: string,
  extensions: ReadonlySet<string>,
  recursive = true
): Promise<ResourceFile[]> {
  const files: ResourceFile[] = []

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const sourcePath = join(directory, entry.name)
      const relativePath = join(relativeDirectory, entry.name)

      if (entry.isDirectory()) {
        if (recursive) await visit(sourcePath, relativePath)
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

export async function collectDictionaryImportFiles(
  mdxPath: string,
  recursive = true
): Promise<Array<DictionaryImportSourceFile & { required: boolean }>> {
  const mdxName = basename(mdxPath)
  const mdxBaseName = basename(mdxPath, extname(mdxPath)).toLowerCase()
  const rootPath = dirname(mdxPath)
  const resourceFiles = await collectFilesWithExtensions(rootPath, RESOURCE_EXTENSIONS, recursive)
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
  const iconFile = sourceFiles.find(
    (file) => file.required && file.relativePath !== basename(mdxPath)
  )

  return {
    mdxPath,
    files: await Promise.all(
      sourceFiles.map(async (file) => ({
        ...file,
        fileSize: (await stat(file.sourcePath)).size
      }))
    ),
    icon: iconFile ? await createIconPreview(iconFile) : null
  }
}

export type DictionaryImportFolderPlan = {
  mdxPath: string
  relativePath: string
  sourceFiles: DictionaryImportSourceFile[]
}

export function selectDictionaryImportPlans(
  plans: readonly DictionaryImportFolderPlan[],
  selectedMdxPaths: readonly string[]
): DictionaryImportFolderPlan[] {
  const selectedPaths = selectedMdxPaths.map((path) => resolve(path))
  if (new Set(selectedPaths).size !== selectedPaths.length) {
    throw new Error('词典选择列表包含重复路径')
  }

  const availablePaths = new Set(plans.map((plan) => plan.mdxPath))
  for (const path of selectedPaths) {
    if (!availablePaths.has(path)) {
      throw new Error(`词典选择列表包含未扫描到的 MDX 文件：${path}`)
    }
  }

  const selectedPathSet = new Set(selectedPaths)
  return plans.filter((plan) => selectedPathSet.has(plan.mdxPath))
}

/** 递归扫描目录并按每个 MDX 生成独立的导入计划。 */
export async function resolveDictionaryImportFolder(
  rootPath: string,
  excludedDictionaryPaths: readonly string[] = []
): Promise<DictionaryImportFolderPlan[]> {
  const normalizedRoot = resolve(rootPath)
  const excludedDirectories = new Set(excludedDictionaryPaths.map((path) => resolve(path)))
  const mdxFiles = await collectFilesWithExtensions(normalizedRoot, new Set(['.mdx']))
  const plans = mdxFiles
    .filter((file) => !excludedDirectories.has(resolve(dirname(file.sourcePath))))
    .map((file) => ({ mdxPath: resolve(file.sourcePath), relativePath: file.relativePath }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  validateDictionaryFolderLayout(plans)

  return Promise.all(
    plans.map(async (plan) => ({
      ...plan,
      sourceFiles: (await collectDictionaryImportFiles(plan.mdxPath, false)).map(
        ({ sourcePath, relativePath }) => ({ sourcePath, relativePath })
      )
    }))
  )
}

export async function createDictionaryFolderImportPreview(
  rootPath: string,
  excludedDictionaryPaths: readonly string[] = []
): Promise<DictionaryFolderImportPreview> {
  const normalizedRoot = resolve(rootPath)
  if (!isAbsolute(rootPath)) throw new Error('词典目录必须是绝对路径')
  const plans = await resolveDictionaryImportFolder(normalizedRoot, excludedDictionaryPaths)

  return {
    rootPath: normalizedRoot,
    dictionaries: plans.map((plan) => ({
      mdxPath: plan.mdxPath,
      relativePath: plan.relativePath,
      companionFileCount: plan.sourceFiles.length - 1
    }))
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

function validateDictionaryFolderLayout(
  plans: Array<Pick<DictionaryImportFolderPlan, 'mdxPath' | 'relativePath'>>
): void {
  const directories = plans.map((plan) => resolve(dirname(plan.mdxPath)))
  const firstMdxByDirectory = new Map<string, string>()
  for (let index = 0; index < plans.length; index += 1) {
    const directory = directories[index]
    const firstMdx = firstMdxByDirectory.get(directory)
    if (firstMdx) {
      throw new Error(
        `同一目录中发现多个 MDX 文件，无法判断伴随资源归属：${firstMdx}、${plans[index].relativePath}`
      )
    }
    firstMdxByDirectory.set(directory, plans[index].relativePath)
  }
}

async function createIconPreview(
  file: DictionaryImportSourceFile & { required: boolean }
): Promise<{ relativePath: string; previewUrl: string }> {
  const bytes = await readFile(file.sourcePath)
  const mimeType = getImageMimeType(file.sourcePath)
  return {
    relativePath: file.relativePath,
    previewUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
  }
}

function getImageMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}
