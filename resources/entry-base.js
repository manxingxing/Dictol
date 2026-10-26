/* eslint-disable @typescript-eslint/explicit-function-return-type */
;(() => {
  const initialize = () => {
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
    window.dictolShowToast = showShadowToast

    /**
     * 使用应用配置的系统音色朗读。保留旧版 voice 参数供词典脚本兼容。
     * @param {string} text
     * @param {string} [_voice]
     * @param {object} [options]
     * @param {(state: 'waiting' | 'playing' | 'completed' | 'aborted' | 'error', error?: Error) => void} [options.onStateChange]
     * @param {AbortSignal} [options.signal]
     * @returns {void}
     */
    window.playTTS = (text, _voice, { onStateChange, signal } = {}) => {
      if (signal?.aborted) {
        onStateChange?.('aborted')
        return
      }

      const tts = window.dictolEntry?.tts
      let finished = false
      const stop = () => {
        if (!finished) tts?.stop()
      }
      const onPlaybackState = (state, message) => {
        if (state === 'completed' || state === 'aborted' || state === 'error') {
          finished = true
          signal?.removeEventListener('abort', stop)
        }
        if (state === 'error') {
          const error = new Error(message || '朗读失败。')
          if (window.dictolEntry?.showToast) {
            window.dictolEntry.showToast({ type: 'error', message: error.message })
          } else {
            showShadowToast(error.message)
          }
          onStateChange?.(state, error)
          return
        }
        onStateChange?.(state)
      }

      if (!tts) {
        onPlaybackState('error', '当前页面不支持语音朗读。')
        return
      }
      signal?.addEventListener('abort', stop, { once: true })
      tts.speak(text, onPlaybackState)
      if (signal?.aborted) stop()
    }

    // 词典音源链接播放拦截
    const soundAudio = new Audio()
    // 与主进程 resource-protocol.ts getMimeType 的音频类型保持一致。
    // spx 保留仅为兜底兼容旧链接，Chromium 实际无法解码 Speex。
    const dictionaryAudioPattern =
      /\.(?:mp3|wav|ogg|oga|opus|webm|weba|flac|aac|mp4|m4a|m4b|m4r|spx)(?:[?#]|$)/i

    const resolveDictionaryAudioHref = (anchor) => {
      const rawHref = anchor?.getAttribute('href')?.trim()
      if (!rawHref) return ''
      if (!/^(?:sound|snd|audio):\/\//i.test(rawHref)) return ''
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
        location.assign(href)
      },
      true
    )
  }

  if (document.readyState === 'complete') initialize()
  else document.addEventListener('DOMContentLoaded', initialize, { once: true })
})()
