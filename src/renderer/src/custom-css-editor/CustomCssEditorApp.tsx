import {
  AlertCircle,
  CheckCircle2,
  Code2,
  LoaderCircle,
  Moon,
  Save,
  Search,
  Sun
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParam } from 'react-use'

import type { CustomCssEditorDictionary } from '../../../shared/custom-css-editor'
import CssCodeEditor from '@/components/CssCodeEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGetDictionary, useSaveCss, useSearchEntry } from './use-custom-css-editor'

export default function CustomCssEditorApp(): React.JSX.Element {
  const dictionaryId = useSearchParam('dictionaryId')
  const { data: dictionary, error: dictionaryError } = useGetDictionary(dictionaryId)

  if (!dictionaryId || !dictionary) {
    const loadError = !dictionaryId ? '缺少词典 ID' : dictionaryError?.message
    return (
      <main className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {loadError ? (
          <span role="alert">{loadError}</span>
        ) : (
          <>
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载词典预览…
          </>
        )}
      </main>
    )
  }

  return (
    <CustomCssEditorWorkspace
      key={dictionaryId}
      dictionary={dictionary}
      dictionaryId={dictionaryId}
    />
  )
}

function CustomCssEditorWorkspace({
  dictionary,
  dictionaryId
}: {
  dictionary: CustomCssEditorDictionary
  dictionaryId: string
}): React.JSX.Element {
  const previewSlotRef = useRef<HTMLDivElement | null>(null)
  const [initialCss] = useState(() => dictionary.customCss)
  const [css, setCss] = useState(initialCss)
  const [entryWord, setEntryWord] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  const saveCss = useSaveCss(dictionaryId)
  const searchEntry = useSearchEntry(dictionaryId)
  const saving = saveCss.isPending
  const changingEntry = searchEntry.isPending

  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.dictolCustomCssEditor.previewCss(initialCss)
  }, [initialCss])

  useEffect(() => {
    return window.dictolCustomCssEditor.onEntryWord((word) => {
      setEntryWord(word)
      setError(null)
    })
  }, [])

  useEffect(() => {
    return window.dictolCustomCssEditor.onPreviewReady((ready) => {
      setPreviewLoading(!ready)
    })
  }, [])

  useLayoutEffect(() => {
    const slot = previewSlotRef.current
    if (!slot) return

    const updateBounds = (): void => {
      const bounds = slot.getBoundingClientRect()
      window.dictolCustomCssEditor.setPreviewBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      })
    }
    const observer = new ResizeObserver(updateBounds)
    observer.observe(slot)
    updateBounds()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    window.dictolCustomCssEditor.setPreviewTheme(theme)
  }, [theme])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dictolCustomCssEditor.previewCss(css)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [css])

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!entryWord.trim() || saving || changingEntry) return

    setError(null)
    searchEntry.mutate(entryWord.trim(), {
      onSuccess: (result) => {
        if (!result.ok) {
          if (!result.cancelled) setError(result.message)
          return
        }
        setEntryWord(result.word)
      },
      onError: (searchError) => {
        setError(searchError instanceof Error ? searchError.message : '搜索词条失败')
      }
    })
  }

  const handleSaveClick = (): void => {
    setError(null)
    setSaveSuccess(false)
    saveCss.mutate(css, {
      onSuccess: () => setSaveSuccess(true),
      onError: (saveError) => {
        setError(saveError instanceof Error ? saveError.message : '保存 CSS 失败')
      }
    })
  }

  return (
    <main className="custom-css-editor-shell">
      <div className="custom-css-editor-info">
        <h1 className="custom-css-editor-dictionary-name">{dictionary.dictionaryName}</h1>
        {error && (
          <p className="custom-css-editor-error" role="alert">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        {!error && saveSuccess && (
          <p aria-live="polite" className="custom-css-editor-success" role="status">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
            <span>保存成功</span>
          </p>
        )}
      </div>
      <div className="custom-css-editor-toolbar">
        <div className="flex shrink-0 items-center gap-2">
          <form className="isolate flex items-center" onSubmit={handleSearchSubmit}>
            <Input
              aria-label="搜索当前词典的词条"
              className="relative h-8 w-36 rounded-r-none focus-visible:z-10"
              disabled={saving || changingEntry}
              onChange={(event) => setEntryWord(event.target.value)}
              placeholder="输入词条…"
              value={entryWord}
            />
            <Button
              aria-label="搜索词条"
              className="relative -ml-px rounded-l-none px-2 focus-visible:z-10"
              disabled={!entryWord.trim() || saving || changingEntry}
              size="sm"
              type="submit"
              title="搜索词条"
              variant="outline"
            >
              <Search aria-hidden="true" className="size-4" />
            </Button>
          </form>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Tabs
            aria-label="预览主题"
            className="shrink-0"
            onValueChange={(value) => {
              if (value === 'light' || value === 'dark') setTheme(value)
            }}
            value={theme}
          >
            <TabsList className="h-8 gap-0.5 rounded-md p-0.5">
              <TabsTrigger className="h-7 gap-1 rounded px-2 text-xs" value="light">
                <Sun aria-hidden="true" className="size-4" />
                浅色
              </TabsTrigger>
              <TabsTrigger className="h-7 gap-1 rounded px-2 text-xs" value="dark">
                <Moon aria-hidden="true" className="size-4" />
                深色
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            aria-label="打开 Chrome 开发者工具"
            onClick={() => window.dictolCustomCssEditor.openDevTools()}
            size="sm"
            title="在窗口下方打开 Chrome 开发者工具"
            type="button"
            variant="outline"
          >
            <Code2 />
            开发者工具
          </Button>
          <Button disabled={saving} onClick={handleSaveClick} size="sm" type="button">
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {saving ? '保存中…' : '保存 CSS'}
          </Button>
        </div>
      </div>

      <ResizablePanelGroup className="custom-css-editor-workspace" orientation="horizontal">
        <ResizablePanel id="dictionary-preview" defaultSize="60%" minSize="20%">
          <div ref={previewSlotRef} className="custom-css-editor-preview-slot">
            {previewLoading && (
              <div aria-live="polite" className="custom-css-editor-preview-loading" role="status">
                <LoaderCircle className="size-4 animate-spin" />
                <span>正在加载词条预览…</span>
              </div>
            )}
            <div className="custom-css-editor-preview-label">
              {previewLoading
                ? '词条预览'
                : entryWord
                  ? `词条预览 · ${entryWord}`
                  : '输入词条后预览'}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="css-editor" defaultSize="40%" minSize="20%">
          <section className="custom-css-editor-panel">
            <div className="custom-css-editor-content">
              <div className="mb-2 flex items-center justify-between gap-4">
                <label className="text-sm font-medium" htmlFor="custom-css-editor-content">
                  CSS 内容
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {css.length} / 200,000
                </span>
              </div>
              <CssCodeEditor
                ariaLabel="CSS 内容"
                autoFocus
                className="custom-css-editor-code"
                id="custom-css-editor-content"
                maxLength={200_000}
                onChange={(value) => {
                  setCss(value)
                  setError(null)
                  setSaveSuccess(false)
                }}
                placeholder={'.entry {\n  color: #e5e7eb;\n}'}
                value={css}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                CSS 会注入“{dictionary.dictionaryName}”的每个词条页面，并覆盖词典原有样式。
              </p>
            </div>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  )
}
