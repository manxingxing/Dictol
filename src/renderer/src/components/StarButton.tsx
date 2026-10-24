import { LoaderCircle, Star } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useIsStarred, useToggleStar } from '@/hooks/use-wordbooks'

interface StarButtonProps {
  word: string | undefined
}

export function StarButton({ word }: StarButtonProps): React.JSX.Element {
  const toggleStar = useToggleStar()
  const isStarred = useIsStarred(word)

  const handleToggleStar = (): void => {
    if (!word) return
    toggleStar.mutate(word, {
      onError: (error) => {
        toast.error('操作失败', { description: error.message })
      }
    })
  }

  return (
    <Button
      aria-label={isStarred.data ? '取消标星' : '加入默认生词本'}
      className="search-action-button size-7 shrink-0 rounded-lg"
      disabled={toggleStar.isPending}
      onClick={handleToggleStar}
      size="icon"
      title={isStarred.data ? '取消标星' : '加入默认生词本'}
      type="button"
      variant="ghost"
    >
      {toggleStar.isPending ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <Star className={isStarred.data ? 'fill-amber-400 text-amber-400' : ''} />
      )}
    </Button>
  )
}
