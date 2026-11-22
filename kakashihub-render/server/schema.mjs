import { bigint, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const fugaState = pgTable('fuga_state', {
  id: text('id').primaryKey(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const fugaJobs = pgTable('fuga_jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  sourceId: text('source_id'),
  clipId: text('clip_id'),
  workflowRunId: text('workflow_run_id'),
  status: text('status').notNull(),
  progress: integer('progress').notNull().default(0),
  step: text('step'),
  error: text('error'),
  log: jsonb('log').notNull().default([]),
  payload: jsonb('payload').notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
