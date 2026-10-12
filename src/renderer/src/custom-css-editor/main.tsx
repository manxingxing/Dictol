import '@/assets/main.css'
import './custom-css-editor.css'

import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import CustomCssEditorApp from './CustomCssEditorApp'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CustomCssEditorApp />
    </QueryClientProvider>
  </StrictMode>
)
