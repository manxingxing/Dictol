export type AiCompletionRequest = {
  model: string
  messages: readonly unknown[]
  stream: boolean
}

export function createAiCompletionBody(request: AiCompletionRequest): Record<string, unknown> {
  const model = request.model.trim()
  const body: Record<string, unknown> = {
    model,
    stream: request.stream,
    messages: request.messages
  }
  if (isDeepSeekModel(model)) {
    // Keep the existing DeepSeek non-thinking behavior for dictionary requests.
    body.thinking = { type: 'disabled' }
  }

  if (!isGeminiModel(model) && !isOpenAiReasoningModel(model)) {
    body.temperature = 0.3
  }
  return body
}

function isDeepSeekModel(model: string): boolean {
  return /(?:^|[/_-])deepseek(?:[/_.-]|$)/iu.test(model)
}

function isGeminiModel(model: string): boolean {
  return /(?:^|[/_-])gemini(?:[/_.-]|$)/iu.test(model)
}

function isOpenAiReasoningModel(model: string): boolean {
  return /(?:^|[/_-])(?:gpt-[5-9](?:[._-]|$)|o\d+(?:[._-]|$))/iu.test(model)
}
