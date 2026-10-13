import { DictionaryNoteSearchHighlight } from '@/components/dictionaryNote/DictionaryNoteSearchHighlight'

export function DictionaryNoteExcerpt({
  text,
  relatedTerms,
  searchMatches = []
}: {
  text: string
  relatedTerms: string[]
  searchMatches?: string[]
}): React.JSX.Element {
  return (
    <DictionaryNoteSearchHighlight
      matches={searchMatches}
      relatedTerms={relatedTerms}
      text={text}
    />
  )
}
