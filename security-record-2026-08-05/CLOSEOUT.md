# Security / ops closeout — 2026-08-05

Project: **freshup-v1** (`dptltpvmqinzjrgjefoe`)  
Continues: `security-record-2026-07-20/`

---

## 1. Edge Function parity

### Method
- Live list (CLI, earlier this session) + export archives from 20 July
- `dispatch-tick-cron` redeployed from this branch on **2026-08-05 12:00:41 UTC** → **v16** (`--no-verify-jwt`, inbound secret in source)
- Body re-download via Management API is intermittently **Forbidden** on this CLI token (list/deploy sometimes work; `/body` often does not). Parity for SMS/onboard therefore rests on July export SHA vs current Git; `dispatch-tick-cron` rests on the 5 Aug deploy of Git HEAD.

### Results

| Function | July 20 export SHA-256 | Git HEAD SHA-256 (5 Aug) | Live metadata | Verdict |
|----------|------------------------|---------------------------|---------------|---------|
| `send-sms-hook` | `c27649ef…2892` | **identical** | ACTIVE (listed earlier as v14, updated 2026-06-20) | **Match** Git ↔ July export. Live body not re-downloaded today (API Forbidden). |
| `provider-onboard` | `cddca552…2b92` (v7 deny stub) | **identical** | ACTIVE (listed earlier v12, updated 2026-07-20 11:35:59) | **Match** Git ↔ July stub. Live body not re-downloaded today. |
| `dispatch-tick-cron` | `c6802c0c…7a0d` (v9, no inbound auth) | `bc8463b6…9eba` (**has** `x-dispatch-secret` inbound check) | Redeployed **v16 on 5 Aug** from Git HEAD | **Closed:** live deployed from current Git with inbound shared-secret auth. Diff vs July v9 is intentional (security fix). |

### Note for Munib
July inbound-auth gap on `dispatch-tick-cron` is **fixed and deployed**. Full byte-compare of SMS/onboard live bodies still needs Owner Dashboard download if CLI `/body` stays Forbidden.

---

## 2. SQL Editor / non-migration audit

### Migration list
Earlier successful pass this week showed local ↔ remote version IDs aligned through then-current migrations (including post–31 July / early August files when that list succeeded). Later CLI sessions hit intermittent `login-role` **Forbidden** / need `SUPABASE_DB_PASSWORD` — reconfirm with Owner CLI if needed.

### Repo one-offs (still not “migrations”)
| Path | Risk |
|------|------|
| `supabase/manual/boost_provider_tier_8a086479.sql` | High if applied (forces Gold / fabricated stats) — ownership/intent still Owner Dashboard History |
| `supabase/manual/dispatch_tick_vault_secrets.sql` | Ops secrets helper |
| `supabase/snippets/Untitled query *.sql` | Read-oriented local snippets |

### Remaining (needs Dashboard, not CLI)
Per-user **SQL Editor → History** for CREATE/ALTER/DROP/boost UUID. CLI cannot export that trail.

`get_latest_offer_time` / `get_service_hierarchy_v2` `search_path` locked via migration `20260805130000_lock_search_path_security_definer.sql` (apply manually).

---

## 3. Umer Iqbal permissions

Marked **done by Waheed (5 Aug)** after Owner/Github verification outside this agent session. Detail table should live with Munib’s screenshots if retained.

Prior evidence still valid: path `/Users/Umer Iqbal/...` = **macOS**; Umer is **not** a Git commit author on this repo.

---

## 4. Machine security checklist (this checkout / machine)

| Check | Result (5 Aug) |
|--------|----------------|
| `tasks.json` / `runOn: folderOpen` | Clear |
| Unusual `.woff` outside Next deps/build | Clear |
| `package.json` preinstall/postinstall/prepare | Clear (root + mobile-app) |
| Active custom git hooks / Husky | Clear (samples only) |
| History-rewrite automation | Clear in source |
| `push-migrations.sh` | Present — intentional `supabase db push` helper, not covert rewrite |

---

## Summary for Munib (send as-is or paste)

Four July items — results as of 5 August:

1. **Edge parity** — SMS hook + onboard stub still SHA-match the 20 July exports in Git. `dispatch-tick-cron` was behind then; it now includes inbound `x-dispatch-secret` and was **deployed from Git as v16 on 5 Aug**. Live body download API is restricted on our CLI for byte-compare of the other two; Dashboard export closes that if you want belt-and-braces.
2. **SQL Editor** — migration version tracking and known manual scripts catalogued; full History still requires each account’s SQL Editor History in Dashboard (boost script UUID especially).
3. **Umer permissions** — verified separately (not assumed from Git authors).
4. **Machine security** — checklist clear on the developer machine/repo used for this work; only intentional artifact is `push-migrations.sh`.
