import { Globe2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/stores/app-store'

type OnlineDictionary = Awaited<ReturnType<Window['dictol']['onlineDictionaries']['list']>>[number]

interface OnlineDictionaryButtonProps {
  dictionary: OnlineDictionary
  searchTerm: string
  zIndex: number
}

export function OnlineDictionaryButton({
  dictionary,
  searchTerm,
  zIndex
}: OnlineDictionaryButtonProps): React.JSX.Element {
  const setEmbedBrowserUrl = useAppStore((state) => state.setEmbedBrowserUrl)
  const setEmbedBrowserSearchTerm = useAppStore((state) => state.setEmbedBrowserSearchTerm)
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen)
  const setRightSidebarType = useAppStore((state) => state.setRightSidebarType)

  const lookupInOnlineDictionary = (): void => {
    const url = dictionary.urlTemplate.split('%s').join(encodeURIComponent(searchTerm))
    setEmbedBrowserSearchTerm(searchTerm)
    setEmbedBrowserUrl(url)
    setRightSidebarType('embed-browser')
    setRightSidebarOpen(true)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={`使用 ${dictionary.name} 查询 ${searchTerm}`}
          className="dictionary-source-icon online-dictionary-icon relative size-7 rounded-full border-2 border-background bg-background p-0 transition-transform duration-150 ease-out hover:scale-115 focus-visible:scale-120"
          onClick={lookupInOnlineDictionary}
          size="icon"
          style={{ zIndex }}
          type="button"
          variant="ghost"
        >
          <img
            alt=""
            className="size-full rounded-full object-cover bg-white"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
              event.currentTarget.nextElementSibling?.classList.remove('hidden')
            }}
            src={dictionary.faviconUrl}
          />
          <Globe2 className="absolute hidden size-4 text-muted-foreground" />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" side="top">
        在 {dictionary.name} 中查询
      </TooltipContent>
    </Tooltip>
  )
}
