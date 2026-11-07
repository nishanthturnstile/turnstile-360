import { boolean, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { session, user } from './auth.generated.ts';

const central = pgSchema('control_plane');
export const staff = central.table('staff', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  role: text('role').notNull(),
  active: boolean('active').notNull().default(true),
  revision: integer('revision').notNull().default(1),
});
export const staffSession = central.table('staff_session', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => session.id, { onDelete: 'cascade' }),
  mfaAt: timestamp('mfa_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
});
export const audit = central.table('staff_audit', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  subjectId: text('subject_id').notNull(),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
