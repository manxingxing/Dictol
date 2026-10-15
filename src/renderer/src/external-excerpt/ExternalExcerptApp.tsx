import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'

import { AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH } from '../../../shared/ai-ipc'
import { segmentTextByWord } from '@/lib/text-segmentation'
import type { ExternalExcerptCapture } from '../../../shared/selection-toolbar'

declare global {
  interface Window {
    dictolExternalExcerpt: {
      onUpdate: (callback: (payload: ExternalExcerptCapture) => void) => () => void
      save: (input: { excerpt: string; relatedTerms: string[]; comment: string }) => Promise<void>
      generateNote: (input: { excerpt: string; relatedTerms: string[] }) => Promise<string>
      lookupWord: (word: string) => void
    }
  }
}

export function ExternalExcerptApp(): React.JSX.Element {
  const [capture, setCapture] = useState<ExternalExcerptCapture>()
  const [selectedTerms, setSelectedTerms] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingNote, setGeneratingNote] = useState(false)
  const [aiError, setAiError] = useState('')
  const [error, setError] = useState('')
  const generationVersion = useRef(0)
  const tokens = useMemo(() => (capture ? segmentTextByWord(capture.text) : []), [capture])

  useEffect(
    () =>
      window.dictolExternalExcerpt.onUpdate((nextCapture) => {
        generationVersion.current += 1
        setCapture(nextCapture)
        setSelectedTerms([])
        setComment('')
        setGeneratingNote(false)
        setAiError('')
        setError('')
      }),
    []
  )

  const toggleTerm = (term: string): void => {
    setSelectedTerms((current) => {
      const existingIndex = current.findIndex(
        (candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase()
      )
      if (existingIndex >= 0) return current.filter((_, index) => index !== existingIndex)
      return [...current, term]
    })
  }

  const save = async (): Promise<void> => {
    if (!capture || saving || generatingNote) return
    setSaving(true)
    setError('')
    try {
      await window.dictolExternalExcerpt.save({
        excerpt: capture.text,
        relatedTerms: selectedTerms,
        comment
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存摘抄失败')
    } finally {
      setSaving(false)
    }
  }

  const generateNote = async (): Promise<void> => {
    if (!capture || !capture.aiEnabled || generatingNote || saving) return
    const requestVersion = ++generationVersion.current
    setGeneratingNote(true)
    setAiError('')
    try {
      const note = await window.dictolExternalExcerpt.generateNote({
        excerpt: capture.text,
        relatedTerms: selectedTerms
      })
      if (requestVersion === generationVersion.current) setComment(note)
    } catch (generateError) {
      if (requestVersion === generationVersion.current) {
        setAiError(generateError instanceof Error ? generateError.message : 'AI 生成笔记失败')
      }
    } finally {
      if (requestVersion === generationVersion.current) setGeneratingNote(false)
    }
  }

  if (!capture) {
    return (
      <div className="excerpt-loading">
        <LoaderCircle className="spin" /> 正在载入选中文本…
      </div>
    )
  }

  return (
    <main className="excerpt-window">
      <header className="excerpt-header">
        <div className="excerpt-heading">
          <h1>摘抄与笔记</h1>
          <p>
            {capture.sourceApp
              ? `来自 ${capture.sourceApp} · 可选择重点词和添加笔记`
              : '可选择重点词和添加笔记'}
          </p>
        </div>
      </header>

      <div className="excerpt-body">
        <section className="excerpt-section">
          <div className="excerpt-section-label">
            <span>原文</span>
            <span className="excerpt-hint">点击单词标记重点</span>
          </div>
          <div aria-label="选中的摘抄文本，点击单词以关联" className="excerpt-quote">
            {tokens.map((token, index) => {
              if (!token.isWordLike)
                return <span key={`${index}-${token.segment}`}>{token.segment}</span>
              const selected = selectedTerms.some(
                (term) => term.toLocaleLowerCase() === token.segment.toLocaleLowerCase()
              )
              return (
                <button
                  aria-pressed={selected}
                  className={`excerpt-token${selected ? ' is-selected' : ''}`}
                  disabled={generatingNote || saving}
                  key={`${index}-${token.segment}`}
                  onClick={() => toggleTerm(token.segment)}
                  type="button"
                >
                  {token.segment}
                </button>
              )
            })}
          </div>
        </section>

        <section className="excerpt-section related-section">
          <div className="excerpt-section-label">
            <span>重点单词</span>
            <span className="excerpt-hint">已选 · {selectedTerms.length}</span>
          </div>
          {selectedTerms.length ? (
            <div className="excerpt-tags">
              {selectedTerms.map((term) => (
                <button
                  className="excerpt-tag"
                  disabled={generatingNote || saving}
                  key={term.toLocaleLowerCase()}
                  onClick={() => toggleTerm(term)}
                  type="button"
                >
                  {term}
                  <X size={12} />
                </button>
              ))}
            </div>
          ) : (
            <p className="excerpt-empty-tags">还没有关联单词</p>
          )}
        </section>

        <section className="excerpt-section comment-section">
          <div className="excerpt-section-label">
            <label htmlFor="excerpt-comment">笔记</label>
            {capture.aiEnabled && (
              <button
                className="excerpt-ai-action"
                disabled={
                  generatingNote || saving || capture.text.length > AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH
                }
                onClick={() => void generateNote()}
                title={
                  capture.text.length > AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH
                    ? `原文超过 ${AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH.toLocaleString()} 字符，无法生成`
                    : selectedTerms.length === 0
                      ? '解释整句话并填入笔记'
                      : '解释整句话，再着重解释关联词在句子里的含义'
                }
                type="button"
              >
                {generatingNote && <LoaderCircle className="spin" size={13} />}
                {generatingNote ? '正在生成…' : 'AI 生成笔记'}
              </button>
            )}
          </div>
          <textarea
            autoFocus
            disabled={generatingNote || saving}
            id="excerpt-comment"
            onChange={(event) => setComment(event.target.value)}
            placeholder="写下你对这句话的理解、联想或补充…"
            value={comment}
          />
          {aiError && (
            <p className="excerpt-error mt-2" role="alert">
              {aiError}
            </p>
          )}
        </section>
      </div>

      <footer className="excerpt-footer">
        <div className="excerpt-save-actions">
          {error && (
            <span className="excerpt-error" role="alert">
              {error}
            </span>
          )}
          <button
            className="excerpt-save"
            disabled={saving || generatingNote}
            onClick={() => void save()}
            type="button"
          >
            {saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
            保存摘抄
          </button>
        </div>
      </footer>
    </main>
  )
}
