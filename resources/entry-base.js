/* eslint-disable @typescript-eslint/explicit-function-return-type */
;(() => {
  // 一个原生的 toast 组件
  let toastTimer = null
  let toastEle = null
  const showShadowToast = (message) => {
    if (!toastEle) {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
      const shadowRoot = host.attachShadow({ mode: 'closed' })
      const style = document.createElement('style')
      style.textContent = `
        .notice {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(255, 255, 255, .94);
          color: #202020;
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 4px 14px rgba(0, 0, 0, .16);
          opacity: 0;
          transition: opacity .15s ease;
        }
        @media (prefers-color-scheme: dark) {
          .notice {
            background: rgba(32, 32, 32, .9);
            color: #fff;
            box-shadow: 0 4px 14px rgba(0, 0, 0, .2);
          }
        }
      `
      toastEle = document.createElement('div')
      toastEle.className = 'notice'
      shadowRoot.append(style, toastEle)
      document.documentElement.append(host)
    }

    toastEle.textContent = message
    toastEle.style.opacity = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastEle.style.opacity = '0'
    }, 3000)
  }

  const showReadAloudError = () => {
    const message = '朗读失败，请检查网络连接后重试。'
    if (window.dictolEntry?.showToast) {
      window.dictolEntry.showToast({ type: 'error', message })
    } else {
      showShadowToast(message)
    }
  }

  // 同时只允许一个 TTS 任务；每个任务独立拥有音频和资源。
  let cancelCurrentTTS = null
  addEventListener('pagehide', () => cancelCurrentTTS?.())

  /**
   * 启动朗读，通过回调通知 UI；使用 signal 取消。
   * 新调用会中止上一任务。每个任务只发送一次终态。
   * @param {string} text
   * @param {string} [voice]
   * @param {object} [options]
   * @param {(state: 'waiting' | 'playing' | 'completed' | 'aborted' | 'error', error?: Error) => void} [options.onStateChange]
   * @param {AbortSignal} [options.signal]
   * @returns {void}
   */
  const playTTS = (text, voice, { onStateChange, signal } = {}) => {
    if (signal?.aborted) {
      onStateChange?.('aborted')
      return
    }
    const value = text?.trim() ?? ''
    if (!value || value.length > 200) {
      onStateChange?.('error', new Error('朗读文本须为 1–200 个字符。'))
      return
    }

    cancelCurrentTTS?.()
    const audio = new Audio()
    let audioURL = ''
    let finished = false

    const finish = (state, error) => {
      if (finished) return
      finished = true
      signal?.removeEventListener('abort', cancel)
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (audioURL) URL.revokeObjectURL(audioURL)
      if (cancelCurrentTTS === cancel) cancelCurrentTTS = null
      if (state === 'error') showReadAloudError()
      onStateChange?.(state, error)
    }
    const cancel = () => finish('aborted')
    cancelCurrentTTS = cancel
    signal?.addEventListener('abort', cancel, { once: true })
    audio.onended = () => finish('completed')
    audio.onerror = () => finish('error', new Error('Audio playback failed.'))
    onStateChange?.('waiting')

    const start = async () => {
      try {
        const data = await window.dictolEntry.readAloud(value, voice)
        if (finished) return
        if (!data?.byteLength) throw new Error('Audio data is empty.')
        audioURL = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }))
        audio.src = audioURL
        await audio.play()
      } catch (error) {
        if (!finished) finish('error', error)
        return
      }
      if (!finished) onStateChange?.('playing')
    }
    void start()
  }
  window.playTTS = playTTS

  // sound:// 音源播放拦截
  const soundAudio = new Audio()
  // 与主进程 resource-protocol.ts getMimeType 的音频类型保持一致。
  // spx 保留仅为兜底兼容旧链接，Chromium 实际无法解码 Speex。
  const dictionaryAudioPattern = /\.(?:mp3|wav|ogg|oga|opus|webm|weba|flac|mp4|m4a|spx)(?:[?#]|$)/i

  const resolveDictionaryAudioHref = (anchor) => {
    const rawHref = anchor?.getAttribute('href')?.trim()
    if (!rawHref) return ''
    if (!/^(?:sound|audio|file):\/\//i.test(rawHref)) return ''
    return dictionaryAudioPattern.test(rawHref) ? rawHref : ''
  }

  const playDictionaryAudio = (href) => {
    if (!soundAudio.paused) soundAudio.pause()
    soundAudio.src = href
    void soundAudio.play().catch((error) => {
      if (error?.name !== 'AbortError') {
        console.error('Failed to play dictionary audio', error)
      }
    })
  }

  // 播放内置音频：捕获阶段只安装 fallback，不抢先播放词典自己的音频。
  const installDictionaryAudioFallback = (event) => {
    const target = event.target instanceof Element ? event.target : null
    const anchor = target?.closest('a[href]')
    if (!target || !anchor) return

    const href = resolveDictionaryAudioHref(anchor)
    if (!href) return

    let fallbackInvoked = false
    const fallback = (clickEvent) => {
      fallbackInvoked = true

      // 词典自己的 handler 已经处理了这个点击，避免重复播放。
      if (clickEvent.defaultPrevented) return

      clickEvent.preventDefault()
      clickEvent.stopPropagation()
      playDictionaryAudio(href)
    }

    target.addEventListener('click', fallback, { once: true })

    // 如果事件没有到达 target 阶段，清理临时 listener，避免泄漏。
    setTimeout(() => {
      if (!fallbackInvoked) target.removeEventListener('click', fallback)
    }, 0)
  }

  document.addEventListener('click', installDictionaryAudioFallback, true)

  // 词条跳转兜底
  document.addEventListener(
    'click',
    (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      const href = anchor?.getAttribute('href')?.trim()
      if (!href || !/^entry:\/\//i.test(href)) return
      event.preventDefault()
      event.stopPropagation()

      const target = href.replace(/^entry:\/\/\/?/i, '').split('#', 1)[0]
      try {
        // 需要额外处理 entry://@topic_literature-and-writing_level=b1 里的 @ 符号，避免被当作uri分隔符
        location.assign(`entry:///${encodeURIComponent(decodeURIComponent(target))}`)
      } catch {
        location.assign(`entry:///${encodeURIComponent(target)}`)
      }
    },
    true
  )
})()
