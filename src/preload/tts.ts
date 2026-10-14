import { ipcRenderer } from 'electron'

import type { TtsConfig, TtsPlayback, TtsStateListener, TtsVoice } from '../shared/tts'

const MAX_TEXT_LENGTH = 200
const SUPPORTED_LANGUAGE_CODES = new Set(['zh', 'en', 'ja', 'ko', 'fr', 'de'])

function isSupportedSystemVoice(voice: SpeechSynthesisVoice): boolean {
  return (
    voice.localService && SUPPORTED_LANGUAGE_CODES.has(voice.lang.split(/[-_]/, 1)[0].toLowerCase())
  )
}

type TtsEngine = {
  speak: (text: string, config: TtsConfig, onStateChange: TtsStateListener) => () => void
}

const systemEngine: TtsEngine = {
  speak(text, config, onStateChange) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      throw new Error('当前系统不支持语音朗读。')
    }
    const synthesis = window.speechSynthesis
    let utterance: SpeechSynthesisUtterance | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let canceled = false
    const cleanup = (): void => {
      synthesis.removeEventListener('voiceschanged', onVoicesChanged)
      if (timer) clearTimeout(timer)
    }
    const start = (): boolean => {
      if (canceled) return true
      const voices = synthesis.getVoices().filter(isSupportedSystemVoice)
      if (voices.length === 0) return false
      cleanup()
      const voice = config.systemVoiceUri
        ? voices.find((item) => item.voiceURI === config.systemVoiceUri)
        : (voices.find((item) => item.default) ?? voices[0])
      if (!voice) throw new Error('选定的本机语音已不可用，请在设置中重新选择。')

      utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = voice
      utterance.lang = voice.lang
      utterance.onstart = () => onStateChange('playing')
      utterance.onend = () => onStateChange('completed')
      utterance.onerror = (event) => onStateChange('error', `本机朗读失败：${event.error}`)
      synthesis.speak(utterance)
      return true
    }
    const onVoicesChanged = (): void => {
      try {
        start()
      } catch (error) {
        onStateChange('error', error instanceof Error ? error.message : '本机朗读失败。')
      }
    }
    if (!start()) {
      synthesis.addEventListener('voiceschanged', onVoicesChanged)
      timer = setTimeout(() => {
        cleanup()
        onStateChange('error', '没有找到可用的本机语音。')
      }, 3_000)
    }
    return () => {
      canceled = true
      cleanup()
      if (utterance) synthesis.cancel()
    }
  }
}

const engines: Record<TtsConfig['engine'], TtsEngine> = { system: systemEngine }

export function createTtsPlayback(): TtsPlayback {
  let active: { cancel: () => void } | null = null

  window.addEventListener('pagehide', () => active?.cancel())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') active?.cancel()
  })

  return {
    speak(text, onStateChange) {
      active?.cancel()
      const value = typeof text === 'string' ? text.trim() : ''
      if (!value || value.length > MAX_TEXT_LENGTH) {
        onStateChange('error', '朗读文本须为 1–200 个字符。')
        return
      }

      let finished = false
      let stopEngine: (() => void) | undefined
      const notify: TtsStateListener = (state, message) => {
        if (finished) return
        if (state === 'completed' || state === 'aborted' || state === 'error') {
          finished = true
          if (active?.cancel === cancel) active = null
        }
        onStateChange(state, message)
      }
      const cancel = (): void => {
        if (finished) return
        notify('aborted')
        stopEngine?.()
      }
      active = { cancel }
      notify('waiting')

      void ipcRenderer
        .invoke('tts:get-config')
        .then((config: TtsConfig | null) => {
          if (finished) return
          if (!config) throw new Error('无法读取朗读设置。')
          stopEngine = engines[config.engine].speak(value, config, notify)
          if (finished) stopEngine()
        })
        .catch((error: unknown) => {
          notify('error', error instanceof Error ? error.message : '朗读失败。')
        })
    },
    stop() {
      active?.cancel()
    }
  }
}

export function getSystemTtsVoices(): TtsVoice[] {
  if (!('speechSynthesis' in window)) return []
  return window.speechSynthesis
    .getVoices()
    .filter(isSupportedSystemVoice)
    .map((voice) => ({
      uri: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      isDefault: voice.default
    }))
}

export function onSystemTtsVoicesChanged(callback: () => void): () => void {
  if (!('speechSynthesis' in window)) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', callback)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', callback)
}
