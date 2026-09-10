/* eslint-disable @typescript-eslint/explicit-function-return-type */
;(() => {
  const sections = Array.from(document.querySelectorAll('.dictol-dictionary-section'))
  const titles = Array.from(document.querySelectorAll('.dictol-dictionary-title'))
  const titlesByEntryId = new Map(
    titles.map((title) => [title.getAttribute('aria-controls'), title])
  )
  let publishedSection = null
  const container = document.getElementById('dictol-concatenated-entry')
  const isHorizontal = () => document.body.dataset.layout === 'horizontal'

  const findSectionAtViewportTop = () => {
    if (isHorizontal()) {
      const line = container.getBoundingClientRect().left + 12
      return (
        sections.find((section) => {
          const rect = section.getBoundingClientRect()
          return rect.left <= line && rect.right > line
        }) ?? sections.find((section) => section.getBoundingClientRect().left > line)
      )
    }
    return sections.find((section) => {
      const rect = section.getBoundingClientRect()
      return rect.top <= 0 && rect.bottom > 0
    })
  }

  const syncActiveSection = () => {
    const current = findSectionAtViewportTop()
    if (!current) return
    if (current === publishedSection) return

    const dictionaryId = Number(current.getAttribute('data-dictionary-id'))
    if (!Number.isSafeInteger(dictionaryId) || dictionaryId <= 0) return

    publishedSection = current
    window.dictolEntry?.notifyActiveDictionary(dictionaryId)
  }

  let observer
  const observeSections = () => {
    observer?.disconnect()
    observer = new IntersectionObserver(syncActiveSection, {
      root: isHorizontal() ? container : null,
      // 用像素明确表示 viewport 顶部的线，避免百分比的宽高基准差异。
      rootMargin: isHorizontal()
        ? `0px -${Math.max(0, container.clientWidth - 13)}px 0px -12px`
        : `0px 0px -${document.documentElement.clientHeight}px 0px`,
      threshold: 0
    })
    sections.forEach((section) => observer.observe(section))
    syncActiveSection()
  }

  const setSectionCollapsed = (section, collapsed) => {
    section.classList.toggle('is-collapsed', collapsed)

    const title = titlesByEntryId.get(section.id)
    title?.classList.toggle('is-collapsed', collapsed)
    title?.setAttribute('aria-expanded', String(!collapsed))
  }

  const getSectionForTitle = (title) => {
    const entryId = title.getAttribute('aria-controls')
    const section = entryId ? document.getElementById(entryId) : null
    return section instanceof HTMLElement ? section : null
  }

  document.addEventListener(
    'click',
    (event) => {
      const title =
        event.target instanceof Element ? event.target.closest('.dictol-dictionary-title') : null
      if (!(title instanceof HTMLElement)) return

      event.preventDefault()
      event.stopPropagation()
      const section = getSectionForTitle(title)
      if (!(section instanceof HTMLElement)) return

      setSectionCollapsed(section, !section.classList.contains('is-collapsed'))
    },
    true
  )

  const navigateToDictionary = (dictionaryId) => {
    if (!Number.isSafeInteger(dictionaryId) || dictionaryId <= 0) return
    const section = document.getElementById(`dictol-dictionary-section-${dictionaryId}`)
    if (!(section instanceof HTMLElement)) return
    const entry = document.getElementById(`dictol-dictionary-${dictionaryId}`)
    if (entry instanceof HTMLElement && entry.classList.contains('is-collapsed')) {
      setSectionCollapsed(entry, false)
    }
    if (isHorizontal()) {
      const left =
        section.getBoundingClientRect().left - container.getBoundingClientRect().left - 12
      container.scrollTo({ left: Math.ceil(container.scrollLeft + left), behavior: 'instant' })
      syncActiveSection()
      return
    }
    section.scrollIntoView({ behavior: 'instant', block: 'start' })
    // Chromium 可能把滚动偏移向下取整，留下不足 1px 的上一个词典。
    const top = section.getBoundingClientRect().top
    if (top > 0 && top < 1) window.scrollBy({ top: 1, behavior: 'instant' })
    syncActiveSection()
  }
  window.dictolEntry?.onScrollToDictionary?.(navigateToDictionary)
  window.dictolEntry?.onLayoutChanged?.((layout) => {
    const current = publishedSection ?? sections[0]
    document.body.dataset.layout = layout
    observeSections()
    if (current) navigateToDictionary(Number(current.dataset.dictionaryId))
  })
  container?.addEventListener('scroll', syncActiveSection, { passive: true })

  window.addEventListener('scroll', syncActiveSection, { passive: true })
  window.addEventListener('resize', observeSections)
  observeSections()
})()
