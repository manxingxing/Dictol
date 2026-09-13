export type DictionaryIndexMigrationFailure = {
  dictionaryId: string
  dictionaryName: string
  error: string
}

export type DictionaryIndexMigrationResult = {
  succeededDictionaryIds: string[]
  failed: DictionaryIndexMigrationFailure[]
}
