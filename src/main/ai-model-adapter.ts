import type {
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions'
import { parseAiExtraParams } from '../shared/ai-settings'

export type AiCompletionRequest = {
  model: string
  messages: ChatCompletionMessageParam[]
  extraParams?: string
  stream?: boolean
  responseFormat?: ChatCompletionCreateParamsBase['response_format']
}

export function createAiCompletionBody(
  request: AiCompletionRequest
): ChatCompletionCreateParamsBase {
  const model = request.model.trim()
  const body: ChatCompletionCreateParamsBase & { thinking?: { type: string } } = {
    model,
    messages: request.messages
  }
  if (isDeepSeekModel(model)) {
    // Keep the existing DeepSeek non-thinking behavior for dictionary requests.
    body.thinking = { type: 'disabled' }
  }

  if (!isGeminiModel(model) && !isOpenAiReasoningModel(model)) {
    body.temperature = 0.3
  }
  return {
    ...body,
    stream: request.stream,
    ...(request.responseFormat && { response_format: request.responseFormat }),
    ...parseAiExtraParams(request.extraParams ?? '')
  }
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
