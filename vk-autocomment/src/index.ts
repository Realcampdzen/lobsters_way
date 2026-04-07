/**
 * VK Auto-Comment Worker — Entry Point
 *
 * Cloudflare Worker на Hono.
 * Принимает VK Callback API и предоставляет debug endpoint.
 */

import { Hono } from 'hono'
import type { Env } from './types'
import { getVkConfirmationResponse, isValidVkRequest, processVkCallbackEvent } from './vk-handler'
import { kvGetJson, kvPutJson } from './kv'

const app = new Hono<{ Bindings: Env }>()

// ─────────────────────── VK Callback ───────────────────────

app.post('/api/vk/callback', async (c) => {
  const payload = await c.req.json().catch(() => null)
  if (!payload) return c.text('bad request', 400)

  // Подтверждение сервера
  const confirmation = getVkConfirmationResponse(c.env, payload)
  if (confirmation !== null) return c.text(confirmation)

  // Валидация secret/group_id
  if (!isValidVkRequest(c.env, payload)) {
    const kv = c.env.VK_AUTOCOMMENT_KV
    const groupIdEnv = c.env.VK_GROUP_ID ? Number(c.env.VK_GROUP_ID) : null
    const payloadGroupId = typeof payload?.group_id === 'number' ? payload.group_id : null

    await kvPutJson(
      kv,
      'nv:vk:lastForbidden',
      {
        ts: Date.now(),
        reason: 'invalid',
        type: payload?.type,
        event_id: payload?.event_id,
        payloadGroupId,
        expectedGroupId: groupIdEnv,
      },
      { ttlSeconds: 60 * 60 * 24 * 14 },
    )
    // Всегда отвечаем "ok" чтобы VK не отключил callback сервер
    return c.text('ok')
  }

  // Записываем breadcrumb
  const kv = c.env.VK_AUTOCOMMENT_KV
  const ctx = c.executionCtx
  await kvPutJson(
    kv,
    'nv:vk:lastCallback',
    {
      ts: Date.now(),
      type: payload?.type,
      event_id: payload?.event_id,
      group_id: payload?.group_id,
      hasWaitUntil: !!(ctx?.waitUntil),
    },
    { ttlSeconds: 60 * 60 * 24 * 14 },
  )

  // Обрабатываем в background чтобы быстро ответить VK
  if (ctx?.waitUntil) {
    ctx.waitUntil(processVkCallbackEvent(c.env, payload))
  } else {
    await processVkCallbackEvent(c.env, payload)
  }

  return c.text('ok')
})

// ─────────────────────── Debug Endpoint ───────────────────────

app.get('/api/debug', async (c) => {
  const kv = c.env.VK_AUTOCOMMENT_KV

  const getKv = async (key: string) => {
    try {
      const raw = await kv?.get(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  return c.json({
    ok: true,
    env: {
      hasOpenAIKey: !!c.env.OPENAI_API_KEY,
      hasKV: !!kv,
      hasVkGroupId: !!c.env.VK_GROUP_ID,
      hasVkSecret: !!c.env.VK_SECRET,
      hasVkConfirmationCode: !!c.env.VK_CONFIRMATION_CODE,
      hasVkAccessToken: !!c.env.VK_ACCESS_TOKEN,
    },
    vk: {
      lastCallback: await getKv('nv:vk:lastCallback'),
      lastEvent: await getKv('nv:vk:lastEvent'),
      lastWallPostNew: await getKv('nv:vk:lastWallPostNew'),
      lastWallReplyNew: await getKv('nv:vk:lastWallReplyNew'),
      lastForbidden: await getKv('nv:vk:lastForbidden'),
      lastDisabled: await getKv('nv:vk:lastDisabled'),
      lastCreateCommentError: await getKv('nv:vk:lastCreateCommentError'),
      lastOpenAIError: await getKv('nv:vk:lastOpenAIError'),
      lastUnhandledError: await getKv('nv:vk:lastUnhandledError'),
    },
  })
})

// ─────────────────────── Health Check ───────────────────────

app.get('/health', (c) => {
  return c.json({
    ok: true,
    hasOpenAIKey: !!c.env.OPENAI_API_KEY,
    hasKV: !!c.env.VK_AUTOCOMMENT_KV,
  })
})

// ─────────────────────── 404 ───────────────────────

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404)
})

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

export default app
