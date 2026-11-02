import { createHashRouter, Navigate } from 'react-router-dom'

import { AppErrorFallback } from '@/components/AppErrorBoundary'
import { AppLayout } from '@/layouts/AppLayout'
import { OnlineDictionariesList } from '@/components/OnlineDictionariesList'
import { AboutSettingsCard } from '@/components/AboutSettingsCard'
import { AiLookupSettingsCard } from '@/components/AiLookupSettingsCard'
import { AppearanceSettingsCard } from '@/components/AppearanceSettingsCard'
import { KeyboardSettingsCard } from '@/components/KeyboardSettingsCard'
import { StorageSettingsCard } from '@/components/StorageSettingsCard'
import { TranslationSettingsCard } from '@/components/TranslationSettingsCard'
import { TtsSettingsCard } from '@/components/TtsSettingsCard'
import { WordCaptureSettingsCard } from '@/components/WordCaptureSettingsCard'
import { DictionariesPage } from '@/pages/DictionariesPage'
import { DictionaryManagementLayout } from '@/pages/DictionaryManagementLayout'
import { DictionaryGroupsPage } from '@/pages/DictionaryGroupsPage'
import { ExcerptsPage } from '@/pages/ExcerptsPage'
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
          { index: true, element: <Navigate to="/dictionaries/local" replace /> },
          {
            element: <DictionaryManagementLayout />,
            children: [
              { path: 'local', element: <DictionariesPage /> },
              { path: 'online', element: <OnlineDictionariesList /> }
            ]
          },
          { path: 'groups', element: <DictionaryGroupsPage /> },
          { path: 'groups/:groupId', element: <DictionaryGroupsPage /> }
        ]
      },
      { path: 'history', element: <HistoryPage /> },
      { path: 'excerpts', element: <ExcerptsPage /> },
      {
        path: 'wordbooks',
        element: <WordbooksPage />,
        children: [
          { index: true, element: <WordbookWords /> },
          { path: ':wordbookId', element: <WordbookWords /> }
        ]
      },
      {
        path: 'settings',
        element: <SettingsPage />,
        children: [
          { index: true, element: <Navigate to="appearance" replace /> },
          { path: 'appearance', element: <AppearanceSettingsCard /> },
          { path: 'capture', element: <WordCaptureSettingsCard /> },
          { path: 'translation', element: <TranslationSettingsCard /> },
          { path: 'ai', element: <AiLookupSettingsCard /> },
          { path: 'tts', element: <TtsSettingsCard /> },
          { path: 'keyboard', element: <KeyboardSettingsCard /> },
          {
            path: 'about',
            element: (
              <>
                <AboutSettingsCard />
                <StorageSettingsCard />
              </>
            )
          }
        ]
      },
      { path: 'translation', element: <TranslationPage /> }
    ]
  }
])
