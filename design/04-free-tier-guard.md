# Cloudflare Free-Tier Guard

## Goal

Keep account usage below the D1 and R2 free-tier limits.

## Usage data

- Cloudflare GraphQL: daily D1 rows and 30-day R2 operations
- Cloudflare REST API: total D1 and R2 storage
- Account-wide totals: all databases and buckets
- One-minute cache: fewer usage requests
- Local development: summed local R2 objects with a 100 MB limit

## Cutoff

Storage work stops at 80% of each free limit.

| Limit                 |                Cutoff |
| --------------------- | --------------------: |
| D1 rows read          |     4,000,000 per day |
| D1 rows written       |        80,000 per day |
| D1 storage            |                  4 GB |
| R2 Class A operations |   800,000 per 30 days |
| R2 Class B operations | 8,000,000 per 30 days |
| R2 storage            |                  8 GB |

Any R2 Infrequent Access data blocks writes because that storage class has no free allowance.

## Request checks

- Note read: R2 Class B
- Synchronization: D1 reads and writes; possible R2 rebuild work
- Note write or delete: all related D1 and R2 limits
- Health check: no usage check
- Local development: R2 writes use the same 80% cutoff against the local limit

## Failure behavior

- Missing account ID or token: `500 usage_not_configured`
- Unavailable or unknown usage data: `503 usage_unavailable`
- Cutoff reached: `503 free_tier_limit_near`
- No storage action after a failed check

## Security

- Read-only Cloudflare API token
- Worker secret only
- No token sent to the browser

## Accuracy

Cloudflare analytics may be delayed or sampled. The 20% margin reduces this risk. Unknown R2 operation types fail closed.

The rolling 30-day R2 count is conservative. It may block work longer than the current billing period.
