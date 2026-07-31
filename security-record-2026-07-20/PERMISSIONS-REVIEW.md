# Permission & machine review — 2026-07-20

Project: **freshup-v1** (`dptltpvmqinzjrgjefoe`)  
Org (CLI): `munib's fresh up v0 supabase project` (`vercel_icfg_wmLmJiA0rwLcol9Ez9GtXJ0G`)

---

## 1. Development machines (evidence-based)

| Person | Evidence | OS inference | Repo path (known) |
|--------|----------|--------------|-------------------|
| **Umer Iqbal** | Deploy metadata cited by Munib (Dashboard): `/Users/Umer Iqbal/Documents/GitHub/FreshUp-v0/` | **macOS / Unix** — **not Windows** | Full path above |
| **Waheed (this session)** | Local workspace + linked CLI | **macOS** | `/Users/muhammadrasheed/Documents/GitHub/FreshUp-v0` |

### OS clarification (Munib’s question)

| Claim | Correct? |
|-------|----------|
| Path looks like Windows | **No** — Windows user paths are typically `C:\Users\...` or `C:/Users/...` |
| Path `/Users/Umer Iqbal/...` | **Yes — macOS/Unix home directory** (same pattern as `/Users/muhammadrasheed/...` on this machine) |
| Earlier client reply saying “Windows checkout” | **Misstatement** — first internal draft correctly said macOS; the sent wording incorrectly said Windows |

Source of the path: Munib’s review message quoting Edge Function deployment metadata for `provider-onboard`, not Git history.

Both developers appear to use **personal macOS user home directories**, not a shared CI-only deploy path. That means each machine that holds a logged-in Supabase CLI token can deploy Edge Functions if their org role allows it.

---

## 2. Git identity vs deploy identity

| Check | Result |
|-------|--------|
| Git authors include Waheed / hamad-dev / Munib / ateeb / bots | Yes |
| Git author named **Umer Iqbal** | **Not found** in `git log` authors |
| Umer can still have deployed | **Yes** — path metadata proves at least one deploy from his machine |

**Implication:** Access control must be verified in **Supabase Team** and **GitHub collaborators**, not inferred from Git authors alone.

---

## 3. What this CLI session can do (Waheed-linked account)

Observed capabilities on the account used for FreshUp CLI work in this review cycle:

| Capability | Observed |
|------------|----------|
| See org `munib's fresh up v0 supabase project` | Yes (`supabase orgs list`) |
| Linked project `freshup-v1` | Yes |
| `supabase migration list --linked` | Yes (75/75) |
| Deploy / download Edge Functions (earlier same day) | Yes (v7 stub deploy + source download) |
| `supabase functions list` / `migration list` | Yes when CLI auth is available (reconfirmed: functions still v7 / v9 / v9) |

Exact Dashboard role label (Owner / Administrator / Developer / Read-only) is **not** returned by these CLI commands — must be read from Team UI.

---

## 4. Accounts that must be reviewed (Dashboard + GitHub)

Complete for **both** developers; Munib as Owner fills the matrices.

### A. Supabase — org `munib's fresh up v0 supabase project`

| Person | Email | Role | Can deploy functions? | Can edit secrets? | Can use SQL Editor? | Can invite members? |
|--------|-------|------|----------------------|-------------------|---------------------|---------------------|
| Munib | | Owner? | | | | |
| Waheed | | | | | | |
| Umer Iqbal | | | | | | |
| Others | | | | | | |

Checklist:

- [ ] Organization → **Team** — screenshot member list + roles  
- [ ] Project `freshup-v1` → access / members (if separate from org)  
- [ ] Edge Function **Secrets** who can view/edit  
- [ ] Confirm no unused / ex-contractor accounts remain  

### B. GitHub — FreshUp-v0 (and related repos)

| Person | Role (Admin / Write / Triage / Read) | Can push `milestone-6` / `main`? | Can manage secrets? |
|--------|--------------------------------------|----------------------------------|---------------------|
| Munib | | | |
| Waheed | | | |
| Umer Iqbal | | | |

Checklist:

- [ ] Settings → Collaborators / Teams  
- [ ] Branch protection on `main` (and whether `milestone-6` is protected)  
- [ ] Actions secrets access  

**Note:** `gh` CLI is **not installed** on this machine, so GitHub collaborator enumeration could not be completed from the shell.

### C. Vercel / hosting (if production is on Vercel)

| Person | Role | Can promote production? |
|--------|------|-------------------------|
| | | |

---

## 5. Recommended access posture (for Munib)

Until the matrix above is filled:

1. Treat **any Developer+** org member with CLI login as able to **deploy Edge Functions** and potentially **bypass Git** for function source.  
2. Prefer deploys from CI (GitHub Actions) linked to `main`/`milestone-6` only.  
3. After Umer’s role is confirmed, decide: keep write access, downgrade, or remove if no longer needed.  
4. Rotate Edge Function secrets if any untrusted machine may have had deploy rights with secret visibility.  

---

## 6. Verdict

| Item | Status |
|------|--------|
| Machine OS correction (Umer = macOS) | **Documented** |
| Dual-developer path evidence | **Documented** |
| Full org/GitHub role matrix for Waheed + Umer | **Incomplete** — requires Dashboard + GitHub UI (or `gh` on a machine with auth) |
| Least-privilege confirmation | **Pending Munib** |
