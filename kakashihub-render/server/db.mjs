import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.mjs'

const { Pool } = pg
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL

export const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  max: 4,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
})

export const db = drizzle(pool, { schema })
