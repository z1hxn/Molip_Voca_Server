import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envCandidates = [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env'),
]

envCandidates.forEach((envPath) => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
})

const {
  PORT = '4000',
  FRONTEND_ORIGIN = 'http://localhost:5173',
  FRONTEND_ORIGINS = '',
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} = process.env

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
}

const app = express()
const createSupabaseClient = (token) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: {
    schema: 'molip_voca',
  },
  global: token
    ? {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    : undefined,
})

const publicSupabase = createSupabaseClient()

const allowedOrigins = (FRONTEND_ORIGINS || FRONTEND_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error('Not allowed by CORS'))
  },
}))
app.use(express.json())

const createUserClient = (token) => createSupabaseClient(token)

const getBearerToken = (req) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

const authRequired = async (req, res, next) => {
  const token = getBearerToken(req)
  if (!token) {
    res.status(401).json({ message: 'Unauthorized' })
    return
  }

  const { data, error } = await publicSupabase.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ message: 'Invalid token' })
    return
  }

  req.user = data.user
  req.supabase = createUserClient(token)
  next()
}

const authOptional = async (req, _res, next) => {
  const token = getBearerToken(req)
  if (!token) {
    req.user = null
    req.supabase = publicSupabase
    next()
    return
  }

  const { data, error } = await publicSupabase.auth.getUser(token)
  if (error || !data.user) {
    req.user = null
    req.supabase = publicSupabase
    next()
    return
  }

  req.user = data.user
  req.supabase = createUserClient(token)
  next()
}

const sendError = (res, error, status = 400) => {
  res.status(status).json({ message: error?.message || 'Request failed' })
}

const SHARE_SCOPES = new Set(['private', 'unlisted', 'public'])

const normalizeShareScope = (scope, isPublicFallback = false) => {
  if (typeof scope === 'string' && SHARE_SCOPES.has(scope)) {
    return scope
  }
  return isPublicFallback ? 'public' : 'private'
}

const deriveIsPublic = (shareScope) => shareScope !== 'private'

const normalizeMeaningValue = (value) => String(value || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
  .join(', ')

const withShareScope = (row) => {
  if (!row) return row
  const shareScope = normalizeShareScope(row.share_scope, Boolean(row.is_public))
  return {
    ...row,
    share_scope: shareScope,
    is_public: deriveIsPublic(shareScope),
  }
}

const isShareScopeColumnMissing = (error) => {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return error.code === '42703' || message.includes('share_scope')
}

const API_CACHE_TTL_MS = Number(process.env.API_CACHE_TTL_MS || 7000)
const apiCache = new Map()

const getCachedJson = (key) => {
  const cached = apiCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    apiCache.delete(key)
    return null
  }
  return cached.value
}

const setCachedJson = (key, value, ttl = API_CACHE_TTL_MS) => {
  apiCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(0, ttl),
  })
}

const clearApiCache = () => {
  apiCache.clear()
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/auth/me', authRequired, async (req, res) => {
  const { data, error } = await req.supabase
    .schema('public')
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .maybeSingle()

  if (error) {
    sendError(res, error)
    return
  }

  if (!data) {
    const fallbackProfile = {
      id: req.user.id,
      email: req.user.email || '',
      username: req.user.user_metadata?.username || (req.user.email || '').split('@')[0] || 'user',
    }
    const { data: upserted, error: upsertError } = await req.supabase
      .schema('public')
      .from('profiles')
      .upsert(fallbackProfile)
      .select('*')
      .single()

    if (upsertError) {
      sendError(res, upsertError)
      return
    }

    res.json(upserted)
    return
  }

  res.json(data)
})

app.patch('/api/auth/me', authRequired, async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const profileImageRaw = req.body?.profile_image

  if (!username) {
    res.status(400).json({ message: 'username is required' })
    return
  }

  const patch = {
    id: req.user.id,
    email: req.user.email || '',
    username,
    profile_image: profileImageRaw ? String(profileImageRaw).trim() : null,
  }

  const { data, error } = await req.supabase
    .schema('public')
    .from('profiles')
    .upsert(patch, { onConflict: 'id' })
    .select('*')
    .single()

  if (error) {
    sendError(res, error)
    return
  }
  res.json(data)
})

app.get('/api/folders', authRequired, async (req, res) => {
  const { data, error } = await req.supabase
    .from('folders')
    .select('*, voca_sets(id)')
    .order('created_at', { ascending: false })

  if (error) {
    sendError(res, error)
    return
  }
  res.json(data || [])
})

app.post('/api/folders', authRequired, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) {
    res.status(400).json({ message: 'name is required' })
    return
  }

  const { data, error } = await req.supabase
    .from('folders')
    .insert({ user_id: req.user.id, name })
    .select('*')
    .single()

  if (error) {
    sendError(res, error)
    return
  }
  res.status(201).json(data)
})

app.patch('/api/folders/:id', authRequired, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) {
    res.status(400).json({ message: 'name is required' })
    return
  }

  const { error } = await req.supabase
    .from('folders')
    .update({ name })
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.json({ ok: true })
})

app.delete('/api/folders/:id', authRequired, async (req, res) => {
  const { error } = await req.supabase
    .from('folders')
    .delete()
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.status(204).end()
})

app.get('/api/community/vocas', authRequired, async (req, res) => {
  const cached = getCachedJson('community:v1')
  if (cached) {
    res.json(cached)
    return
  }

  let communityRows = null
  let communityError = null

  ;({ data: communityRows, error: communityError } = await req.supabase
    .from('voca_sets')
    .select('*')
    .eq('share_scope', 'public')
    .order('updated_at', { ascending: false })
    .limit(120))

  if (communityError && isShareScopeColumnMissing(communityError)) {
    ;({ data: communityRows, error: communityError } = await req.supabase
      .from('voca_sets')
      .select('*')
      .eq('is_public', true)
      .order('updated_at', { ascending: false })
      .limit(120))
  }

  if (communityError) {
    sendError(res, communityError)
    return
  }

  const rows = communityRows || []
  const ownerIds = [...new Set(rows.map((item) => item.owner_id).filter(Boolean))]
  let ownerMap = new Map()

  if (ownerIds.length > 0) {
    const { data: profiles, error: profilesError } = await req.supabase
      .schema('public')
      .from('profiles')
      .select('id, username, email')
      .in('id', ownerIds)

    if (!profilesError && profiles) {
      ownerMap = new Map(
        profiles.map((profile) => [profile.id, { username: profile.username, email: profile.email }])
      )
    }
  }

  const data = rows.map((row) => withShareScope({
    ...row,
    owner: ownerMap.get(row.owner_id),
  }))

  setCachedJson('community:v1', data)
  res.json(data)
})

app.get('/api/vocas', authRequired, async (req, res) => {
  const folderId = req.query.folderId

  if (folderId) {
    const { data, error } = await req.supabase
      .from('voca_sets')
      .select('*')
      .eq('folder_id', folderId)
      .order('updated_at', { ascending: false })

    if (error) {
      sendError(res, error)
      return
    }
    res.json((data || []).map(withShareScope))
    return
  }

  const [{ data: owned, error: ownedError }, { data: links, error: linksError }] = await Promise.all([
    req.supabase
      .from('voca_sets')
      .select('*')
      .eq('owner_id', req.user.id)
      .order('updated_at', { ascending: false }),
    req.supabase
      .from('voca_collaborators')
      .select('voca_id')
      .eq('user_id', req.user.id),
  ])

  if (ownedError) {
    sendError(res, ownedError)
    return
  }
  if (linksError) {
    sendError(res, linksError)
    return
  }

  const collaboratorVocaIds = (links || []).map((item) => item.voca_id)
  let collaborated = []
  if (collaboratorVocaIds.length > 0) {
    const { data, error } = await req.supabase
      .from('voca_sets')
      .select('*')
      .in('id', collaboratorVocaIds)

    if (error) {
      sendError(res, error)
      return
    }
    collaborated = data || []
  }

  const merged = [...(owned || []), ...collaborated]
  const deduped = Array.from(new Map(merged.map((voca) => [voca.id, voca])).values())
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  res.json(deduped.map(withShareScope))
})

app.get('/api/vocas/:id', authRequired, async (req, res) => {
  const { data, error } = await req.supabase
    .from('voca_sets')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle()

  if (error) {
    sendError(res, error)
    return
  }
  if (!data) {
    res.status(404).json({ message: 'Not found' })
    return
  }
  res.json(withShareScope(data))
})

app.get('/api/shared/:shareToken', async (req, res) => {
  const cacheKey = `shared:${req.params.shareToken}`
  const cached = getCachedJson(cacheKey)
  if (cached) {
    res.json(cached)
    return
  }

  let data = null
  let error = null

  ;({ data, error } = await publicSupabase
    .from('voca_sets')
    .select('*')
    .eq('share_token', req.params.shareToken)
    .in('share_scope', ['public', 'unlisted'])
    .maybeSingle())

  if (error && isShareScopeColumnMissing(error)) {
    ;({ data, error } = await publicSupabase
      .from('voca_sets')
      .select('*')
      .eq('share_token', req.params.shareToken)
      .eq('is_public', true)
      .maybeSingle())
  }

  if (error) {
    sendError(res, error)
    return
  }
  if (!data) {
    res.status(404).json({ message: 'Not found' })
    return
  }

  let owner = null
  if (data.owner_id) {
    const { data: ownerProfile, error: ownerError } = await publicSupabase
      .schema('public')
      .from('profiles')
      .select('id, username, email')
      .eq('id', data.owner_id)
      .maybeSingle()

    if (!ownerError && ownerProfile) {
      owner = { username: ownerProfile.username, email: ownerProfile.email }
    }
  }

  const responseData = withShareScope({ ...data, owner })
  setCachedJson(cacheKey, responseData)
  res.json(responseData)
})

app.get('/api/vocas/:id/role', authRequired, async (req, res) => {
  const { data: voca, error: vocaError } = await req.supabase
    .from('voca_sets')
    .select('owner_id')
    .eq('id', req.params.id)
    .maybeSingle()

  if (vocaError) {
    sendError(res, vocaError)
    return
  }
  if (!voca) {
    res.status(404).json({ message: 'Not found' })
    return
  }
  if (voca.owner_id === req.user.id) {
    res.json({ role: 'owner' })
    return
  }

  const { data: collaborator, error } = await req.supabase
    .from('voca_collaborators')
    .select('role')
    .eq('voca_id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle()

  if (error) {
    sendError(res, error)
    return
  }
  res.json({ role: collaborator?.role || null })
})

app.post('/api/vocas', authRequired, async (req, res) => {
  const title = String(req.body?.title || '').trim()
  if (!title) {
    res.status(400).json({ message: 'title is required' })
    return
  }

  const payload = {
    owner_id: req.user.id,
    folder_id: req.body?.folder_id || null,
    title,
    description: String(req.body?.description || ''),
    share_scope: normalizeShareScope(req.body?.share_scope, Boolean(req.body?.is_public)),
    is_public: deriveIsPublic(normalizeShareScope(req.body?.share_scope, Boolean(req.body?.is_public))),
  }

  let { data, error } = await req.supabase
    .from('voca_sets')
    .insert(payload)
    .select('id')
    .single()

  if (error && isShareScopeColumnMissing(error)) {
    const { share_scope, ...legacyPayload } = payload
    ;({ data, error } = await req.supabase
      .from('voca_sets')
      .insert(legacyPayload)
      .select('id')
      .single())
  }

  if (error) {
    sendError(res, error)
    return
  }
  clearApiCache()
  res.status(201).json(data)
})

app.patch('/api/vocas/:id', authRequired, async (req, res) => {
  const hasShareSetting = req.body?.share_scope !== undefined || req.body?.is_public !== undefined
  const nextShareScope = hasShareSetting
    ? normalizeShareScope(req.body?.share_scope, Boolean(req.body?.is_public))
    : undefined

  const patch = {
    title: req.body?.title,
    description: req.body?.description,
    folder_id: req.body?.folder_id === undefined ? undefined : req.body.folder_id || null,
    share_scope: nextShareScope,
    is_public: nextShareScope === undefined ? undefined : deriveIsPublic(nextShareScope),
    updated_at: new Date().toISOString(),
  }

  Object.keys(patch).forEach((key) => patch[key] === undefined && delete patch[key])

  let { error } = await req.supabase
    .from('voca_sets')
    .update(patch)
    .eq('id', req.params.id)

  if (error && isShareScopeColumnMissing(error)) {
    const { share_scope, ...legacyPatch } = patch
    ;({ error } = await req.supabase
      .from('voca_sets')
      .update(legacyPatch)
      .eq('id', req.params.id))
  }

  if (error) {
    sendError(res, error)
    return
  }
  clearApiCache()
  res.json({ ok: true })
})

app.delete('/api/vocas/:id', authRequired, async (req, res) => {
  const { error } = await req.supabase
    .from('voca_sets')
    .delete()
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  clearApiCache()
  res.status(204).end()
})

app.post('/api/vocas/:id/clone', authRequired, async (req, res) => {
  const originalId = req.params.id

  const { data: original, error: originalError } = await req.supabase
    .from('voca_sets')
    .select('*')
    .eq('id', originalId)
    .maybeSingle()

  if (originalError) {
    sendError(res, originalError)
    return
  }
  if (!original) {
    res.status(404).json({ message: 'Not found' })
    return
  }

  const clonePayload = {
    owner_id: req.user.id,
    folder_id: null,
    title: `${original.title} (복사본)`,
    description: original.description,
    share_scope: 'private',
    is_public: false,
  }

  let { data: newVoca, error: createError } = await req.supabase
    .from('voca_sets')
    .insert(clonePayload)
    .select('id')
    .single()

  if (createError && isShareScopeColumnMissing(createError)) {
    const { share_scope, ...legacyClonePayload } = clonePayload
    ;({ data: newVoca, error: createError } = await req.supabase
      .from('voca_sets')
      .insert(legacyClonePayload)
      .select('id')
      .single())
  }

  if (createError) {
    sendError(res, createError)
    return
  }

  const { data: words, error: wordsError } = await req.supabase
    .from('words')
    .select('word, meaning, pos, example')
    .eq('voca_id', originalId)

  if (wordsError) {
    sendError(res, wordsError)
    return
  }

  if (words && words.length > 0) {
    const payload = words.map((word) => ({ ...word, voca_id: newVoca.id }))
    const { error: insertError } = await req.supabase.from('words').insert(payload)
    if (insertError) {
      sendError(res, insertError)
      return
    }
  }

  clearApiCache()
  res.status(201).json({ id: newVoca.id })
})

app.get('/api/vocas/:id/words', authOptional, async (req, res) => {
  const { data, error } = await req.supabase
    .from('words')
    .select('*')
    .eq('voca_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) {
    sendError(res, error)
    return
  }
  res.json(data || [])
})

app.post('/api/vocas/:id/words', authRequired, async (req, res) => {
  const payload = {
    voca_id: req.params.id,
    word: String(req.body?.word || '').trim(),
    meaning: normalizeMeaningValue(req.body?.meaning),
    pos: String(req.body?.pos || ''),
    example: String(req.body?.example || ''),
  }
  if (!payload.word || !payload.meaning) {
    res.status(400).json({ message: 'word and meaning are required' })
    return
  }

  const { data, error } = await req.supabase
    .from('words')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    sendError(res, error)
    return
  }
  res.status(201).json(data)
})

app.post('/api/vocas/:id/words/bulk', authRequired, async (req, res) => {
  const words = Array.isArray(req.body?.words) ? req.body.words : []
  if (words.length === 0) {
    res.status(400).json({ message: 'words is required' })
    return
  }

  const payload = words
    .map((item) => ({
      voca_id: req.params.id,
      word: String(item.word || '').trim(),
      meaning: normalizeMeaningValue(item.meaning),
      pos: String(item.pos || ''),
      example: String(item.example || ''),
    }))
    .filter((item) => item.word && item.meaning)

  const { error } = await req.supabase.from('words').insert(payload)
  if (error) {
    sendError(res, error)
    return
  }
  res.json({ inserted: payload.length })
})

app.patch('/api/words/:id', authRequired, async (req, res) => {
  const patch = {
    word: req.body?.word,
    meaning: req.body?.meaning === undefined ? undefined : normalizeMeaningValue(req.body?.meaning),
    pos: req.body?.pos,
    example: req.body?.example,
  }
  Object.keys(patch).forEach((key) => patch[key] === undefined && delete patch[key])

  const { error } = await req.supabase
    .from('words')
    .update(patch)
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.json({ ok: true })
})

app.delete('/api/words/:id', authRequired, async (req, res) => {
  const { error } = await req.supabase
    .from('words')
    .delete()
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.status(204).end()
})

app.get('/api/vocas/:id/collaborators', authRequired, async (req, res) => {
  const { data, error } = await req.supabase
    .from('voca_collaborators')
    .select('id, user_id, voca_id, role, created_at, user:profiles!user_id(username, email)')
    .eq('voca_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) {
    sendError(res, error)
    return
  }
  res.json(data || [])
})

app.post('/api/vocas/:id/collaborators', authRequired, async (req, res) => {
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase()
  const role = req.body?.role === 'editor' ? 'editor' : 'viewer'

  if (!normalizedEmail) {
    res.status(400).json({ message: 'email is required' })
    return
  }

  const { data: profile, error: profileError } = await req.supabase
    .schema('public')
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (profileError) {
    sendError(res, profileError)
    return
  }
  if (!profile) {
    res.status(404).json({ message: '해당 이메일 사용자를 찾을 수 없습니다.' })
    return
  }
  if (profile.id === req.user.id) {
    res.status(400).json({ message: '본인은 초대할 수 없습니다.' })
    return
  }

  const { error } = await req.supabase
    .from('voca_collaborators')
    .upsert(
      { user_id: profile.id, voca_id: req.params.id, role },
      { onConflict: 'user_id,voca_id' }
    )

  if (error) {
    sendError(res, error)
    return
  }
  res.status(201).json({ ok: true })
})

app.patch('/api/collaborators/:id', authRequired, async (req, res) => {
  const role = req.body?.role === 'editor' ? 'editor' : 'viewer'
  const { error } = await req.supabase
    .from('voca_collaborators')
    .update({ role })
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.json({ ok: true })
})

app.delete('/api/collaborators/:id', authRequired, async (req, res) => {
  const { error } = await req.supabase
    .from('voca_collaborators')
    .delete()
    .eq('id', req.params.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.status(204).end()
})

const upsertWordProgress = async (supabase, userId, wordId, updateMode) => {
  const { data: existing, error: existingError } = await supabase
    .from('word_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('word_id', wordId)
    .maybeSingle()

  if (existingError) {
    return { error: existingError }
  }

  const now = new Date().toISOString()

  if (existing) {
    const next = { ...existing }
    if (updateMode.type === 'answer') {
      next.correct_count = updateMode.correct ? existing.correct_count + 1 : existing.correct_count
      next.wrong_count = updateMode.correct ? existing.wrong_count : existing.wrong_count + 1
    } else {
      if (updateMode.status === 'mastered') {
        next.correct_count = Math.max(existing.correct_count, existing.wrong_count + 1)
      } else if (updateMode.status === 'confused') {
        next.wrong_count = Math.max(existing.wrong_count, existing.correct_count + 1)
      } else {
        next.correct_count = 0
        next.wrong_count = 0
      }
    }
    next.last_reviewed_at = now

    const { error } = await supabase
      .from('word_progress')
      .update({
        correct_count: next.correct_count,
        wrong_count: next.wrong_count,
        last_reviewed_at: now,
      })
      .eq('id', existing.id)

    return { error }
  }

  const base = {
    user_id: userId,
    word_id: wordId,
    correct_count: 0,
    wrong_count: 0,
    last_reviewed_at: now,
  }
  if (updateMode.type === 'answer') {
    base.correct_count = updateMode.correct ? 1 : 0
    base.wrong_count = updateMode.correct ? 0 : 1
  } else if (updateMode.status === 'mastered') {
    base.correct_count = 1
  } else if (updateMode.status === 'confused') {
    base.wrong_count = 1
  }

  const { error } = await supabase.from('word_progress').insert(base)
  return { error }
}

app.post('/api/study/answer', authRequired, async (req, res) => {
  const wordId = String(req.body?.wordId || '')
  const correct = Boolean(req.body?.correct)

  if (!wordId) {
    res.status(400).json({ message: 'wordId is required' })
    return
  }

  const { error } = await upsertWordProgress(req.supabase, req.user.id, wordId, { type: 'answer', correct })
  if (error) {
    sendError(res, error)
    return
  }
  res.json({ ok: true })
})

app.post('/api/study/undo-answer', authRequired, async (req, res) => {
  const wordId = String(req.body?.wordId || '')
  const correct = Boolean(req.body?.correct)

  if (!wordId) {
    res.status(400).json({ message: 'wordId is required' })
    return
  }

  const { data: existing, error: existingError } = await req.supabase
    .from('word_progress')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('word_id', wordId)
    .maybeSingle()

  if (existingError) {
    sendError(res, existingError)
    return
  }
  if (!existing) {
    res.json({ ok: true })
    return
  }

  const nextCorrect = Math.max(existing.correct_count - (correct ? 1 : 0), 0)
  const nextWrong = Math.max(existing.wrong_count - (correct ? 0 : 1), 0)
  const { error } = await req.supabase
    .from('word_progress')
    .update({
      correct_count: nextCorrect,
      wrong_count: nextWrong,
      last_reviewed_at: new Date().toISOString(),
    })
    .eq('id', existing.id)

  if (error) {
    sendError(res, error)
    return
  }
  res.json({ ok: true })
})

app.post('/api/study/mark', authRequired, async (req, res) => {
  const wordId = String(req.body?.wordId || '')
  const status = req.body?.status === 'mastered'
    ? 'mastered'
    : req.body?.status === 'confused'
      ? 'confused'
      : req.body?.status === 'new'
        ? 'new'
        : null

  if (!wordId || !status) {
    res.status(400).json({ message: 'wordId and status are required' })
    return
  }

  const { error } = await upsertWordProgress(req.supabase, req.user.id, wordId, { type: 'mark', status })
  if (error) {
    sendError(res, error)
    return
  }
  res.json({ ok: true })
})

app.post('/api/study/sessions', authRequired, async (req, res) => {
  const payload = {
    user_id: req.user.id,
    voca_id: String(req.body?.vocaId || ''),
    mode: req.body?.mode,
    score: Number(req.body?.score || 0),
    total: Number(req.body?.total || 0),
    duration: Number(req.body?.duration || 0),
  }

  if (!payload.voca_id || !payload.mode) {
    res.status(400).json({ message: 'vocaId and mode are required' })
    return
  }

  const { error } = await req.supabase.from('study_sessions').insert(payload)
  if (error) {
    sendError(res, error)
    return
  }
  res.status(201).json({ ok: true })
})

app.get('/api/study/progress', authRequired, async (req, res) => {
  const rawWordIds = String(req.query.wordIds || '')
  const wordIds = rawWordIds.split(',').map((item) => item.trim()).filter(Boolean)
  if (wordIds.length === 0) {
    res.json([])
    return
  }

  const { data, error } = await req.supabase
    .from('word_progress')
    .select('*')
    .eq('user_id', req.user.id)
    .in('word_id', wordIds)

  if (error) {
    sendError(res, error)
    return
  }
  res.json(data || [])
})

app.get('/api/study/sessions', authRequired, async (req, res) => {
  const vocaId = String(req.query.vocaId || '')
  if (!vocaId) {
    res.status(400).json({ message: 'vocaId is required' })
    return
  }

  const { data, error } = await req.supabase
    .from('study_sessions')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('voca_id', vocaId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    sendError(res, error)
    return
  }
  res.json(data || [])
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ message: 'Internal server error' })
})

app.listen(Number(PORT), () => {
  console.log(`Backend API listening on http://localhost:${PORT}`)
})
