# Security record — 2026-07-20

## Before disable (deployed)

| Field | Value |
|-------|--------|
| Project | freshup-v1 (`dptltpvmqinzjrgjefoe`) |
| Function | `provider-onboard` |
| Status | ACTIVE |
| Version | **6** |
| Updated (UTC) | 2026-07-20 11:31:10 |
| ID | `b254831c-0a3d-4050-b0d6-a5186ece684e` |
| Issue | `verify_jwt=false`, trusted `x-provider-id`, service role writes |

Local source snapshot before stub replace:
`provider-onboard.index.ts.before-disable`

## OTP logging

| Secret | Action |
|--------|--------|
| `SMS_DEV_LOG_OTP` | Set to `false` (Dashboard) — verified: successful OTP sends no longer log the code |

## After disable

| Field | Value |
|-------|--------|
| Version | **7** |
| Updated (UTC) | 2026-07-20 11:35:59 |
| verify_jwt | **true** |
| Git commit (local at deploy) | `183e94849484e53371f97189f31a097d01be6bbb` |
| Behaviour | No auth → **HTTP 401** `UNAUTHORIZED_NO_AUTH_HEADER`. Stub returns **410** if reached with a valid user JWT. No service-role writes. |
| Repo stub | `supabase/functions/provider-onboard/index.ts` |

## Follow-on reviews (this folder)

| Document | Contents |
|----------|----------|
| [RECONCILIATION.md](./RECONCILIATION.md) | Deployed Edge Function sources vs Git; migration parity; summary for Munib |
| [SQL-EDITOR-REVIEW.md](./SQL-EDITOR-REVIEW.md) | Migration list + manual/snippet SQL catalog; Dashboard history checklist |
| [PERMISSIONS-REVIEW.md](./PERMISSIONS-REVIEW.md) | Machine evidence (Waheed + Umer macOS); org/GitHub role matrix to complete |
| `deployed/*.deployed.ts` | Downloaded live sources as of 2026-07-20 |
| `provider-onboard.index.ts.before-disable` | Vulnerable pre-remediation source |

**Note:** Cursor Supabase MCP in this environment is linked to a **different** project (`uluuwvqerbkafqdhbmfo`), not FreshUp. Use CLI `--project-ref dptltpvmqinzjrgjefoe` / Dashboard for FreshUp facts.
