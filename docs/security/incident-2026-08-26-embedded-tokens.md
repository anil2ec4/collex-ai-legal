# Incident record — embedded provider tokens in committed history

- **Incident ID:** SEC-2026-08-26-001
- **Severity:** P0
- **Status:** **OPEN — pending user key rotation** (local containment complete)
- **Recorded:** 2026-08-26 (read-only audit of the workspace repos)
- **Last reviewed:** 2026-08-27 — **still OPEN, nothing has changed.** No
  rotation has been reported, so both keys are still assumed valid and public.
  Local containment was re-verified on this date:
  `.venv/Scripts/python.exe -m pytest tests evals/tests -q` → exit 0
  (1046 passed, includes `tests/test_disabled_modules.py`) and
  `.venv/Scripts/python.exe scripts/smoke_check.py` → exit 0 with every
  provider key blanked (54 tools, KVKK/BDDK/Sigorta returning structured
  disabled-credential results).
- **Owner:** repository user (rotation requires provider-dashboard access)

> This record deliberately contains **no secret values**. Only commit hashes,
> file paths and line numbers are cited. Never copy the token values into any
> document, log, ticket or chat.

## 1. Summary

A read-only audit found hardcoded **fallback API credentials committed to git
history**: when the corresponding environment variables were unset, the KVKK,
BDDK and Sigorta Tahkim clients silently fell back to real, working tokens
embedded in source code. The upstream project (`saidsurucu/yargi-mcp`) is
public on GitHub and published on PyPI, so these values must be treated as
**fully public**. The independent repo's uncommitted working-tree changes have
removed all fallbacks (fail-closed behavior), but the values remain in
history and in the workspace-level baseline backup patch, and the keys have
not yet been rotated.

## 2. Timeline

| When | Event |
|---|---|
| v0.1.3 era | Commit `cb318fa` introduces a hardcoded **Brave Search token** fallback (`kvkk_mcp_module/client.py:45` in the `yargi-mcp` tree) |
| v0.1.5 era | Commit `c3bc9e1` introduces a hardcoded **Tavily key** fallback (BDDK client, line 44) |
| v0.2.1 era | Commit `7f78f87` duplicates the same Tavily key into the Sigorta Tahkim client (line 58) |
| — | Commits `e900bc0` / `e26f09a` carry a vendored copy of the affected code |
| ongoing | Upstream `saidsurucu/yargi-mcp` is public on GitHub and released on PyPI — every affected version is world-readable |
| 2026-08-26 | Read-only audit confirms the above; independent repo's dirty working tree already removes all fallbacks and fails closed on missing credentials |
| 2026-08-26 | Baseline backup created at `../_baseline-backup/2026-08-26/`; its `dirty-tracked.patch` intentionally preserves the pre-fix state **including the values** |
| 2026-08-26 | This incident record opened; gitleaks CI gate added (`.gitleaks.toml`, `ci.yml` secret-scan job) |
| 2026-08-27 | Containment re-verified (pytest 1046 passed, offline smoke 54 tools with blank keys — both exit 0). **No rotation reported; the incident stays OPEN.** |
| pending | User rotates/revokes both keys at the providers |

## 3. Scope and exposure assessment

- **Affected credentials:** one Brave Search API token; one Tavily API key
  (used in two clients). Names only: `BRAVE_API_TOKEN`, `TAVILY_API_KEY`
  fallback values.
- **Where the values exist:**
  - Git history of the `yargi-mcp` lineage (commits/tags listed above) —
    shared HEAD lineage means the history of `yargi-mcp-independent` contains
    them too until/unless history is purged.
  - Public GitHub repository `saidsurucu/yargi-mcp` (all forks/clones).
  - PyPI source/wheel artifacts of the affected versions (>= v0.1.3 for
    Brave, >= v0.1.5 / v0.2.1 for Tavily).
  - Any container images, CI logs, or deployments built from those versions.
  - Locally: `../_baseline-backup/2026-08-26/dirty-tracked.patch` (workspace
    level, OUTSIDE the repo).
- **Exposure verdict:** treat both keys as **fully public and compromised**.
  Assume they may still be valid until rotated.
- **Blast radius if abused:** quota exhaustion / billing on the Brave and
  Tavily accounts; requests attributed to the key owner. No user data is
  reachable through these keys (search-API credentials only).

## 4. Containment completed locally (no user action needed)

- All hardcoded fallbacks removed in the working tree; clients now **fail
  closed**: with an empty `BRAVE_API_TOKEN` / `TAVILY_API_KEY` the tools
  return an explicit disabled/missing-credential result and make no call.
- Offline smoke (`scripts/smoke_check.py`) exercises the disabled-key paths
  and blanks all provider env vars before import.
- Secret scanning gate added to CI (gitleaks with `.gitleaks.toml`; full
  `fetch-depth: 0` history scan).
- This record + threat model + CLAUDE.md rules forbid embedded fallback
  credentials and copying secret values into documents.

## 5. REQUIRED USER ACTIONS (checklist — incident stays OPEN until done)

- [ ] **Rotate the Brave Search key**: Brave Search API dashboard
      (https://api-dashboard.search.brave.com/) → revoke the exposed
      subscription token, issue a new one, set it only via environment/secret
      manager.
- [ ] **Rotate the Tavily key**: Tavily dashboard (https://app.tavily.com/)
      → revoke the exposed key, issue a new one, set only via
      environment/secret manager. Remember it was used by **both** the BDDK
      and Sigorta Tahkim clients.
- [ ] **Treat both old values as public** — do not merely "stop using" them;
      revoke them server-side.
- [ ] **Take old `yargi-mcp` deployments/images out of traffic**: any running
      service, container image or PyPI-installed environment built from the
      affected versions still contains the values and the fallback behavior.
- [ ] **Delete or secure the baseline backup** once the dirty working-tree
      state is committed: `../_baseline-backup/2026-08-26/dirty-tracked.patch`
      contains the old values. It lives outside the repo and must never be
      committed; after rotation it may be kept only in secured storage or
      deleted.
- [ ] *(Optional, AFTER rotation, user decision required)* **Purge history**
      with `git filter-repo` (or BFG) to strip the values from the local
      lineage. **Warning:** this rewrites history — every hash after the
      earliest affected commit changes, remotes/forks/clones diverge, and any
      open work must be re-based. Only worthwhile for the repos you control;
      the public upstream copies cannot be recalled. Rotation, not purging,
      is the actual mitigation.
- [ ] Record rotation date/time and closure evidence in this file, then set
      Status to CLOSED.

## 6. Evidence log

| Evidence | Location / command | Result |
|---|---|---|
| Fallback introduction (Brave) | `git log`/`git show cb318fa` in the `yargi-mcp` lineage; `kvkk_mcp_module/client.py:45` | Confirmed by 2026-08-26 audit |
| Fallback introduction (Tavily, BDDK) | `git show c3bc9e1`; BDDK client line 44 | Confirmed by 2026-08-26 audit |
| Fallback duplication (Tavily, Sigorta) | `git show 7f78f87`; Sigorta client line 58 | Confirmed by 2026-08-26 audit |
| Vendored copy | commits `e900bc0`, `e26f09a` | Confirmed by 2026-08-26 audit |
| Public exposure | upstream GitHub repo + PyPI releases of affected versions | Public at audit time |
| Local removal of fallbacks | working tree of `yargi-mcp-independent` (uncommitted); offline smoke PASS on 2026-08-26 with blank keys, 54 tools | Confirmed |
| Backup containing pre-fix state | `../_baseline-backup/2026-08-26/dirty-tracked.patch` | Present at workspace level (outside repo) |
| CI secret gate | `.gitleaks.toml`, `.github/workflows/ci.yml` job `secret-scan` | Added 2026-08-26 |

## 7. Lessons / preventive controls

1. No fallback credentials, ever — missing credential = disabled feature
   (fail closed). Enforced by code review + this record.
2. Secret scanning runs on every push/PR over full history (gitleaks).
3. Secrets enter the process only via environment/secret manager; `.env` is
   git-ignored and must never be read into tooling output.
4. Logging/error output must redact credentials (content-off telemetry rule
   in the threat model).
5. Key rotation procedure is documented in
   `docs/implementation/RUNBOOK.md` (section "Key rotation") and references
   this record.
