import { useState } from 'react'
import { CircleAlert, Globe2, LoaderCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAddOnlineDictionary } from '@/hooks/use-online-dictionaries'
import { fillDictionaryUrlTemplate } from '../../../shared/online-dictionary-template'

export function OnlineDictionaryDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [editor, setEditor] = useState({
    name: '',
    faviconUrl: '',
    urlTemplate: '',
    faviconAuto: true
  })
  const addOnlineDictionary = useAddOnlineDictionary()
  const [loadedFaviconUrl, setLoadedFaviconUrl] = useState<string | null>(null)
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null)

  const faviconPreviewUrl = editor.faviconUrl.trim()
  const isPreviewableFaviconUrl = isHttpUrl(faviconPreviewUrl)
  const faviconPreviewFailed = failedFaviconUrl === faviconPreviewUrl
  const faviconPreviewLoading =
    isPreviewableFaviconUrl && !faviconPreviewFailed && loadedFaviconUrl !== faviconPreviewUrl
  const faviconPreviewHasError =
    Boolean(faviconPreviewUrl) && (!isPreviewableFaviconUrl || faviconPreviewFailed)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void addOnlineDictionary
      .mutateAsync({
        name: editor.name,
        faviconUrl: editor.faviconUrl,
        urlTemplate: editor.urlTemplate
      })
      .then(onClose)
      .catch((error) => {
        console.error('failed to add dictionary: ', error.message)
      })
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !addOnlineDictionary.isPending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>添加在线词典</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="online-dictionary-name">
                名称
              </label>
              <Input
                autoFocus
                id="online-dictionary-name"
                maxLength={100}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="例如：Google 翻译"
                value={editor.name}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="online-dictionary-url">
                  URL 模板
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:underline"
                      type="button"
                    >
                      占位符说明
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-96 max-w-[var(--radix-popover-content-available-width)] text-xs"
                  >
                    <p className="mb-3 font-medium">占位符说明</p>
                    <p className="mb-2 text-muted-foreground">以下示例以“兔”作为查词内容。</p>
                    <table className="w-full text-left leading-5">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="pb-2 pr-3 font-medium">占位符</th>
                          <th className="pb-2 pr-3 font-medium">含义</th>
                          <th className="pb-2 font-medium">示例</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border">
                          <td className="py-2 pr-3">
                            <code>%s, {'{w}'}</code>
                          </td>
                          <td className="py-2 pr-3">完整词条，URL 编码</td>
                          <td className="py-2">
                            <code>%E5%85%94</code>
                          </td>
                        </tr>
                        <tr className="border-t border-border">
                          <td className="py-2 pr-3">
                            <code>{'{uc_d}'}</code>
                          </td>
                          <td className="py-2 pr-3">首字 Unicode 码点，十进制</td>
                          <td className="py-2">
                            <code>20820</code>
                          </td>
                        </tr>
                        <tr className="border-t border-border">
                          <td className="py-2 pr-3">
                            <code>{'{uc_u}'}</code>
                          </td>
                          <td className="py-2 pr-3">首字码点，大写十六进制，带 U 前缀，至少五位</td>
                          <td className="py-2">
                            <code>U05154</code>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </PopoverContent>
                </Popover>
              </div>
              <Input
                id="online-dictionary-url"
                maxLength={2_000}
                onChange={(event) => {
                  const urlTemplate = event.target.value
                  const suggestedFavicon = inferFaviconUrl(urlTemplate)
                  setEditor((current) => ({
                    ...current,
                    urlTemplate,
                    faviconUrl: current.faviconAuto
                      ? (suggestedFavicon ?? current.faviconUrl)
                      : current.faviconUrl
                  }))
                }}
                placeholder="https://example.com/search?q=%s"
                value={editor.urlTemplate}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="online-dictionary-favicon">
                favicon URL
              </label>
              <InputGroup aria-invalid={faviconPreviewHasError || undefined}>
                <InputGroupInput
                  aria-invalid={faviconPreviewHasError || undefined}
                  className="pl-11"
                  id="online-dictionary-favicon"
                  maxLength={2_000}
                  onChange={(event) => {
                    setLoadedFaviconUrl(null)
                    setFailedFaviconUrl(null)
                    setEditor((current) => ({
                      ...current,
                      faviconUrl: event.target.value,
                      faviconAuto: false
                    }))
                  }}
                  placeholder="自动使用网站 /favicon.ico"
                  value={editor.faviconUrl}
                />
                <InputGroupAddon align="inline-start">
                  <span className="relative flex size-5 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
                    {isPreviewableFaviconUrl && !faviconPreviewFailed && (
                      <img
                        alt=""
                        className={
                          faviconPreviewLoading
                            ? 'size-full rounded-full object-cover opacity-0'
                            : 'size-full rounded-full object-cover'
                        }
                        key={faviconPreviewUrl}
                        onError={() => setFailedFaviconUrl(faviconPreviewUrl)}
                        onLoad={() => setLoadedFaviconUrl(faviconPreviewUrl)}
                        src={faviconPreviewUrl}
                      />
                    )}
                    {faviconPreviewLoading && (
                      <LoaderCircle className="absolute size-3 animate-spin text-muted-foreground" />
                    )}
                    {!faviconPreviewUrl && <Globe2 className="size-3 text-muted-foreground" />}
                    {faviconPreviewHasError && <CircleAlert className="size-3 text-destructive" />}
                  </span>
                </InputGroupAddon>
              </InputGroup>
              <p
                className={
                  faviconPreviewHasError
                    ? 'text-xs leading-5 text-destructive'
                    : 'text-xs leading-5 text-muted-foreground'
                }
              >
                {!faviconPreviewUrl
                  ? '输入 URL 模板后会自动推导 favicon 地址，也可以手动修改。'
                  : !isPreviewableFaviconUrl
                    ? '请输入有效的 HTTP 或 HTTPS 地址。'
                    : faviconPreviewFailed
                      ? '无法加载该图标，请检查 favicon URL。'
                      : faviconPreviewLoading
                        ? '正在加载图标…'
                        : '图标可加载'}
              </p>
            </div>
          </div>
          {addOnlineDictionary.isError && (
            <p className="text-sm text-destructive">
              保存失败：{addOnlineDictionary.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              disabled={addOnlineDictionary.isPending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={
                !editor.name.trim() || !editor.urlTemplate.trim() || addOnlineDictionary.isPending
              }
              type="submit"
            >
              {addOnlineDictionary.isPending ? '正在保存…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function inferFaviconUrl(urlTemplate: string): string | null {
  try {
    const url = new URL(fillDictionaryUrlTemplate(urlTemplate, 'term'))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.origin}/favicon.ico`
  } catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
