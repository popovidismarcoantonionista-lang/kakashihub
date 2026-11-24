import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.mjs'

const { Pool } = pg

// Senhas do Supabase podem conter #, /, @, %, colchetes etc. Aceitar a URL
// como foi colada (crua ou já codificada) evita "Invalid URL" no driver.
export function normalizeConnectionString(raw) {
  const value = String(raw || '').trim()
  if (!value) return value
  const scheme = value.match(/^postgres(?:ql)?:\/\//i)
  if (!scheme) return value
  const body = value.slice(scheme[0].length)
  const at = body.lastIndexOf('@')
  if (at < 0) return value
  const credentials = body.slice(0, at)
  const host = body.slice(at + 1)
  const colon = credentials.indexOf(':')
  if (colon < 0) return value
  const user = credentials.slice(0, colon)
  let password = credentials.slice(colon + 1)
  if (password.startsWith('[') && password.endsWith(']')) password = password.slice(1, -1)
  try { password = decodeURIComponent(password) } catch {}
  return `${scheme[0]}${user}:${encodeURIComponent(password)}@${host}`
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL || process.env.POSTGRES_URL)

export const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  max: 4,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
})

export const db = drizzle(pool, { schema })
