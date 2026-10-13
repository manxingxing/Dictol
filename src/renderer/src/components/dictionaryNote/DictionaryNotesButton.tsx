import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NotebookPen } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { dictionaryNoteCountQueryKey, useDictionaryNoteCount } from '@/hooks/use-dictionary-note'
import { useAppStore } from '@/stores/app-store'

export function DictionaryNotesButton({ term }: { term: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const openDictionaryNotesTab = useAppStore((state) => state.openDictionaryNotesTab)
  const flashVersion = useAppStore((state) => state.dictionaryNotesButtonFlashVersion)
  const flashDictionaryNotesButton = useAppStore((state) => state.flashDictionaryNotesButton)
  const noteCount = useDictionaryNoteCount(term)
  const hasNotes = (noteCount.data ?? 0) > 0

  useEffect(() => {
    return window.dictol.dictionaryNotes.onCreationResult((result) => {
      if (result.status === 'success') {
        void queryClient.invalidateQueries({ queryKey: ['dictionary-notes'] })
        void queryClient.invalidateQueries({ queryKey: dictionaryNoteCountQueryKey(result.term) })
        flashDictionaryNotesButton()
        toast.success('摘抄已保存')
      } else {
        toast.error(`保存摘抄失败：${result.message}`)
      }
    })
  }, [flashDictionaryNotesButton, queryClient])

  return (
    <Button
      aria-label={`打开 ${term} 的单词笔记${hasNotes ? '（有笔记或摘抄）' : ''}`}
      className="search-action-button size-7 shrink-0 rounded-lg"
      data-dictionary-notes-button
      onClick={() => openDictionaryNotesTab(term)}
      size="icon"
      title="笔记和摘抄"
      type="button"
      variant="ghost"
    >
      <NotebookPen
        className={[hasNotes && 'text-amber-400', flashVersion && 'dictionary-notes-button-flash']
          .filter(Boolean)
          .join(' ')}
        key={flashVersion}
      />
    </Button>
  )
}
