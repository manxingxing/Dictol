import OpenAI from 'openai'

export function createOpenAiClient(baseURL: string, apiKey: string, timeout?: number): OpenAI {
  return new OpenAI({
    baseURL,
    // The SDK requires a key; local compatible services can still run without one.
    apiKey: apiKey || 'not-required',
    defaultHeaders: apiKey ? undefined : { Authorization: null },
    maxRetries: 0,
    ...(timeout ? { timeout } : {})
  })
}
