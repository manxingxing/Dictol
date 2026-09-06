export type DictionaryImportPreviewFile = {
  sourcePath: string
  relativePath: string
  fileSize: number
  required: boolean
}

export type DictionaryImportPreview = {
  mdxPath: string
  files: DictionaryImportPreviewFile[]
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
