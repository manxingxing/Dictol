import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { WindowTitleBar } from '@/components/WindowTitleBar'
import { Sidebar } from '@/components/Sidebar'
import { useWindowWidthThreshold } from '@/hooks/use-window-width-threshold'
import { useChromeTone } from '@/hooks/use-chrome-tone'
import { useAppStore } from '@/stores/app-store'

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const setDictionaryLayout = useAppStore((state) => state.setDictionaryLayout)

  useWindowWidthThreshold()
  useChromeTone()

  useEffect(() => {
    let active = true
    void window.dictol.app.getRunningDictionaryLayout().then((layout) => {
      if (active && layout) setDictionaryLayout(layout)
    })
    return () => {
      active = false
    }
  }, [setDictionaryLayout])

  useEffect(() => {
    return window.dictol.wordCapture.onEvent((event) => {
      if (event.type === 'permission-required') {
        toast.warning('需要开启辅助功能权限，才能读取其他软件中选中的文字。')
        void navigate('/settings')
        return
      }
      if (event.type === 'empty') {
        toast.info('没有检测到选中的文字，请先选择一个单词。')
        return
      }
      toast.error(event.message)
    })
  }, [navigate])

  // deeplink, 'open in main window from explanation window', 'goto word from dictionary browser'
  useEffect(() => {
    return window.dictol.app.onSearchRequest((request) => {
      console.log(`received search request ${request.term} in dictionary(#${request.dictionaryId}) from ${request.source}`)
      if (!request.term) return

      setSearchQuery(request.term)
      const params = new URLSearchParams()
      if (request.dictionaryId) {
        params.set('dictionaryId', request.dictionaryId)
        params.set('focusDictionaryId', request.dictionaryId)
      }
      const query = params.toString() ? `?${params}` : ''
      void navigate(`/search/${encodeURIComponent(request.term)}${query}`)
    })
  }, [navigate, setSearchQuery])

  return (
    <div className="relative flex h-screen min-h-0 flex-col text-foreground">
      <WindowTitleBar />

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        <Sidebar />

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
