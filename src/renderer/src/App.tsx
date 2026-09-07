import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { useQueryHistoryChangeListener } from '@/hooks/use-query-history'
import { router } from '@/routes/router'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { Toaster } from './components/ui/sonner'

// Queries and mutations call local IPC APIs and must remain available offline.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' }
  }
})

function AppContent(): React.JSX.Element {
  useQueryHistoryChangeListener()
  useEffect(
    () =>
      window.dictol.notifications.onToast(({ type, message }) => {
        if (type === 'error') {
          toast.error(message)
        } else if (type === 'success') {
          toast.success(message)
        } else if (type === 'warning') {
          toast.warning(message)
        } else {
          toast.info(message)
        }
      }),
    []
  )
  return <RouterProvider router={router} />
}

function App(): React.JSX.Element {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Toaster position="top-center" />
        <AppContent />
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}

export default App
