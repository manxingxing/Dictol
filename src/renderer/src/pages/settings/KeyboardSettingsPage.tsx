import { useEffect } from 'react'

import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { ShortcutSettingControl } from '@/components/settings/ShortcutSettingControl'
import {
  useKeyboardShortcutStatus,
  useUpdateMainWindowShortcut
} from '@/hooks/use-keyboard-shortcuts'
import {
  useSelectionTranslationShortcutStatus,
  useScreenshotTranslationStatus,
  useUpdateScreenshotShortcut,
  useUpdateSelectionTranslationShortcut
} from '@/hooks/use-translation-shortcuts'
import {
  useUpdateOcrShortcut,
  useUpdateWordCaptureShortcut,
  useWordCaptureStatus
} from '@/hooks/use-word-capture-shortcuts'
import { formatShortcut } from '@/lib/keyboard-shortcut'
import { useAppStore } from '@/stores/app-store'
import {
  SCREENSHOT_TRANSLATION_SHORTCUT,
  TRANSLATE_SELECTION_SHORTCUT
} from '../../../../shared/shortcuts'

export function KeyboardSettingsPage(): React.JSX.Element {
  const dictionaryLayout = useAppStore((state) => state.dictionaryLayout)
  const keyboardStatusQuery = useKeyboardShortcutStatus()
  const status = keyboardStatusQuery.data
  const captureStatusQuery = useWordCaptureStatus()
  const captureStatus = captureStatusQuery.data
  const updateMainShortcutMutation = useUpdateMainWindowShortcut()
  const updateCaptureShortcutMutation = useUpdateWordCaptureShortcut()
  const updateOcrShortcutMutation = useUpdateOcrShortcut()
  const selectionShortcutStatusQuery = useSelectionTranslationShortcutStatus()
  const selectionShortcutStatus = selectionShortcutStatusQuery.data
  const screenshotStatusQuery = useScreenshotTranslationStatus()
  const screenshotStatus = screenshotStatusQuery.data
  const updateSelectionShortcutMutation = useUpdateSelectionTranslationShortcut()
  const updateScreenshotShortcutMutation = useUpdateScreenshotShortcut()
  const resetSelectionShortcutMutation = updateSelectionShortcutMutation.reset
  const resetScreenshotShortcutMutation = updateScreenshotShortcutMutation.reset
  const shortcutError =
    updateMainShortcutMutation.error?.message ??
    (updateMainShortcutMutation.data?.ok === false
      ? (updateMainShortcutMutation.data.error ?? '无法更新快捷键设置。')
      : null)
  const captureShortcutError =
    updateCaptureShortcutMutation.error?.message ??
    (updateCaptureShortcutMutation.data?.ok === false
      ? (updateCaptureShortcutMutation.data.error ?? '无法更新快捷键设置。')
      : null)
  const ocrShortcutError =
    updateOcrShortcutMutation.error?.message ??
    (updateOcrShortcutMutation.data?.ok === false
      ? (updateOcrShortcutMutation.data.error ?? '无法更新悬停取词快捷键。')
      : null)
  const selectionShortcutMessage =
    updateSelectionShortcutMutation.error?.message ??
    (updateSelectionShortcutMutation.data?.ok === false
      ? (updateSelectionShortcutMutation.data.error ?? '无法保存选区翻译快捷键设置。')
      : null) ??
    selectionShortcutStatusQuery.error?.message
  const screenshotStatusMessage =
    updateScreenshotShortcutMutation.error?.message ??
    (updateScreenshotShortcutMutation.data?.ok === false
      ? (updateScreenshotShortcutMutation.data.error ?? '无法保存截图翻译设置。')
      : null) ??
    screenshotStatusQuery.error?.message ??
    (screenshotStatus?.supported && screenshotStatus.shortcut && !screenshotStatus.registered
      ? `截图翻译快捷键 ${formatShortcut(screenshotStatus.shortcut, window.dictol.platform)} 注册失败，可能已被系统或其他应用占用。请更换快捷键。`
      : null)

  useEffect(() => {
    if (selectionShortcutStatusQuery.dataUpdatedAt) resetSelectionShortcutMutation()
  }, [selectionShortcutStatusQuery.dataUpdatedAt, resetSelectionShortcutMutation])

  useEffect(() => {
    if (screenshotStatusQuery.dataUpdatedAt) resetScreenshotShortcutMutation()
  }, [screenshotStatusQuery.dataUpdatedAt, resetScreenshotShortcutMutation])

  const updateShortcut = async (shortcut: string): Promise<void> => {
    await updateMainShortcutMutation.mutateAsync(shortcut)
  }

  const updateCaptureShortcut = async (shortcut: string): Promise<void> => {
    await updateCaptureShortcutMutation.mutateAsync(shortcut)
  }

  const updateOcrShortcut = async (mode: 'dictionary' | 'ai', shortcut: string): Promise<void> => {
    await updateOcrShortcutMutation.mutateAsync({ mode, shortcut })
  }

  const updateSelectionShortcut = async (shortcut: string): Promise<void> => {
    await updateSelectionShortcutMutation.mutateAsync(shortcut)
  }

  const updateScreenshotShortcut = async (shortcut: string): Promise<void> => {
    await updateScreenshotShortcutMutation.mutateAsync(shortcut)
  }

  return (
    <SettingsSection title="键盘">
      <SettingsList>
        {status ? (
          <SettingsRow
            label="唤起 Dictol"
            description={
              status.shortcut && !status.registered ? '快捷键被其他应用占用，请重新设置' : ''
            }
          >
            <ShortcutSettingControl
              allowClear
              command="showMainWindow"
              currentShortcut={status.shortcut}
              onClear={() => updateShortcut('')}
              onUpdate={updateShortcut}
            />
          </SettingsRow>
        ) : (
          <div
            className={`px-4 py-5 text-sm ${keyboardStatusQuery.isError ? 'text-destructive' : 'text-muted-foreground'}`}
            role={keyboardStatusQuery.isError ? 'alert' : undefined}
          >
            {keyboardStatusQuery.isError
              ? keyboardStatusQuery.error.message
              : '正在读取快捷键设置…'}
          </div>
        )}
        {shortcutError && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {shortcutError}
          </p>
        )}
        {captureStatusQuery.isError && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {captureStatusQuery.error.message}
          </p>
        )}
        {captureStatus?.supported && (
          <SettingsRow
            label="划词取词"
            description={
              !captureStatus.shortcut
                ? '未设置快捷键'
                : captureStatus.registered
                  ? '在弹窗中查看所选单词的词典解释'
                  : '快捷键被其他应用占用，请重新设置'
            }
          >
            <ShortcutSettingControl
              allowClear
              command="lookupWordOnShortcut"
              currentShortcut={captureStatus.shortcut}
              onClear={() => updateCaptureShortcut('')}
              onUpdate={updateCaptureShortcut}
            />
          </SettingsRow>
        )}
        {captureShortcutError && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {captureShortcutError}
          </p>
        )}
        {captureStatus?.supported && captureStatus.ocrSupported && captureStatus.ocrEnabled && (
          <>
            <SettingsRow
              label="悬停查词"
              description={
                captureStatus.ocrDictionaryRegistered
                  ? '在屏幕文字上按快捷键，在弹窗中查看词典解释'
                  : '快捷键被占用，请重新设置'
              }
            >
              <ShortcutSettingControl
                command="ocrDictionary"
                currentShortcut={captureStatus.ocrDictionaryShortcut}
                onUpdate={(shortcut) => updateOcrShortcut('dictionary', shortcut)}
              />
            </SettingsRow>
            <SettingsRow
              label="AI 语境查词"
              description={
                captureStatus.ocrAiRegistered
                  ? '在屏幕文字上按快捷键，调用大模型解释单词在语境中的含义'
                  : '快捷键被占用，请重新设置'
              }
            >
              <ShortcutSettingControl
                command="ocrAi"
                currentShortcut={captureStatus.ocrAiShortcut}
                onUpdate={(shortcut) => updateOcrShortcut('ai', shortcut)}
              />
            </SettingsRow>
            {ocrShortcutError && (
              <p
                className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
                role="alert"
              >
                {ocrShortcutError}
              </p>
            )}
          </>
        )}
        {selectionShortcutStatus?.supported && (
          <SettingsRow
            label="划词翻译"
            description={
              !selectionShortcutStatus.shortcut
                ? '未设置快捷键'
                : selectionShortcutStatus.registered
                  ? '在翻译弹窗里查看所选文本的译文'
                  : '快捷键未启用，请重新设置'
            }
          >
            <ShortcutSettingControl
              allowClear
              command={TRANSLATE_SELECTION_SHORTCUT}
              currentShortcut={selectionShortcutStatus.shortcut}
              onClear={() => updateSelectionShortcut('')}
              onUpdate={updateSelectionShortcut}
            />
          </SettingsRow>
        )}
        {selectionShortcutMessage && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {selectionShortcutMessage}
          </p>
        )}
        {screenshotStatus?.supported && (
          <SettingsRow
            label="截图翻译"
            description={
              !screenshotStatus.shortcut
                ? '未设置快捷键'
                : screenshotStatus.registered
                  ? '识别截图中的文本，在翻译弹窗里查看译文'
                  : '按快捷键框选屏幕文字，识别后查看译文'
            }
          >
            <ShortcutSettingControl
              allowClear
              command={SCREENSHOT_TRANSLATION_SHORTCUT}
              currentShortcut={screenshotStatus.shortcut}
              onClear={() => updateScreenshotShortcut('')}
              onUpdate={updateScreenshotShortcut}
            />
          </SettingsRow>
        )}
        {screenshotStatusMessage && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {screenshotStatusMessage}
          </p>
        )}
        <SettingsRow label="搜索词条" description="聚焦查词搜索框">
          <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
            {formatShortcut('CommandOrControl+K', window.dictol.platform)}
          </kbd>
        </SettingsRow>
        <SettingsRow label="页面内查找" description="在当前词条内容中查找">
          <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
            {formatShortcut('CommandOrControl+F', window.dictol.platform)}
          </kbd>
        </SettingsRow>
        {dictionaryLayout === 'single' && (
          <>
            <SettingsRow label="上一个词典" description="在查词结果中切换到上一个词典">
              <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                {formatShortcut('CommandOrControl+Left', window.dictol.platform)}
              </kbd>
            </SettingsRow>
            <SettingsRow label="下一个词典" description="在查词结果中切换到下一个词典">
              <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                {formatShortcut('CommandOrControl+Right', window.dictol.platform)}
              </kbd>
            </SettingsRow>
          </>
        )}
      </SettingsList>
    </SettingsSection>
  )
}
