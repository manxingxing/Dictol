import { BookOpen, LoaderCircle, NotebookPen } from 'lucide-react'

import { DictionaryNoteComposer } from '@/components/dictionaryNote/DictionaryNoteComposer'
import { DictionaryNoteItem } from '@/components/dictionaryNote/DictionaryNoteItem'
import { useDictionaryNotes } from '@/hooks/use-dictionary-note'
import type { RightSidebarNotesTab } from '@/stores/app-store'
export function DictionaryNotesSidebar({
  active,
  tab
}: {
  active: boolean
  tab: RightSidebarNotesTab
}): React.JSX.Element {
  const notes = useDictionaryNotes(tab.term, active)

  return (
    <section
      aria-label={`笔记：${tab.term}`}
      className="absolute inset-0 flex min-h-0 flex-col bg-[var(--panel-background)]"
      id={`right-sidebar-panel-${tab.id}`}
      role="tabpanel"
      style={{ display: active ? 'flex' : 'none' }}
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3 pr-12">
        <div className="flex min-w-0 items-center gap-2">
          <NotebookPen className="size-4 text-primary" />
          <span className="truncate text-sm font-medium">{tab.term}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {notes.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            加载笔记…
          </div>
        ) : notes.isError ? (
          <div className="p-4 text-sm text-destructive">笔记加载失败，请重试。</div>
        ) : notes.data?.length ? (
          <div className="divide-y divide-border">
            {notes.data.map((note) => (
              <DictionaryNoteItem key={note.id} note={note} term={tab.term} />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-muted-foreground">
            <BookOpen className="mb-3 size-5" />
            <p className="font-medium text-foreground">还没有笔记或摘抄</p>
          </div>
        )}
      </div>
      <DictionaryNoteComposer term={tab.term} />
    </section>
  )
}
