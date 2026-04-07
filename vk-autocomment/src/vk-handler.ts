/**
 * VK Auto-Comment Handler
 *
 * Обрабатывает VK Callback API события:
 * - wall_post_new → автокомментарий под постом
 * - wall_reply_new → ответ в ветке (если ответили на наш коммент или есть триггер)
 *
 * Портирован из cf-api/src/neurovalyusha/handlers.ts
 * Убрано: Telegram, значки Путеводителя, badge scoring — оставлена чистая VK-логика.
 */

import type { KVNamespace } from '@cloudflare/workers-types'
import type { Env, VkCallbackPayload, OpenAIChatMessage, MemoryMessage } from './types'
import { callOpenAIChat } from './openai'
import { kvGetJson, kvGetText, kvIsDuplicate, kvPutJson, kvPutText } from './kv'
import { appendConversationMemory, getConversationMemory, truncate } from './memory'
import {
  OPENAI_MODEL,
  SYSTEM_PROMPT,
  FEW_SHOT_EXAMPLES,
  VK_MESSAGE_PREFIX,
  REPLY_TRIGGER_KEYWORDS,
  FORBIDDEN_EMOJIS,
} from './config'

// ─────────────────────── Утилиты ───────────────────────

function nowTs(): number {
  return Date.now()
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isTruthyEnvFlag(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const t = v.trim().toLowerCase()
  if (!t) return false
  return t === '1' || t === 'true' || t === 'yes' || t === 'y' || t === 'on'
}

function clipOneLine(text: string | undefined | null, max: number): string {
  const s = String(text ?? '').replace(/[\r\n]+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

// ─────────────────────── Эмодзи-нормализация ───────────────────────

const EMOJI_STRIP_RE =
  /(?:[#*0-9]\uFE0F?\u20E3|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]|\u200D|\uFE0F|\uFE0E|\u20E3)/gu
const LEADING_EMOJI_RE =
  /^(?:[#*0-9]\uFE0F?\u20E3|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}])(?:\uFE0F|\uFE0E)?(?:[\u{1F3FB}-\u{1F3FF}])?/u

function tidyAfterEmojiStrip(value: string): string {
  return String(value || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([»"')\],.!?:;])/g, '$1')
    .trim()
}

function stripEmojiChars(value: string): string {
  return tidyAfterEmojiStrip(String(value || '').replace(EMOJI_STRIP_RE, ''))
}

function normalizeParagraphEmoji(
  value: string,
  opts: { allowLeadingEmoji: boolean },
): { text: string; leadingEmoji: string } {
  const t = String(value || '').trim()
  if (!t) return { text: '', leadingEmoji: '' }

  const m = opts.allowLeadingEmoji ? t.match(LEADING_EMOJI_RE) : null
  const leadingEmoji = m ? m[0] : ''

  const body = stripEmojiChars(t)
  if (!body) return { text: leadingEmoji, leadingEmoji }
  if (!leadingEmoji) return { text: body, leadingEmoji: '' }

  return { text: tidyAfterEmojiStrip(`${leadingEmoji} ${body}`), leadingEmoji }
}

// ─────────────────────── Нормализация текста ───────────────────────

/**
 * Чистит сгенерированный текст: убирает markdown, лишние эмодзи,
 * ограничивает количество предложений, вопросительных знаков.
 */
function normalizeOutgoingText(
  text: string,
  maxChars: number,
  opts?: { ensureEmoji?: boolean; allowMainEmoji?: boolean },
): string {
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/```/g, '')
    .replace(/`/g, '')
    .trim()

  // Удаляем запрещённые эмодзи
  for (const emoji of FORBIDDEN_EMOJIS) {
    cleaned = cleaned.replace(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
  }

  // Убираем маркеры списков/нумерации
  cleaned = cleaned.replace(/^\s*(?:[-*•]\s+|\d+\s*[.)]\s+)/gm, '')

  // Убираем "Мини-задание:" и всё после
  const miniLabelRe = /^(?:[^A-Za-zА-Яа-я0-9]{0,12}\s*)?(?:мини\s*[-‑–—]?\s*задани[ея]|проверка)\s*:\s*/iu
  const rawLines = cleaned.split('\n')
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0)

  let miniIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (miniLabelRe.test(lines[i])) {
      miniIndex = i
      break
    }
  }

  const mainParts = (miniIndex >= 0 ? lines.slice(0, miniIndex) : lines).join(' ')
  const mainText = (mainParts || '').replace(/\s{2,}/g, ' ').trim()

  // Убираем «не только …, но и …»
  let mainCleaned = mainText.replace(
    /не\s+только\s+([^\n]{1,220}?)\s*[,–—-]?\s*но\s+и\s+([^\n]{1,220}?)(?=\s*(?:[,.!?:;]|\n|$))/giu,
    (_m, left: string, right: string) => {
      const l = String(left || '').trim().replace(/^[\s,–—-]+/, '').replace(/[\s,–—-]+$/, '')
      const r = String(right || '').trim().replace(/^[\s,–—-]+/, '').replace(/[\s,–—-]+$/, '')
      if (!l && !r) return ''
      if (!l) return `и ${r}`
      if (!r) return `и ${l}`
      return `и ${l}, и ${r}`
    },
  )

  // Не больше 1 вопросительного знака
  const clampQuestionMarks = (value: string): string => {
    let seen = false
    return value.replace(/[?？]/g, (m) => {
      if (!seen) {
        seen = true
        return m
      }
      return '.'
    })
  }

  // Не больше 3 предложений
  const limitSentences = (value: string, maxSentences: number): string => {
    const text = (value || '').trim()
    if (!text) return ''
    const parts = text.match(/[^.!?？]+[.!?？]+|[^.!?？]+$/g) || []
    return parts.slice(0, maxSentences).join(' ').replace(/\s{2,}/g, ' ').trim()
  }

  const mainLimited = limitSentences(mainCleaned, 3)
  const mainClamped = clampQuestionMarks(mainLimited || 'Принято.')

  // Emoji placement: only at paragraph starts, at most one
  const allowMainEmoji = opts?.allowMainEmoji !== false
  const mainEmojiNorm = normalizeParagraphEmoji(mainClamped, { allowLeadingEmoji: allowMainEmoji })

  let mainFinal = mainEmojiNorm.text || 'Принято.'

  if (opts?.ensureEmoji && !mainEmojiNorm.leadingEmoji) {
    const withEmoji = normalizeParagraphEmoji(`💜 ${mainFinal}`, { allowLeadingEmoji: true })
    mainFinal = withEmoji.text || mainFinal
  }

  return truncate(mainFinal, maxChars)
}

// ─────────────────────── Триггеры ───────────────────────

/**
 * Решает, стоит ли отвечать на чужой комментарий.
 * Вызывается только когда комментарий НЕ является ответом на наш.
 */
function shouldReplyToText(text: string): boolean {
  const t = text.toLowerCase()
  if (t.includes('?') || t.includes('？')) return true
  return REPLY_TRIGGER_KEYWORDS.some((k) => t.includes(k))
}

// ─────────────────────── Сборка промпта ───────────────────────

function buildFullSystemPrompt(): string {
  return `${SYSTEM_PROMPT}\n\n${FEW_SHOT_EXAMPLES}`
}

function buildMessagesForNewPost(postText: string): OpenAIChatMessage[] {
  const clipped = truncate(postText.trim(), 1800)
  return [
    {
      role: 'system',
      content: `${buildFullSystemPrompt()}\n\nЗАДАЧА: напиши комментарий к новому посту. Платформа: ВК. НЕ начинай с эмодзи (из-за технического префикса).`,
    },
    { role: 'user', content: `Текст поста:\n${clipped}` },
  ]
}

function buildMessagesForReply(memory: MemoryMessage[]): OpenAIChatMessage[] {
  return [
    {
      role: 'system',
      content: `${buildFullSystemPrompt()}\n\nЗАДАЧА: ответь в ветке комментариев. Учитывай контекст переписки, не повторяй чужие слова. Платформа: ВК. НЕ начинай с эмодзи.`,
    },
    ...memory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ]
}

// ─────────────────────── Генерация текста ───────────────────────

async function generateCommentText(
  env: Env,
  messages: OpenAIChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; kv?: KVNamespace; diagKey?: string },
): Promise<string | null> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) return null

  const kv = opts?.kv
  const diagKey = opts?.diagKey || 'nv:vk:lastOpenAIError'

  const proxyBaseUrl = isNonEmptyString(env.OPENAI_PROXY_BASE_URL) ? env.OPENAI_PROXY_BASE_URL : undefined
  const proxyToken = isNonEmptyString(env.OPENAI_PROXY_TOKEN) ? env.OPENAI_PROXY_TOKEN : undefined

  try {
    const raw = await callOpenAIChat({
      apiKey,
      model: OPENAI_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.75,
      maxTokens: opts?.maxTokens ?? 450,
      baseUrl: proxyBaseUrl,
      proxyToken,
    })
    if (raw) return raw
    await kvPutJson(kv, diagKey, { ts: nowTs(), kind: 'empty_response', model: OPENAI_MODEL }, { ttlSeconds: 60 * 60 * 24 * 14 })
    return null
  } catch (error) {
    await kvPutJson(
      kv,
      diagKey,
      { ts: nowTs(), kind: 'error', model: OPENAI_MODEL, error: clipOneLine(String((error as any)?.message || error), 1200) },
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    return null
  }
}

// ─────────────────────── VK API: wall.createComment ───────────────────────

async function vkCreateComment(params: {
  kv?: KVNamespace
  accessToken: string
  ownerId: number
  postId: number
  message: string
  guid: string
  replyToCommentId?: number
}): Promise<number | null> {
  const { kv, accessToken, ownerId, postId, message, guid, replyToCommentId } = params
  const url = new URL('https://api.vk.com/method/wall.createComment')
  const qs = new URLSearchParams()

  qs.set('owner_id', String(ownerId))
  qs.set('post_id', String(postId))
  qs.set('from_group', '1')
  qs.set('message', message)
  qs.set('guid', guid)

  if (typeof replyToCommentId === 'number' && Number.isFinite(replyToCommentId) && replyToCommentId > 0) {
    qs.set('reply_to_comment', String(replyToCommentId))
  }

  qs.set('access_token', accessToken)
  qs.set('v', '5.199')

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: qs.toString(),
  })

  const text = await res.text().catch(() => '')
  const data = (() => {
    try {
      return JSON.parse(text) as any
    } catch {
      return null
    }
  })()

  const commentId = Number(data?.response?.comment_id)
  if (Number.isFinite(commentId) && commentId > 0) return commentId

  // Логируем ошибку VK API
  const err = data?.error
  if (kv) {
    const safeParams = Array.isArray(err?.request_params)
      ? err.request_params.filter((p: any) => p?.key !== 'access_token' && p?.key !== 'message')
      : undefined

    await kvPutJson(
      kv,
      'nv:vk:lastCreateCommentError',
      {
        ts: nowTs(),
        ownerId,
        postId,
        httpStatus: res.status,
        error_code: err?.error_code,
        error_msg: err?.error_msg,
        request_params: safeParams,
        raw: typeof text === 'string' ? text.slice(0, 2000) : undefined,
      },
      { ttlSeconds: 60 * 60 * 24 * 7 },
    )
  }
  return null
}

// ─────────────────────── Технический префикс ───────────────────────

function withVkPrefix(text: string): string {
  const t = (text || '').trim()
  if (!VK_MESSAGE_PREFIX) return t
  if (!t) return VK_MESSAGE_PREFIX
  if (t.startsWith(VK_MESSAGE_PREFIX)) return t
  return `${VK_MESSAGE_PREFIX} ${t}`
}

// ─────────────────────── PUBLIC: Валидация ───────────────────────

/**
 * Проверяет подтверждение сервера (type=confirmation).
 * Возвращает VK_CONFIRMATION_CODE или null если это не confirmation.
 */
export function getVkConfirmationResponse(env: Env, payload: VkCallbackPayload): string | null {
  if (payload?.type !== 'confirmation') return null
  return env.VK_CONFIRMATION_CODE || ''
}

/**
 * Валидирует secret и group_id из payload.
 */
export function isValidVkRequest(env: Env, payload: VkCallbackPayload): boolean {
  if (!payload || typeof payload !== 'object') return false

  if (isNonEmptyString(env.VK_GROUP_ID) && typeof payload.group_id === 'number') {
    const expected = Number(env.VK_GROUP_ID)
    if (Number.isFinite(expected) && expected > 0 && payload.group_id !== expected) return false
  }

  if (isNonEmptyString(env.VK_SECRET)) {
    if (!isNonEmptyString(payload.secret)) return false
    if (payload.secret !== env.VK_SECRET) return false
  }

  return true
}

// ─────────────────────── PUBLIC: Обработка события ───────────────────────

/**
 * Главная функция обработки VK Callback события.
 * Вызывается из index.ts после валидации.
 */
export async function processVkCallbackEvent(env: Env, payload: VkCallbackPayload): Promise<void> {
  const kv = env.VK_AUTOCOMMENT_KV

  try {
    const type = payload.type || ''
    const object = payload.object || {}

    // Kill-switch
    if (isTruthyEnvFlag(env.NV_DISABLE_VK)) {
      await kvPutJson(
        kv,
        'nv:vk:lastDisabled',
        { ts: nowTs(), type, event_id: payload?.event_id, reason: 'disabled' },
        { ttlSeconds: 60 * 60 * 24 * 14 },
      )
      return
    }

    // Дедупликация по event_id
    const dedupeId =
      payload.event_id ||
      `${type}:${String(object?.id ?? '')}:${String(object?.post_id ?? '')}:${String(object?.owner_id ?? '')}`
    const dedupeKey = `nv:vk:dedupe:${dedupeId}`
    if (await kvIsDuplicate(kv, dedupeKey, { ttlSeconds: 60 * 60 * 24 })) return

    // Breadcrumb: доказательство что событие обработано
    await kvPutJson(
      kv,
      'nv:vk:lastEvent',
      {
        ts: nowTs(),
        type,
        event_id: payload.event_id,
        object_id: object?.id,
        post_id: object?.post_id,
        owner_id: object?.owner_id,
      },
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )

    // ═══════════════════════════════════════════════════════════
    // СЦЕНАРИЙ 1: Новый пост → автокомментарий
    // ═══════════════════════════════════════════════════════════
    if (type === 'wall_post_new') {
      const postId = Number(object?.id)
      const ownerId = Number(object?.owner_id) || (isNonEmptyString(env.VK_GROUP_ID) ? -Number(env.VK_GROUP_ID) : 0)
      const postText = isNonEmptyString(object?.text) ? object.text : ''

      if (!Number.isFinite(postId) || postId <= 0) {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'bad_post_id', postId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }
      if (!Number.isFinite(ownerId) || ownerId === 0) {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'bad_owner_id', ownerId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }
      if (!isNonEmptyString(env.VK_ACCESS_TOKEN)) {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'missing_vk_access_token', ownerId, postId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      // Проверка: уже комментировали этот пост?
      const postKey = `nv:vk:post:${ownerId}:${postId}:commented`
      const already = await kvGetText(kv, postKey)
      if (already) {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: true, skipped: true, reason: 'already_commented', ownerId, postId, existing: already }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      // Сохраняем контекст поста
      const conversationKey = `nv:vk:conv:${ownerId}:${postId}`
      await appendConversationMemory(kv, conversationKey, {
        role: 'user',
        content: `Пост (ВК): ${truncate(postText || '(без текста)', 1800)}`,
        ts: nowTs(),
      })

      // Генерируем комментарий
      const aiMessages = buildMessagesForNewPost(postText || '')
      const generated = await generateCommentText(env, aiMessages, {
        temperature: 0.7,
        maxTokens: 150,
        kv,
      })

      if (!generated) {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'openai_failed', ownerId, postId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      const comment = normalizeOutgoingText(generated, 400, { ensureEmoji: true, allowMainEmoji: false })
      if (!comment) {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'empty_comment', ownerId, postId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      const vkComment = withVkPrefix(comment)

      // Отправляем комментарий
      const commentId = await vkCreateComment({
        kv,
        accessToken: env.VK_ACCESS_TOKEN,
        ownerId,
        postId,
        message: vkComment,
        guid: dedupeId,
        replyToCommentId: undefined,
      })

      if (commentId) {
        await kvPutText(kv, postKey, String(commentId), { ttlSeconds: 60 * 60 * 24 * 30 })
        await kvPutText(kv, `nv:vk:myComment:${commentId}`, '1', { ttlSeconds: 60 * 60 * 24 * 60 })
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: true, ownerId, postId, commentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
      } else {
        await kvPutJson(kv, 'nv:vk:lastWallPostNew', { ts: nowTs(), ok: false, reason: 'vk_create_comment_failed', ownerId, postId }, { ttlSeconds: 60 * 60 * 24 * 14 })
      }

      // Запоминаем наш комментарий (без VK-префикса)
      await appendConversationMemory(kv, conversationKey, { role: 'assistant', content: comment, ts: nowTs() })
      return
    }

    // ═══════════════════════════════════════════════════════════
    // СЦЕНАРИЙ 2: Ответ на комментарий → бот отвечает в ветке
    // ═══════════════════════════════════════════════════════════
    if (type === 'wall_reply_new') {
      const commentId = Number(object?.id)
      const postId = Number(object?.post_id)
      const ownerId = Number(object?.owner_id) || (isNonEmptyString(env.VK_GROUP_ID) ? -Number(env.VK_GROUP_ID) : 0)
      const fromId = Number(object?.from_id)
      const replyToCommentId = Number(object?.reply_to_comment) || undefined
      const text = isNonEmptyString(object?.text) ? object.text : ''

      if (!Number.isFinite(commentId) || commentId <= 0) return
      if (!Number.isFinite(postId) || postId <= 0) return
      if (!Number.isFinite(ownerId) || ownerId === 0) return

      if (!isNonEmptyString(env.VK_ACCESS_TOKEN)) {
        await kvPutJson(kv, 'nv:vk:lastWallReplyNew', { ts: nowTs(), ok: false, reason: 'missing_vk_access_token', ownerId, postId, commentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      // Игнорируем свои же комментарии
      if (Number.isFinite(fromId) && isNonEmptyString(env.VK_GROUP_ID) && fromId === -Number(env.VK_GROUP_ID)) return

      // Проверяем: это ответ на НАШ комментарий?
      const isReplyToUs =
        typeof replyToCommentId === 'number' && replyToCommentId > 0
          ? Boolean(await kvGetText(kv, `nv:vk:myComment:${replyToCommentId}`))
          : false

      // Решаем: отвечать или нет
      if (!isReplyToUs && !shouldReplyToText(text)) {
        await kvPutJson(kv, 'nv:vk:lastWallReplyNew', { ts: nowTs(), ok: true, skipped: true, reason: 'no_trigger', ownerId, postId, commentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      // Добавляем в историю
      const conversationKey = `nv:vk:conv:${ownerId}:${postId}`
      await appendConversationMemory(kv, conversationKey, {
        role: 'user',
        content: `Комментарий участника (ВК): ${truncate(text || '(без текста)', 1200)}`,
        ts: nowTs(),
      })

      // Берём историю ветки
      const memory = await getConversationMemory(kv, conversationKey, { limit: 10 })

      // Генерируем ответ
      const aiMessages = buildMessagesForReply(memory)
      const generated = await generateCommentText(env, aiMessages, {
        temperature: 0.7,
        maxTokens: 150,
        kv,
      })

      if (!generated) {
        await kvPutJson(kv, 'nv:vk:lastWallReplyNew', { ts: nowTs(), ok: false, reason: 'openai_failed', ownerId, postId, replyTo: commentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      const reply = normalizeOutgoingText(generated, 400, { ensureEmoji: true, allowMainEmoji: false })
      if (!reply) {
        await kvPutJson(kv, 'nv:vk:lastWallReplyNew', { ts: nowTs(), ok: false, reason: 'empty_reply', ownerId, postId, replyTo: commentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
        return
      }

      const vkReply = withVkPrefix(reply)

      // Отправляем ответ в ветку
      const newCommentId = await vkCreateComment({
        kv,
        accessToken: env.VK_ACCESS_TOKEN,
        ownerId,
        postId,
        message: vkReply,
        guid: dedupeId,
        replyToCommentId: commentId, // ← reply_to_comment делает ответ "в ветке"
      })

      if (newCommentId) {
        await kvPutText(kv, `nv:vk:myComment:${newCommentId}`, '1', { ttlSeconds: 60 * 60 * 24 * 60 })
        await kvPutJson(kv, 'nv:vk:lastWallReplyNew', { ts: nowTs(), ok: true, ownerId, postId, replyTo: commentId, commentId: newCommentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
      } else {
        await kvPutJson(kv, 'nv:vk:lastWallReplyNew', { ts: nowTs(), ok: false, reason: 'vk_create_comment_failed', ownerId, postId, replyTo: commentId }, { ttlSeconds: 60 * 60 * 24 * 14 })
      }

      // Запоминаем без VK-префикса
      await appendConversationMemory(kv, conversationKey, { role: 'assistant', content: reply, ts: nowTs() })
      return
    }
  } catch (error) {
    await kvPutJson(
      kv,
      'nv:vk:lastUnhandledError',
      {
        ts: nowTs(),
        type: payload?.type,
        event_id: payload?.event_id,
        error: clipOneLine(String((error as any)?.message || error), 1200),
      },
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    return
  }
}
