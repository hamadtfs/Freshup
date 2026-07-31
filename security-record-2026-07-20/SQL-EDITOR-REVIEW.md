# SQL Editor / non-migration review — 2026-07-20

Project: **freshup-v1** (`dptltpvmqinzjrgjefoe`)  
Compared against: `milestone-6` @ `183e948`

---

## 1. Versioned migrations (CLI)

`supabase migration list --linked` (this session):

| Metric | Count |
|--------|-------|
| Local versions | 75 |
| Remote versions | 75 |
| Local-only | 0 |
| Remote-only | 0 |

**Verdict:** Hosted migration history matches the branch migration set. No evidence in this pass of a remote-only or local-only version gap.

**Caveat:** This proves **version IDs** align. It does **not** prove every SQL Editor statement ever run was captured in a migration file.

---

## 2. Repo-tracked one-off / manual SQL

| File | Risk / intent | Proven executed on prod? |
|------|----------------|---------------------------|
| `supabase/manual/boost_provider_tier_8a086479.sql` | **High for data integrity** — forces Gold tier + fabricates accept/complete stats for provider `8a086479-1a06-4ea8-bf23-97d43c8511c1` | **Not proven via CLI** — requires Dashboard SQL History or a live row check |
| `supabase/manual/dispatch_tick_vault_secrets.sql` | Ops helper for Vault secrets (placeholders; no secrets in Git) | Ops only; not a schema drift risk if secrets match app |
| `supabase/snippets/Untitled query 119.sql` | Read-only column check on `provider_skills` | Low |
| `supabase/snippets/Untitled query 862.sql` | Read-only `service_modes` | Low |
| `supabase/snippets/Untitled query 869.sql` | Read-only recent `provider_details` | Low |

### Recommended live checks (Dashboard / SQL Editor as Owner)

```sql
-- Was the boost script applied?
SELECT id, dispatch_performance_tier, business_name
FROM public.provider_details
WHERE id = '8a086479-1a06-4ea8-bf23-97d43c8511c1';
```

If tier is still `gold` and offers/orders look fabricated for demos, document as intentional demo data or revert.

---

## 3. What CLI cannot prove

| Gap | Why | How to close |
|-----|-----|--------------|
| Full SQL Editor history | Not available via Supabase CLI used here | Each team member: Dashboard → **SQL → History** |
| Who ran one-offs | No author on manual files | Org **Audit** / team activity if plan supports it |
| Ad-hoc DDL outside migrations | Would not appear in `migration list` unless repaired | Schema advisors + spot-check critical tables |
| Cursor MCP advisors for this project | MCP currently points at a **different** project URL (`uluuwvqerbkafqdhbmfo`), not `dptltpvmqinzjrgjefoe` | Ignore MCP advisors until MCP is re-linked to FreshUp |

---

## 4. Dashboard checklist (both developer accounts)

For **Waheed** and **Umer** (and Munib as Owner):

- [ ] Open SQL Editor → History — note date range and any `CREATE`/`ALTER`/`DROP`/`UPDATE` beyond read queries  
- [ ] Search history for `boost_provider`, `8a086479`, `migration repair`, `vault`  
- [ ] Confirm no unexpected RLS policy drops  
- [ ] Export or screenshot history headers (query titles/timestamps) for the security record  

---

## 5. Verdict

| Item | Status |
|------|--------|
| Migration file ↔ remote version parity | **Complete / aligned** |
| Catalog of known manual scripts in Git | **Complete** |
| Proof of every SQL Editor execution on prod | **Incomplete** — needs Dashboard history per account |
| Live verification of boost script effects | **Pending** Owner/Developer SQL check |
