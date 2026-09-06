# Cloudflare Free-Tier Guard

## Goal

Provide a best-effort safeguard against exceeding the D1, R2, and Durable Objects free-tier limits.

## Usage data

- Cloudflare GraphQL: daily D1 rows, 30-day R2 operations, and daily Durable Object compute
- Cloudflare REST API: total D1 and R2 storage
- Account-wide totals: all databases, buckets, and Durable Object namespaces
- One-minute cache: fewer usage requests
- Local development: summed local R2 objects with a 100 MB limit

## Cutoff

Guarded work stops at 80% of each free limit.

| Limit                   |                Cutoff |
| ----------------------- | --------------------: |
| D1 rows read            |     4,000,000 per day |
| D1 rows written         |        80,000 per day |
| D1 storage              |                  4 GB |
| R2 Class A operations   |   800,000 per 30 days |
| R2 Class B operations   | 8,000,000 per 30 days |
| R2 storage              |                  8 GB |
| Durable Object requests |        80,000 per day |
| Durable Object duration |       10,400 GB-s/day |

Any R2 Infrequent Access data blocks writes because that storage class has no free allowance.

## Request checks

- Note read: R2 Class B
- Synchronization: D1 reads and writes; possible R2 rebuild work
- Automatic sync wait: normal synchronization limits plus Durable Object requests and duration
- Note write or delete: all related D1 and R2 limits
- Health check: no usage check
- Local development: R2 writes use the same 80% cutoff against the local limit

## Failure behavior

- Missing account ID or token: `500 usage_not_configured`
- Usage retrieval failures: `503 usage_unavailable`
- Unrecognized R2 operations: warn and exclude from totals without blocking synchronization
- Cutoff reached: `503 free_tier_limit_near`
- Durable Object cutoff reached: waits return `429 auto_sync_paused` and writes skip notifications until 00:00 UTC; writes and manual sync remain available
- No storage action after a failed check

## Security

- Read-only Cloudflare API token
- Worker secret only
- No token sent to the browser

## Accuracy

Cloudflare analytics may be delayed or sampled. The 20% margin reduces this risk.

Unknown R2 operation types are logged but do not block synchronization, so new analytics names cannot disable the app. If an unknown operation is billable, totals may undercount usage. This guard is not a guarantee against charges.

The rolling 30-day R2 count is conservative. It may block work longer than the current billing period.
