import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envCandidates = [
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
]

envCandidates.forEach((envPath) => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
})

export const env = {
  PORT: process.env.PORT || '4000',
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  FRONTEND_ORIGINS: process.env.FRONTEND_ORIGINS || '',
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || 'molip_token',
  AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN || '',
  AUTH_COOKIE_MAX_AGE_MS: process.env.AUTH_COOKIE_MAX_AGE_MS || String(1000 * 60 * 60 * 24 * 7),
  AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE || '',
}

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
}

