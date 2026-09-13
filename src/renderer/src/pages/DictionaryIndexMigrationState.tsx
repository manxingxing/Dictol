import { AlertCircle, DatabaseZap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMigrateDictionaryIndexes } from '@/hooks/use-dictionaries'

type PendingDictionary = {
  id: string
  name: string
  indexStatus: 'building' | 'error' | 'needs_reindex' | 'missing'
}

export function DictionaryIndexMigrationState({
  dictionaries
}: {
  dictionaries: PendingDictionary[]
}): React.JSX.Element {
  const migration = useMigrateDictionaryIndexes()
  const failures = new Map(
    migration.data?.failed.map((failure) => [failure.dictionaryId, failure.error]) ?? []
  )

  const migrate = async (): Promise<void> => {
    const result = await migration.mutateAsync()
    if (result.failed.length === 0) window.location.reload()
  }

  return (
    <section className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-8 py-12">
      <Card>
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <DatabaseZap className="size-5" />
          </div>
          <CardTitle>需要重新为词典生成索引</CardTitle>
          <CardDescription className="leading-6">
            以下词典需要重新建立索引。词典原文件不会受到影响。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            {dictionaries.map((dictionary) => {
              const error = failures.get(dictionary.id)
              return (
                <div
                  className="flex min-h-11 items-center gap-3 border-b px-3 py-2 last:border-b-0"
                  key={dictionary.id}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{dictionary.name}</span>
                  {error ? (
                    <span
                      className="flex items-center gap-1 text-xs text-destructive"
                      title={error}
                    >
                      <AlertCircle className="size-3.5" />
                      失败
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">待索引</span>
                  )}
                </div>
              )
            })}
          </div>
          {migration.isError && (
            <p className="mt-3 text-sm text-destructive">{migration.error.message}</p>
          )}
          <div className="mt-5 flex justify-end">
            <Button disabled={migration.isPending} onClick={() => void migrate()}>
              {migration.isPending
                ? '正在重新索引…'
                : failures.size > 0
                  ? '重试失败项'
                  : '重新索引'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
