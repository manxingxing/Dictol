export type DictionaryImportPreviewFile = {
  sourcePath: string
  relativePath: string
  fileSize: number
  required: boolean
}

export type DictionaryImportPreview = {
  mdxPath: string
  files: DictionaryImportPreviewFile[]
  icon: { relativePath: string; previewUrl: string } | null
}

export type DictionaryImportRequest = {
  mdxPath: string
  copyFiles: boolean
  selectedRelativePaths: string[]
}

export type DictionaryImportSourceFile = Pick<
  DictionaryImportPreviewFile,
  'sourcePath' | 'relativePath'
>

export type DictionaryFolderImportCandidate = {
  mdxPath: string
  relativePath: string
  companionFileCount: number
}

export type DictionaryFolderImportPreview = {
  rootPath: string
  dictionaries: DictionaryFolderImportCandidate[]
}

export type DictionaryFolderImportRequest = {
  rootPath: string
  copyFiles: boolean
  selectedMdxPaths: string[]
}

export type DictionaryImportWorkerFile = DictionaryImportSourceFile & {
  id: number | null
}

export type DictionaryImportWorkerRequest = {
  databasePath: string
  dictionaryId: number
  dictionaryUuid: string
  mdxPath: string
  sourceFiles: DictionaryImportWorkerFile[]
  copyFiles: boolean
  targetDirectory: string
  indexPath: string
}
