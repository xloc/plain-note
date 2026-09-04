import type { ServerIssue } from '../shared/note'

const CLEANUP_FAILED = 'resource_cleanup_failed'

export async function recordCleanupFailure(db: D1Database) {
  await ensureIssues(db)
  await db
    .prepare(`INSERT INTO server_issues (code, last_occurred_at, occurrences)
      VALUES (?, ?, 1)
      ON CONFLICT(code) DO UPDATE SET
        last_occurred_at = excluded.last_occurred_at,
        occurrences = occurrences + 1`)
    .bind(CLEANUP_FAILED, Date.now())
    .run()
}

export async function clearCleanupFailure(db: D1Database) {
  await ensureIssues(db)
  await db.prepare('DELETE FROM server_issues WHERE code = ?').bind(CLEANUP_FAILED).run()
}

export async function getServerIssues(db: D1Database) {
  await ensureIssues(db)
  const result = await db
    .prepare(`SELECT code, last_occurred_at AS lastOccurredAt, occurrences
      FROM server_issues
      ORDER BY last_occurred_at DESC`)
    .all<ServerIssue>()
  return result.results
}

async function ensureIssues(db: D1Database) {
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS server_issues (
      code TEXT PRIMARY KEY,
      last_occurred_at INTEGER NOT NULL,
      occurrences INTEGER NOT NULL
    )`)
    .run()
}
