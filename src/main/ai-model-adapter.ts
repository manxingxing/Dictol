export type AiCompletionPurpose = 'lookup' | 'classification'

export type AiCompletionRequest = {
  model: string
  messages: readonly unknown[]
  stream: boolean
  purpose: AiCompletionPurpose
}

/**
 * OpenAI-compatible providers share the envelope, not the model controls.
 * Keep provider/model-specific fields here so every request path uses the
 * same compatibility contract.
 */
export function createAiCompletionBody(request: AiCompletionRequest): Record<string, unknown> {
  const model = request.model.trim()
  const body: Record<string, unknown> = {
    model,
    stream: request.stream,
    messages: request.messages
  }
  if (request.purpose === 'classification') body.max_tokens = 64

  if (isDeepSeekModel(model)) {
    // DeepSeek's thinking mode does not accept temperature. Explicitly use
    // its documented non-thinking mode for short dictionary responses.
    body.thinking = { type: 'disabled' }
    return body
  }

  if (isGeminiModel(model)) {
    const reasoningEffort = getGeminiReasoningEffort(model)
    if (reasoningEffort) body.reasoning_effort = reasoningEffort
    return body
  }

  if (isOpenAiReasoningModel(model)) {
    body.reasoning_effort = isOpenAiProModel(model) ? 'high' : 'low'
    return body
  }

  body.temperature = request.purpose === 'classification' ? 0 : 0.3
  return body
}

function isDeepSeekModel(model: string): boolean {
  return /(?:^|[/_-])deepseek(?:[/_.-]|$)/iu.test(model)
}

function isGeminiModel(model: string): boolean {
  return /(?:^|[/_-])gemini(?:[/_.-]|$)/iu.test(model)
}

function getGeminiReasoningEffort(model: string): 'none' | 'low' | undefined {
  if (/gemini[-_/.:]?2\.5/iu.test(model)) return 'none'
  if (/gemini[-_/.:]?3(?:[._-]|$)/iu.test(model)) return 'low'
  return undefined
}

function isOpenAiReasoningModel(model: string): boolean {
  return /(?:^|[/_-])(?:gpt-5(?:[._-]|$)|o[134](?:[._-]|$))/iu.test(model)
}

function isOpenAiProModel(model: string): boolean {
  return /(?:^|[/_-])(?:gpt-5(?:[._-])?pro|o[134](?:[._-])?pro)(?:[/_.-]|$)/iu.test(model)
}
