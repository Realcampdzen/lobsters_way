import type { KVNamespace } from '@cloudflare/workers-types'
import { kvGetJson, kvPutJson } from './kv'
import type { MemoryMessage } from './types'

/**
 * Читает историю беседы из KV (последние N сообщений).
 */
export async function getConversationMemory(
  kv: KVNamespace | undefined,
  conversationKey: string,
  params?: { limit?: number },
): Promise<MemoryMessage[]> {
  const limit = params?.limit ?? 10
  const existing = (await kvGetJson<MemoryMessage[]>(kv, conversationKey)) ?? []
  return existing.slice(-limit)
}

/**
 * Добавляет сообщение в историю беседы (хранит последние N, TTL 30 дней).
 */
export async function appendConversationMemory(
  kv: KVNamespace | undefined,
  conversationKey: string,
  message: MemoryMessage,
  params?: { limit?: number; ttlSeconds?: number },
): Promise<MemoryMessage[]> {
  const limit = params?.limit ?? 10
  const ttlSeconds = params?.ttlSeconds ?? 60 * 60 * 24 * 30 // 30 days

  const current = (await kvGetJson<MemoryMessage[]>(kv, conversationKey)) ?? []
  const next = [...current, message].slice(-limit)
  await kvPutJson(kv, conversationKey, next, { ttlSeconds })
  return next
}

/**
 * Обрезает текст до maxChars, стараясь разорвать на границе предложения.
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const sliced = text.slice(0, maxChars)
  const lastStop = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'))
  if (lastStop > 120) return sliced.slice(0, lastStop + 1).trim()
  return sliced.trim()
}
