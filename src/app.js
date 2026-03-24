import cors from 'cors'
import express from 'express'
import cookieParser from 'cookie-parser'
import { env } from './config/env.js'
import { createSupabaseClientFactory } from './lib/supabase.js'
import {
  normalizeShareScope,
  deriveIsPublic,
  normalizeMeaningValue,
  withShareScope,
  isShareScopeColumnMissing,
} from './lib/share.js'
import { createApiCache } from './lib/cache.js'
import { sendError } from './lib/errors.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { createResolveVocaAccess } from './lib/access.js'
import { registerApiRoutes } from './routes/apiRoutes.js'

const app = express()

const {
  createSupabaseClient,
  publicSupabase,
  createUserClient,
} = createSupabaseClientFactory({
  supabaseUrl: env.SUPABASE_URL,
  anonKey: env.SUPABASE_ANON_KEY,
})

const adminSupabase = env.SUPABASE_SERVICE_ROLE_KEY
  ? createSupabaseClient({ key: env.SUPABASE_SERVICE_ROLE_KEY })
  : publicSupabase

const {
  authRequired,
  authOptional,
  setAuthCookie,
  clearAuthCookie,
} = createAuthMiddleware({
  publicSupabase,
  createUserClient,
  authCookieName: env.AUTH_COOKIE_NAME,
  authCookieDomain: env.AUTH_COOKIE_DOMAIN,
  authCookieMaxAgeMs: env.AUTH_COOKIE_MAX_AGE_MS,
  authCookieSecure: env.AUTH_COOKIE_SECURE,
})

const resolveVocaAccess = createResolveVocaAccess({
  normalizeShareScope,
  deriveIsPublic,
})

const { getCachedJson, setCachedJson, clearApiCache } = createApiCache(
  Number(process.env.API_CACHE_TTL_MS || 7000)
)

const allowedOrigins = (env.FRONTEND_ORIGINS || env.FRONTEND_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.set('trust proxy', 1)
app.use(cookieParser())
app.use(express.json())

registerApiRoutes(app, {
  publicSupabase,
  adminSupabase,
  authRequired,
  authOptional,
  setAuthCookie,
  clearAuthCookie,
  sendError,
  normalizeShareScope,
  deriveIsPublic,
  normalizeMeaningValue,
  withShareScope,
  isShareScopeColumnMissing,
  getCachedJson,
  setCachedJson,
  clearApiCache,
  resolveVocaAccess,
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ message: 'Internal server error' })
})

export { app }
