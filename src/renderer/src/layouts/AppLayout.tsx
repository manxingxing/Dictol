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
      if (event.type === 'lookup') {
        setSearchQuery(event.text)
        void navigate(`/search/${encodeURIComponent(event.text)}`)
        return
      }
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
  }, [navigate, setSearchQuery])

  useEffect(() => {
    return window.dictol.app.onDeepLink((intent) => {
      if (intent.type !== 'search') return
      setSearchQuery(intent.term)
      void navigate(`/search/${encodeURIComponent(intent.term)}`)
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
