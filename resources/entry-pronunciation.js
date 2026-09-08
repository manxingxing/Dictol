/* eslint-disable @typescript-eslint/explicit-function-return-type */
;(() => {
  const audio = new Audio()
  const dictionaryAudioPattern = /\.(?:mp3|wav|ogg|oga|spx|m4a)(?:[?#]|$)/i

  const resolveDictionaryAudioHref = (anchor) => {
    const rawHref = anchor?.getAttribute('href')?.trim()
    if (!rawHref) return ''
    if (!/^(?:sound|audio|file):\/\//i.test(rawHref)) return ''
    return dictionaryAudioPattern.test(rawHref) ? rawHref : ''
  }

  const playDictionaryAudio = (href) => {
    if (!audio.paused) audio.pause()
    audio.src = href
    void audio.play().catch((error) => {
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
})()
