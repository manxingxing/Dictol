import { createHashRouter, Navigate } from 'react-router-dom'

import { AppErrorFallback } from '@/components/AppErrorBoundary'
import { AppLayout } from '@/layouts/AppLayout'
import { DictionariesPage } from '@/pages/DictionariesPage'
import { DictionaryGroupsPage } from '@/pages/DictionaryGroupsPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { SearchPage } from '@/pages/SearchPage'
import { SearchResultPage } from '@/pages/SearchResultPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TranslationPage } from '@/pages/TranslationPage'
import { WordbooksPage } from '@/pages/WordbooksPage'
import { WordbookWords } from '@/pages/WordbookWords'

export const router = createHashRouter([
  {
    path: '/',
    errorElement: <AppErrorFallback />,
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/search" replace /> },
      {
        path: 'search',
        element: <SearchPage />,
        children: [
          { index: true, element: <SearchResultPage /> },
          { path: ':term', element: <SearchResultPage /> }
        ]
      },
      {
        path: 'dictionaries',
        children: [
          { index: true, element: <DictionariesPage /> },
          { path: 'groups', element: <DictionaryGroupsPage /> },
          { path: 'groups/:groupId', element: <DictionaryGroupsPage /> }
        ]
      },
      { path: 'history', element: <HistoryPage /> },
      {
        path: 'wordbooks',
        element: <WordbooksPage />,
        children: [
          { index: true, element: <WordbookWords /> },
          { path: ':wordbookId', element: <WordbookWords /> }
        ]
      },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'translation', element: <TranslationPage /> }
    ]
  }
])
