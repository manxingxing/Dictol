import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DictionaryLayout } from '../../../shared/dictionary-layout'
import type { DictionaryDisplay } from '../../../shared/dictionary-display'

export const COMPACT_MODE_WIDTH_THRESHOLD = 768
export const RIGHT_SIDEBAR_DEFAULT_SIZE = '25'
export const RIGHT_SIDEBAR_MAX_SIZE = '50'
export const APP_PREFERENCES_STORAGE_KEY = 'dictol:app-preferences'

export type ChromeTone = 'neutral' | 'moss'
export type RightSidebarTab = RightSidebarAiTab | RightSidebarOnlineTab
export type RightSidebarAiTab = {
  id: string
  kind: 'ai'
  title: string
  initialTerm: string
  term: string
  followUpPrompt: string
  followUpVersion: number
}
export type RightSidebarOnlineTab = {
  id: string
  kind: 'online'
  title: string
  dictionaryId: string
  faviconUrl: string
  urlTemplate: string
  url: string
  currentUrl: string
  searchTerm: string
  navigationVersion: number
}
type ResizablePanelSize = number | string | undefined

interface AppState {
  dictionaryLayout: DictionaryLayout | null
  setDictionaryLayout: (layout: DictionaryLayout) => void
  dictionaryDisplay: DictionaryDisplay | null
  setDictionaryDisplay: (display: DictionaryDisplay) => void
  chromeTone: ChromeTone
  setChromeTone: (tone: ChromeTone) => void
  compactModeEnabled: boolean
  toggleCompactMode: () => void
  setCompactMode: (compactMode: boolean) => void
  rightSidebarOpen: boolean
  toggleRightSidebar: () => void
  setRightSidebarOpen: (open: boolean) => void
  rightSidebarTabs: RightSidebarTab[]
  activeRightSidebarTabId: string | null
  followRightSidebarSearch: boolean
  openOnlineDictionaryTab: (
    dictionary: { id: string | number; name: string; faviconUrl: string; urlTemplate: string },
    term: string
  ) => void
  openAiLookupTab: (term: string) => void
  activateRightSidebarTab: (id: string) => void
  closeRightSidebarTab: (id: string) => void
  navigateOnlineDictionaryTab: (id: string, url: string, searchTerm: string) => void
  updateOnlineDictionaryTabUrl: (id: string, currentUrl: string) => void
  setFollowRightSidebarSearch: (follow: boolean) => void
  followSearchInRightSidebarTabs: (term: string) => void
  searchPanelSize: number | undefined
  setSearchPanelSize: (size: number | undefined) => void
  rightSidebarSize: ResizablePanelSize
  setRightSidebarSize: (size: ResizablePanelSize) => void
  rightSidebarMaximized: boolean
  setRightSidebarMaximized: (maximized: boolean) => void
  rightSidebarResizeRequest: number
  toggleRightSidebarSize: () => void
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
      dictionaryDisplay: null,
      setDictionaryDisplay: (dictionaryDisplay) => set({ dictionaryDisplay }),
      chromeTone: 'neutral',
      setChromeTone: (chromeTone) => set({ chromeTone }),
      compactModeEnabled: false,
      toggleCompactMode: () => set((state) => ({ compactModeEnabled: !state.compactModeEnabled })),
      setCompactMode: (compactModeEnabled) => set({ compactModeEnabled }),
      rightSidebarOpen: false,
      toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setRightSidebarOpen: (rightSidebarOpen) => set({ rightSidebarOpen }),
      rightSidebarTabs: [],
      activeRightSidebarTabId: null,
      followRightSidebarSearch: false,
      openOnlineDictionaryTab: (dictionary, term) => {
        const normalizedTerm = term.trim()
        const tabId = `tab-${crypto.randomUUID()}`
        const url = fillDictionaryUrlTemplate(dictionary.urlTemplate, normalizedTerm)
        set((state) => {
          const existing = state.rightSidebarTabs.find(
            (tab): tab is RightSidebarOnlineTab =>
              tab.kind === 'online' && tab.dictionaryId === String(dictionary.id)
          )
          const tabs = existing
            ? state.rightSidebarTabs.map((tab) =>
                tab.id === existing.id
                  ? {
                      ...existing,
                      title: dictionary.name,
                      faviconUrl: dictionary.faviconUrl,
                      urlTemplate: dictionary.urlTemplate,
                      url,
                      currentUrl: url,
                      searchTerm: normalizedTerm,
                      navigationVersion: existing.navigationVersion + 1
                    }
                  : tab
              )
            : [
                ...state.rightSidebarTabs,
                {
                  id: tabId,
                  kind: 'online' as const,
                  title: dictionary.name,
                  dictionaryId: String(dictionary.id),
                  faviconUrl: dictionary.faviconUrl,
                  urlTemplate: dictionary.urlTemplate,
                  url,
                  currentUrl: url,
                  searchTerm: normalizedTerm,
                  navigationVersion: 0
                }
              ]
          const activeId = existing?.id ?? tabId
          return {
            rightSidebarTabs: tabs,
            activeRightSidebarTabId: activeId,
            rightSidebarOpen: true
          }
        })
      },
      openAiLookupTab: (term) => {
        const normalizedTerm = term.trim()
        if (!normalizedTerm) return
        set((state) => {
          const existing = state.rightSidebarTabs.find(
            (tab): tab is RightSidebarAiTab => tab.kind === 'ai'
          )
          const tab: RightSidebarAiTab = existing
            ? {
                ...existing,
                title: normalizedTerm,
                term: normalizedTerm,
                followUpPrompt: normalizedTerm,
                followUpVersion: existing.followUpVersion + 1
              }
            : {
                id: `tab-${crypto.randomUUID()}`,
                kind: 'ai',
                title: normalizedTerm,
                initialTerm: normalizedTerm,
                term: normalizedTerm,
                followUpPrompt: '',
                followUpVersion: 0
              }
          return {
            rightSidebarTabs: existing
              ? state.rightSidebarTabs.map((currentTab) =>
                  currentTab.id === existing.id ? tab : currentTab
                )
              : [...state.rightSidebarTabs, tab],
            activeRightSidebarTabId: tab.id,
            rightSidebarOpen: true
          }
        })
      },
      activateRightSidebarTab: (activeRightSidebarTabId) =>
        set({ activeRightSidebarTabId, rightSidebarOpen: true }),
      closeRightSidebarTab: (id) =>
        set((state) => {
          const index = state.rightSidebarTabs.findIndex((tab) => tab.id === id)
          if (index < 0) return state
          const tabs = state.rightSidebarTabs.filter((tab) => tab.id !== id)
          const activeRightSidebarTabId =
            state.activeRightSidebarTabId === id
              ? ((tabs[index - 1] ?? tabs[index])?.id ?? null)
              : state.activeRightSidebarTabId
          return { rightSidebarTabs: tabs, activeRightSidebarTabId }
        }),
      navigateOnlineDictionaryTab: (id, url, searchTerm) =>
        set((state) => ({
          rightSidebarTabs: state.rightSidebarTabs.map((tab) =>
            tab.id === id && tab.kind === 'online'
              ? {
                  ...tab,
                  url,
                  currentUrl: url,
                  searchTerm,
                  urlTemplate: '',
                  navigationVersion: tab.navigationVersion + 1
                }
              : tab
          )
        })),
      updateOnlineDictionaryTabUrl: (id, currentUrl) =>
        set((state) => ({
          rightSidebarTabs: state.rightSidebarTabs.map((tab) =>
            tab.id === id && tab.kind === 'online' ? { ...tab, currentUrl } : tab
          )
        })),
      setFollowRightSidebarSearch: (followRightSidebarSearch) => set({ followRightSidebarSearch }),
      followSearchInRightSidebarTabs: (term) => {
        const normalizedTerm = term.trim()
        if (!normalizedTerm) return
        set((state) => ({
          rightSidebarTabs: state.rightSidebarTabs.map((tab) => {
            if (tab.kind === 'ai') {
              return tab.term === normalizedTerm
                ? tab
                : {
                    ...tab,
                    title: normalizedTerm,
                    term: normalizedTerm,
                    followUpPrompt: normalizedTerm,
                    followUpVersion: tab.followUpVersion + 1
                  }
            }
            if (tab.searchTerm === normalizedTerm) return tab
            const url = tab.urlTemplate
              ? fillDictionaryUrlTemplate(tab.urlTemplate, normalizedTerm)
              : replaceSearchTerm(tab.currentUrl || tab.url, tab.searchTerm, normalizedTerm)
            return {
              ...tab,
              url,
              currentUrl: url,
              searchTerm: normalizedTerm,
              navigationVersion: tab.navigationVersion + 1
            }
          })
        }))
      },
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
      windowBelowCompactThreshold:
        typeof window !== 'undefined' && window.innerWidth < COMPACT_MODE_WIDTH_THRESHOLD,
      setWindowBelowCompactThreshold: (windowBelowCompactThreshold) =>
        set({ windowBelowCompactThreshold }),
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
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
        dictionaryLayout: null,
        dictionaryDisplay: null
      })
    }
  )
)

function fillDictionaryUrlTemplate(template: string, term: string): string {
  return template.split('%s').join(encodeURIComponent(term))
}

function replaceSearchTerm(url: string, previousTerm: string, nextTerm: string): string {
  if (!previousTerm) return url
  const encodedPreviousTerm = encodeURIComponent(previousTerm)
  if (url.includes(encodedPreviousTerm)) {
    return url.split(encodedPreviousTerm).join(encodeURIComponent(nextTerm))
  }
  if (url.includes(previousTerm)) return url.split(previousTerm).join(nextTerm)
  return url
}
