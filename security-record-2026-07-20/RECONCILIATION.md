# FreshUp security review — 2026-07-20

Project: **freshup-v1** (`dptltpvmqinzjrgjefoe`)  
Branch: `milestone-6` @ `183e94849484e53371f97189f31a097d01be6bbb`  
Org (CLI): `munib's fresh up v0 supabase project` (`vercel_icfg_wmLmJiA0rwLcol9Ez9GtXJ0G`)

---

## A. Immediate remediation (done)

| Item | Action | Verification |
|------|--------|----------------|
| OTP logging | Secret `SMS_DEV_LOG_OTP` set to `false` | Successful OTP send produces **no** `[DEV] OTP` log line |
| `provider-onboard` | Deny stub deployed; `verify_jwt=true` | Unauthenticated POST → **HTTP 401** `UNAUTHORIZED_NO_AUTH_HEADER` |

### Function versions

| Function | Before | After | Notes |
|----------|--------|-------|--------|
| `provider-onboard` | v**6** (2026-07-20 11:31:10 UTC) | v**7** (2026-07-20 11:35:59 UTC) | Vulnerable source saved in `provider-onboard.index.ts.before-disable` |
| `send-sms-hook` | v**9** (2026-06-20 17:38:20 UTC) | unchanged | JWT off (Auth webhook) — expected |
| `dispatch-tick-cron` | v**9** (2026-06-20 17:38:20 UTC) | unchanged | JWT still off — inbound auth still open (known follow-up) |

Artifacts:

- `provider-onboard.index.ts.before-disable` — pre-remediation source (security record)
- `deployed/*.deployed.ts` — downloaded from project after remediation / as of 2026-07-20

---

## B. Deployed-source reconciliation

SHA-256 comparison (2026-07-20):

| Function | Deployed version | Deployed SHA-256 | Git `HEAD` on `milestone-6` | Match? |
|----------|------------------|------------------|-------------------------------|--------|
| `provider-onboard` | v7 (stub) | `cddca552…c2b92` | stub in working tree = same | **Yes** (post-fix). Pre-fix vulnerable ≠ stub (`19a56ac6…`) |
| `send-sms-hook` | v9 | `c27649ef…2e2892` | identical | **Yes** |
| `dispatch-tick-cron` | v9 | `c6802c0c…e7a0d` | Git HEAD `bd9a7980…` | **No — drift** |

### `dispatch-tick-cron` drift detail

Deployed v9 includes extra `console.log` start/response logging that is **not** in `milestone-6` Git `HEAD`. Behaviour (call `/api/orders/dispatch_tick` with `x-dispatch-secret`) is the same; logging differs.

**Follow-up:** either (1) commit the deployed logging into Git and re-deploy for parity, or (2) redeploy from Git HEAD so deployed matches the branch. Until then, Git alone is not byte-identical to deployed for this function.

### Deploy timestamps vs Git

| Function | Last deploy (UTC) | Implication |
|----------|-------------------|-------------|
| `send-sms-hook` / `dispatch-tick-cron` | 2026-06-20 | Deployed from a machine on that date; later Git edits to `dispatch-tick-cron` may not all be live |
| `provider-onboard` | 2026-07-20 (v6 then v7) | v6 was the vulnerable build; v7 is the disable stub |

---

## C. SQL Editor / non-migration review

### Migration history (CLI `supabase migration list --linked`)

| Check | Result |
|-------|--------|
| Local migration files | **75** |
| Remote applied versions | **75** |
| Local-only | **0** |
| Remote-only | **0** |
| Version mismatches | **0** |

Remote migration history currently **matches** `milestone-6` migration filenames/versions.

### Repo evidence of intentional SQL Editor / one-off scripts

These are **in the repo for manual use**; CLI **cannot prove** whether each was executed on production:

| Path | Purpose |
|------|---------|
| `supabase/manual/boost_provider_tier_8a086479.sql` | One-off: force provider tier/offers/orders stats for a specific UUID (demo/boost) |
| `supabase/manual/dispatch_tick_vault_secrets.sql` | Helper to set Vault secrets for dispatch cron |
| `supabase/snippets/Untitled query *.sql` | Local editor snippets (not authoritative) |

### What we could **not** fully prove from CLI alone

Supabase **does not expose a complete SQL Editor audit trail** via the CLI used here. To finish this for Munib:

1. Dashboard → **Project Settings → Audit / Team activity** (if available on the plan)  
2. Dashboard → **SQL Editor → History** (per user who has access)  
3. Confirm who ran `boost_provider_tier_8a086479.sql` (if anyone) and whether that provider UUID is still gold-boosted in prod  

**No `supabase migration repair` evidence** was found in prior review; this pass reconfirms migration list parity only.

---

## D. Permission & machine review

### Machines (from prior deployment metadata + this environment)

| Actor | Evidence | Path style |
|-------|----------|------------|
| **Umer Iqbal** | Deploy metadata: `/Users/Umer Iqbal/Documents/GitHub/FreshUp-v0/` | **macOS/Unix** (not Windows — “Windows” in an earlier client reply was a misstatement) |
| **This machine (Waheed / current)** | Local checkout `/Users/muhammadrasheed/Documents/GitHub/FreshUp-v0`; CLI linked to `dptltpvmqinzjrgjefoe` | macOS |

### Git authors on this repo (no “Umer” commit identity)

Unique authors seen in `git log`:

- Waheed Shabeer / waheedshabeer / MKDev / hamad-dev / ateeb / Munib Hadi (Jr.) / v0 / vercel  

**Umer Iqbal does not appear as a Git commit author.** Deployment path still proves at least one Edge Function deploy from his macOS checkout. Repo history alone cannot establish his Supabase/GitHub roles.

### Supabase access (what CLI shows on this account)

Logged-in CLI can see org **`munib's fresh up v0 supabase project`** and linked project **`freshup-v1`**. This account can deploy functions and list migrations — i.e. **elevated developer access**. Exact role label (Owner / Admin / Developer) must be read from Dashboard → **Organization → Team**.

### Required Dashboard checks (cannot complete from this shell; `gh` CLI not installed here)

Please verify and attach screenshots/exports:

**Supabase**

1. Org members for `munib's fresh up v0 supabase project` — Waheed, Umer, Munib, others + roles  
2. Project `freshup-v1` access list  
3. Who can edit Edge Function secrets / deploy functions  
4. SQL Editor history for both Waheed and Umer accounts  

**GitHub**

1. Repo collaborators / team roles for FreshUp-v0  
2. Whether Umer has write/admin  
3. Deploy keys / Actions secrets access  

**Vercel / hosting** (if applicable)

1. Who can deploy production  

---

## E. Remaining security follow-ups (not done in this pass)

1. **`dispatch-tick-cron` inbound auth** — still `verify_jwt=false`; public invoke can trigger ticks (downstream still needs `DISPATCH_TICK_SECRET`). Add shared-secret or JWT check on the Edge Function itself.  
2. **Reconcile `dispatch-tick-cron` Git ↔ deployed** (commit logging or redeploy from Git).  
3. **Proper JWT-authenticated `provider-onboard`** before re-enabling (or keep disabled permanently and rely on `/api/providers/onboard`).  
4. Complete **Team / GitHub permission screenshots** for both developers.  

---

## F. Summary for Munib

| Area | Status |
|------|--------|
| OTP logging | **Remediated** (`SMS_DEV_LOG_OTP=false`) |
| `provider-onboard` exposure | **Remediated** (v7 deny stub + JWT) |
| Migration list vs `milestone-6` | **Aligned** (75/75) |
| Deployed ↔ Git for `send-sms-hook` | **Match** |
| Deployed ↔ Git for `dispatch-tick-cron` | **Drift** (extra logging on deployed) |
| SQL Editor full audit | **Partial** — scripts identified; Dashboard history still required |
| Umer machine | **macOS path**; permissions **not** fully verified from Git alone |
| Dual-account permission matrix | **Needs Dashboard / GitHub confirmation** |
