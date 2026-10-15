import { useCallback } from 'react'
import { NotebookPen } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  useDictionaryNoteCount,
  useDictionaryNoteCreationResult
} from '@/hooks/use-dictionary-note'
import { useAppStore } from '@/stores/app-store'

export function DictionaryNotesButton({ term }: { term: string }): React.JSX.Element {
  const openDictionaryNotesTab = useAppStore((state) => state.openDictionaryNotesTab)
  const flashVersion = useAppStore((state) => state.dictionaryNotesButtonFlashVersion)
  const flashDictionaryNotesButton = useAppStore((state) => state.flashDictionaryNotesButton)
  const noteCount = useDictionaryNoteCount(term)
  const hasNotes = (noteCount.data ?? 0) > 0

  const isCurrentTerm = useCallback(
    (relatedTerms: string[]): boolean =>
      relatedTerms.some(
        (relatedTerm) => relatedTerm.toLocaleLowerCase() === term.toLocaleLowerCase()
      ),
    [term]
  )

  const onNoteCreated = useCallback(
    (relatedTerms: string[]): void => {
      if (!isCurrentTerm(relatedTerms)) return
      flashDictionaryNotesButton()
      toast.success('摘抄已保存')
    },
    [flashDictionaryNotesButton, isCurrentTerm]
  )
  const onNoteCreationFailed = useCallback(
    (relatedTerms: string[], message: string): void => {
      if (!isCurrentTerm(relatedTerms)) return
      toast.error(`保存摘抄失败：${message}`)
    },
    [isCurrentTerm]
  )
  useDictionaryNoteCreationResult(onNoteCreated, onNoteCreationFailed)

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
