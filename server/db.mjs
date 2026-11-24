import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.mjs'

const { Pool } = pg

export const connectionInfo = {
  configured: false,
  schemeOk: false,
  normalized: false,
  urlOk: false,
  urlError: '',
  hostOk: false,
  portOk: false,
  controlChars: [],
  shape: '',
  atCount: 0,
  credentialsColon: false,
}

// Senhas do Supabase podem conter #, /, @, %, colchetes etc. Aceitar a URL
// como foi colada (crua ou já codificada) evita "Invalid URL" no driver.
export function normalizeConnectionString(raw) {
  let value = String(raw || '').trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim()
  }
  connectionInfo.configured = Boolean(value)
  connectionInfo.schemeOk = /^postgres(?:ql)?:\/\//i.test(value)
  if (!value) return value
  const scheme = value.match(/^postgres(?:ql)?:\/\//i)
  if (!scheme) return value
  const body = value.slice(scheme[0].length)
  const at = body.lastIndexOf('@')
  connectionInfo.atCount = (body.match(/@/g) || []).length
  if (at < 0) return value
  const credentials = body.slice(0, at)
  const host = body.slice(at + 1).replace(/[\s\x00-\x1F\x7F]/g, '')
  const colon = credentials.indexOf(':')
  connectionInfo.credentialsColon = colon >= 0
  if (colon < 0) return value
  const user = credentials.slice(0, colon)
  let password = credentials.slice(colon + 1)
  if (password.startsWith('[') && password.endsWith(']')) password = password.slice(1, -1)
  try { password = decodeURIComponent(password) } catch {}
  const normalized = `${scheme[0]}${user}:${encodeURIComponent(password)}@${host}`
  connectionInfo.normalized = normalized !== value
  return normalized
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL || process.env.POSTGRES_URL)

// Diagnóstico sem expor a senha: só códigos de caracteres suspeitos e validade
// estrutural da URL que o driver vai receber.
connectionInfo.controlChars = [...new Set(
  Array.from(connectionString || '')
    .filter((c) => /[\x00-\x1F\x7F]/.test(c))
    .map((c) => c.charCodeAt(0)),
)]
connectionInfo.shape = String(connectionString || '').replace(/[A-Za-z0-9]/g, '*')
try {
  const parsed = new URL(connectionString)
  connectionInfo.urlOk = true
  connectionInfo.hostOk = /^[a-z0-9.-]+$/i.test(parsed.hostname)
  connectionInfo.portOk = !parsed.port || /^\d+$/.test(parsed.port)
} catch (error) {
  connectionInfo.urlError = String(error?.message || error).slice(0, 120)
}

export const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  max: 4,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
})

export const db = drizzle(pool, { schema })
