import type { KVNamespace } from '@cloudflare/workers-types'

/**
 * Bindings — переменные окружения Cloudflare Worker.
 * Агент должен заполнить их через wrangler secret put или .dev.vars.
 */
export type Env = {
  // OpenAI
  OPENAI_API_KEY?: string
  OPENAI_PROXY_BASE_URL?: string
  OPENAI_PROXY_TOKEN?: string

  // KV Storage (binding в wrangler.toml)
  VK_AUTOCOMMENT_KV?: KVNamespace

  // VK Callback API
  VK_GROUP_ID?: string
  VK_SECRET?: string
  VK_CONFIRMATION_CODE?: string
  VK_ACCESS_TOKEN?: string

  // Kill-switch
  NV_DISABLE_VK?: string
}

/**
 * Payload, приходящий от VK Callback API
 */
export type VkCallbackPayload = {
  type?: string
  group_id?: number
  secret?: string
  event_id?: string
  object?: any
}

/**
 * Сообщение OpenAI Chat Completion
 */
export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Сообщение в памяти ветки (conversation memory)
 */
export type MemoryMessage = {
  role: 'user' | 'assistant'
  content: string
  ts: number
}
