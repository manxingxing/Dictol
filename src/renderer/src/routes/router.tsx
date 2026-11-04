import { createHashRouter, Navigate } from 'react-router-dom'

import { AppErrorFallback } from '@/components/AppErrorBoundary'
import { AppLayout } from '@/layouts/AppLayout'
import { OnlineDictionariesList } from '@/components/OnlineDictionariesList'
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
import { AboutPage } from '@/pages/settings/AboutPage'
import { AiLookupSettingsPage } from '@/pages/settings/AiLookupSettingsPage'
import { AppearanceSettingsPage } from '@/pages/settings/AppearanceSettingsPage'
import { KeyboardSettingsPage } from '@/pages/settings/KeyboardSettingsPage'
import { TranslationSettingsPage } from '@/pages/settings/TranslationSettingsPage'
import { TtsSettingsPage } from '@/pages/settings/TtsSettingsPage'
import { WordCaptureSettingsPage } from '@/pages/settings/WordCaptureSettingsPage'

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
          { path: 'appearance', element: <AppearanceSettingsPage /> },
          { path: 'capture', element: <WordCaptureSettingsPage /> },
          { path: 'translation', element: <TranslationSettingsPage /> },
          { path: 'ai', element: <AiLookupSettingsPage /> },
          { path: 'tts', element: <TtsSettingsPage /> },
          { path: 'keyboard', element: <KeyboardSettingsPage /> },
          { path: 'about', element: <AboutPage /> }
        ]
      },
      { path: 'translation', element: <TranslationPage /> }
    ]
  }
])
