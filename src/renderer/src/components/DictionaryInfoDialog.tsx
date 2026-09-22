import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SanitizedHtml } from '@/components/SanitizedHtml'
import { useDictionaryInfo } from '@/hooks/use-dictionaries'
import { FolderOpen } from 'lucide-react'

type Dictionary = Pick<
  Awaited<ReturnType<Window['dictol']['dictionaries']['list']>>[number],
  'id' | 'name' | 'dictPath'
>

type DictionaryInfoDialogProps = {
  dictionary: Dictionary | null
  onOpenDirectory: (dictionaryId: string, dictionaryName: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

function formatRecordCount(value: string): string {
  try {
    return new Intl.NumberFormat('zh-CN').format(BigInt(value))
  } catch {
    return value
  }
}

export function DictionaryInfoDialog({
  dictionary,
  onOpenDirectory,
  onOpenChange
}: DictionaryInfoDialogProps): React.JSX.Element {
  const { data: dictionaryInfo, error, isLoading } = useDictionaryInfo(dictionary?.id ?? null)

  return (
    <Dialog open={dictionary !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 [&>button]:right-3 [&>button]:top-3">
        <DialogHeader className="gap-1 border-b border-border px-[18px] py-3 pr-12">
          <DialogTitle className="text-base">词典信息 · {dictionary?.name}</DialogTitle>
          <DialogDescription className="text-xs">信息来自该词典的 MDX metadata。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-[18px] pb-3.5">
          <dl className="m-0">
            <div className="grid grid-cols-[4em_minmax(0,1fr)] gap-3.5 border-b border-border py-2.5 pt-3.5">
              <dt className="mt-px text-xs font-medium text-muted-foreground">名称</dt>
              <dd className="m-0 min-w-0 break-words text-sm font-medium leading-5">
                {dictionaryInfo?.title || '—'}
              </dd>
            </div>

            <div className="grid grid-cols-[4em_minmax(0,1fr)] gap-3.5 border-b border-border py-2.5">
              <dt className="mt-px text-xs font-medium text-muted-foreground">Metadata</dt>
              <dd className="m-0 flex min-w-0 flex-wrap gap-x-[18px] gap-y-1.5 text-sm">
                <span className="whitespace-nowrap">
                  <span className="mr-1.5 text-[11px] text-muted-foreground">Entry count</span>
                  {dictionaryInfo ? formatRecordCount(dictionaryInfo.entryCount) : '—'}
                </span>
                <span className="whitespace-nowrap">
                  <span className="mr-1.5 text-[11px] text-muted-foreground">Format</span>
                  {dictionaryInfo?.format || '—'}
                </span>
                <span className="whitespace-nowrap">
                  <span className="mr-1.5 text-[11px] text-muted-foreground">Encoding</span>
                  {dictionaryInfo?.encoding || '—'}
                </span>
                <span className="whitespace-nowrap">
                  <span className="mr-1.5 text-[11px] text-muted-foreground">Version</span>
                  {dictionaryInfo?.version || '—'}
                </span>
              </dd>
            </div>

            <div className="grid grid-cols-[4em_minmax(0,1fr)] gap-3.5 border-b border-border py-2.5">
              <dt className="mt-px text-xs font-medium text-muted-foreground">描述</dt>
              <dd className="m-0 min-w-0">
                <div className="max-h-[clamp(240px,48dvh,360px)] overflow-y-auto pr-2">
                  {isLoading ? (
                    <p className="text-xs text-muted-foreground">正在读取…</p>
                  ) : error ? (
                    <p className="text-xs text-destructive">无法读取词典信息：{error.message}</p>
                  ) : dictionaryInfo?.description ? (
                    <SanitizedHtml
                      className="text-xs leading-[1.55] [&_h1]:text-sm [&_p]:mb-1.5 [&_p:last-child]:mb-0"
                      content={dictionaryInfo.description}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </div>
              </dd>
            </div>

            <div className="grid grid-cols-[4em_minmax(0,1fr)] gap-3.5 border-b border-border py-2.5">
              <dt className="mt-px text-xs font-medium text-muted-foreground">词典目录</dt>
              <dd className="m-0 flex min-w-0 items-start justify-between gap-1.5 text-xs">
                <span className="min-w-0 break-all font-mono text-[11px]">{dictionary?.dictPath || '—'}</span>
                <Button
                  aria-label="打开所在目录"
                  className="shrink-0 size-5"
                  disabled={!dictionary?.dictPath}
                  onClick={() => {
                    if (dictionary) void onOpenDirectory(dictionary.id, dictionary.name)
                  }}
                  size="icon"
                  title="打开所在目录"
                  type="button"
                  variant="ghost"
                >
                  <FolderOpen />
                </Button>
              </dd>
            </div>

            <div className="grid grid-cols-[4em_minmax(0,1fr)] gap-3.5 py-2.5">
              <dt className="mt-px text-xs font-medium text-muted-foreground">词典文件</dt>
              <dd className="m-0 min-w-0">
                {dictionaryInfo?.dictionaryFileNames.length ? (
                  <ul className="m-0 flex flex-wrap gap-1.5 list-none p-0 pr-2">
                    {dictionaryInfo.dictionaryFileNames.map((fileName, index) => (
                      <li
                        className="whitespace-nowrap rounded-md bg-muted px-2 py-1 font-mono text-[11px] leading-5"
                        key={`${fileName}-${index}`}
                      >
                        {fileName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  )
}
