import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAiModels } from '@/hooks/use-ai-lookup'

export function AiModelSelect({
  baseUrl,
  apiKey,
  hasSavedKey,
  translationProviderId,
  value,
  onChange
}: {
  baseUrl: string
  apiKey: string
  hasSavedKey: boolean
  translationProviderId?: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const models = useAiModels(translationProviderId)
  const { mutate, reset } = models

  useEffect(() => {
    reset()
    if (!baseUrl || (!apiKey.trim() && !hasSavedKey)) return
    const timer = setTimeout(() => mutate({ baseUrl, apiKey }), 600)
    return () => clearTimeout(timer)
  }, [baseUrl, apiKey, hasSavedKey, mutate, reset])

  const matchesRequest =
    models.variables?.baseUrl === baseUrl && models.variables?.apiKey === apiKey
  const items = matchesRequest ? (models.data ?? []) : []
  const loading = matchesRequest && models.isPending
  const customModel = search.trim()
  const select = (model: string): void => {
    onChange(model)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) setSearch('')
          }}
        >
          <PopoverTrigger asChild>
            <Button
              id="ai-model"
              role="combobox"
              aria-expanded={open}
              aria-label="模型"
              variant="outline"
              className="min-w-0 flex-1 justify-between font-normal"
            >
              <span className="truncate">{value || '选择或输入模型名称'}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
            <Command>
              <CommandInput
                aria-label="搜索或输入模型名称"
                placeholder="搜索或输入新的模型名称…"
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>
                  {loading ? '正在加载模型…' : '暂无模型，请输入模型名称。'}
                </CommandEmpty>
                {customModel && !items.includes(customModel) && (
                  <CommandItem value={customModel} onSelect={() => select(customModel)}>
                    使用「{customModel}」
                  </CommandItem>
                )}
                {items.map((model) => (
                  <CommandItem key={model} value={model} onSelect={() => select(model)}>
                    <span className="min-w-0 break-all">{model}</span>
                    {value === model && <Check className="ml-auto size-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="outline"
          disabled={!baseUrl || loading}
          onClick={() => mutate({ baseUrl, apiKey })}
        >
          {loading && <LoaderCircle className="size-4 animate-spin" />}
          {loading ? '加载中…' : '刷新模型列表'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        填写密钥后自动加载；也可输入模型名称并选择“使用”。请选择支持聊天的模型。
      </p>
      {matchesRequest && models.isError && (
        <p className="text-xs text-destructive" role="alert">
          模型加载失败：{models.error.message} 可重试或手动输入。
        </p>
      )}
      {matchesRequest && models.isSuccess && items.length === 0 && (
        <p className="text-xs text-muted-foreground">服务商返回了空列表，仍可手动输入模型名称。</p>
      )}
    </div>
  )
}
