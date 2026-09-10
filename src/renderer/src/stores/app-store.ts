import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DictionaryLayout } from '../../../shared/dictionary-layout'

export const COMPACT_MODE_WIDTH_THRESHOLD = 768
export const RIGHT_SIDEBAR_DEFAULT_SIZE = '25'
export const RIGHT_SIDEBAR_MAX_SIZE = '50'
export const APP_PREFERENCES_STORAGE_KEY = 'dictol:app-preferences'

export type ChromeTone = 'neutral' | 'moss'
export type RightSidebarType = 'ai-search' | 'embed-browser'
type ResizablePanelSize = number | string | undefined

interface AppState {
  dictionaryLayout: DictionaryLayout | null
  setDictionaryLayout: (layout: DictionaryLayout) => void
  chromeTone: ChromeTone
  setChromeTone: (tone: ChromeTone) => void
  compactModeEnabled: boolean
  toggleCompactMode: () => void
  setCompactMode: (compactMode: boolean) => void
  rightSidebarOpen: boolean
  toggleRightSidebar: () => void
  setRightSidebarOpen: (open: boolean) => void
  rightSidebarType: RightSidebarType
  setRightSidebarType: (type: RightSidebarType) => void
  searchPanelSize: number | undefined
  setSearchPanelSize: (size: number | undefined) => void
  rightSidebarSize: ResizablePanelSize
  setRightSidebarSize: (size: ResizablePanelSize) => void
  rightSidebarMaximized: boolean
  setRightSidebarMaximized: (maximized: boolean) => void
  rightSidebarResizeRequest: number
  toggleRightSidebarSize: () => void
  embedBrowserUrl: string
  setEmbedBrowserUrl: (url: string) => void
  embedBrowserSearchTerm: string
  setEmbedBrowserSearchTerm: (term: string) => void
  aiSearchTerm: string
  setAiSearchTerm: (term: string) => void
  windowBelowCompactThreshold: boolean
  setWindowBelowCompactThreshold: (belowThreshold: boolean) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  lastQueryPath: string | undefined
  setLastQueryPath: (query: string | undefined) => void
}

export const selectCompactMode = (state: AppState): boolean =>
  state.compactModeEnabled || state.windowBelowCompactThreshold

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      dictionaryLayout: null,
      setDictionaryLayout: (dictionaryLayout) => set({ dictionaryLayout }),
      chromeTone: 'neutral',
      setChromeTone: (chromeTone) => set({ chromeTone }),
      compactModeEnabled: false,
      toggleCompactMode: () => set((state) => ({ compactModeEnabled: !state.compactModeEnabled })),
      setCompactMode: (compactModeEnabled) => set({ compactModeEnabled }),
      rightSidebarOpen: false,
      toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setRightSidebarOpen: (rightSidebarOpen) => set({ rightSidebarOpen }),
      rightSidebarType: 'ai-search',
      setRightSidebarType: (rightSidebarType) => set({ rightSidebarType }),
      searchPanelSize: undefined,
      setSearchPanelSize: (searchPanelSize) => set({ searchPanelSize }),
      rightSidebarSize: undefined,
      setRightSidebarSize: (rightSidebarSize) =>
        set((state) => ({
          rightSidebarSize,
          rightSidebarMaximized:
            rightSidebarSize !== undefined &&
            Number(rightSidebarSize) >= Number(RIGHT_SIDEBAR_MAX_SIZE) - 0.5,
          rightSidebarResizeRequest:
            typeof rightSidebarSize === 'string'
              ? state.rightSidebarResizeRequest + 1
              : state.rightSidebarResizeRequest
        })),
      rightSidebarMaximized: false,
      setRightSidebarMaximized: (rightSidebarMaximized) => set({ rightSidebarMaximized }),
      rightSidebarResizeRequest: 0,
      toggleRightSidebarSize: () =>
        set((state) => ({
          rightSidebarMaximized: !state.rightSidebarMaximized,
          rightSidebarSize: state.rightSidebarMaximized
            ? RIGHT_SIDEBAR_DEFAULT_SIZE
            : RIGHT_SIDEBAR_MAX_SIZE,
          rightSidebarResizeRequest: state.rightSidebarResizeRequest + 1
        })),
      embedBrowserUrl: '',
      setEmbedBrowserUrl: (embedBrowserUrl) => set({ embedBrowserUrl }),
      embedBrowserSearchTerm: '',
      setEmbedBrowserSearchTerm: (embedBrowserSearchTerm) => set({ embedBrowserSearchTerm }),
      windowBelowCompactThreshold:
        typeof window !== 'undefined' && window.innerWidth < COMPACT_MODE_WIDTH_THRESHOLD,
      setWindowBelowCompactThreshold: (windowBelowCompactThreshold) =>
        set({ windowBelowCompactThreshold }),
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      aiSearchTerm: '',
      setAiSearchTerm: (aiSearchTerm) => set({ aiSearchTerm }),
      lastQueryPath: '',
      setLastQueryPath: (lastQueryPath) => set({ lastQueryPath })
    }),
    {
      name: APP_PREFERENCES_STORAGE_KEY,
      partialize: (state) => ({
        chromeTone: state.chromeTone,
        compactModeEnabled: state.compactModeEnabled
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<AppState>),
        dictionaryLayout: null
      })
    }
  )
)
