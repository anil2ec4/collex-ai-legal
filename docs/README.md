# Documentation index

Last updated: **2026-09-03** — **W14 complete through phase M.** W13 was an
intelligence and design wave (competitor profiles, engineering risk, UX audit,
copy audit, the design system and the B-01..B-46 backlog). W14 built it:
seven parallel phase-A lanes, a phase-B1 integration lane, a phase-B2 console
and documentation pass, an **independent verification lane** that measured the
assembled product and left 22 findings, **four phase-F lanes**, an
**independent closing audit** that re-derived every verdict, **two phase-C
cleanup lanes** with their own closing measurement, and **two phase-M lanes**
(a server lane and a polish lane) with this closing round. **Every measured
number lives in ONE table: `STATUS.md` → "Ölçülen sayılar (03.09.2026, W14
Faz M kapanışı)"** — the other documents reference its rows (**S1–S40**)
instead of repeating them.

> **The phase-F lanes claimed 19 of the 22 findings closed; the independent
> audit did not accept that count.** Re-deriving each verdict it found
> **16 closed · 3 improved-but-not-closed · 3 open**, and added six new
> defects. Phase C then closed the three open ones, both remainders and four
> of the six new ones, and found two more — N-7 and N-8, both about a
> measurement tool racing a wall clock. **Phase M closed N-8** (nine
> consecutive green full suites since), gave V-1's residue and N-4 one half
> each, and **narrowed N-7 without closing it**: the report now prints a band
> and the root cause has been measured (an ingest-generated relation UUID used
> as a tie-break), but the root cause itself is untouched. Today:
> **V-1..V-22 = 21 closed, 1 improved (V-1)**; **N-1..N-6 = 4 closed,
> 1 partial (N-4), 1 documented-not-closed (N-1)**; **N-8 closed, N-7 open**.
> Where a document still says "19 closed", it is wrong — STATUS governs.

> **Most W14 screens now exist; a few do not.** Phase B2 drew six new screens
> (decision search, citation audit, calendar, coverage, fees, contract review)
> plus the backup card, folder upload and "Aslını indir" — each probed over
> real HTTP before it was drawn — phase F fixed fifteen defects in them, and
> phase C polished six more (matching-sentence lines and an exact-phrase
> default on decision search, folding finding cards, a new matter that now
> becomes the active one, and the last two layout remainders). **Phase M then
> gave every long wait a progress card and a working cancel** — with two
> deliberate exceptions whose reasons are written on screen (backup cannot be
> cancelled; `<a download>` exports cannot show progress) — and put the
> source's own record count on the decision-search screen.
> Still endpoint-only, with NO control drawn: the matter-package button, the
> final-copy button, the three verification boxes, contacts, global search and
> "where was I" — grep-verified absent on 03.09.2026, not merely assumed.
> Where a document describes one of these, it describes the
> ENDPOINT and marks the UI as
> pending. That is the vaporware gate, and it is deliberate.

This is the map of `docs/`. Start here, then follow the path that matches what
you are about to do.

> **Read this before you quote any number from these documents.**
>
> - Every measured retrieval / citation figure in this repository comes from a
>   **SENTETİK** corpus: the eight files in `evals/fixtures/corpus/` are test
>   data this project authored. They are **not** real Turkish legislation or
>   case law, and no figure derived from them is a legal-quality benchmark.
> - **Nothing has ever been applied to a live Supabase project, and no
>   Supabase or Resend MCP tool has been used at any point.** All database work
>   is local files plus a local scratch PostgreSQL.
> - **pgvector cannot be installed on this machine**, so the dense retrieval
>   lane is inert and two migrations have never been executed. Anything about
>   embeddings or hybrid retrieval is declared, not measured.

## Start here, by what you are doing

| I want to… | Read, in order |
|---|---|
| **Understand where the project actually stands** | [implementation/STATUS.md](implementation/STATUS.md) → [implementation/FINAL_REPORT.md](implementation/FINAL_REPORT.md) |
| **See it work** | [DEMO.md](DEMO.md) → run `node control-plane/scripts/demo.mjs` → [implementation/RUNBOOK.md](implementation/RUNBOOK.md) §6–7 |
| **Understand the design** | [architecture/overview.md](architecture/overview.md) → [architecture/ADRS.md](architecture/ADRS.md) |
| **Change something** | [../CLAUDE.md](../CLAUDE.md) (the working contract) → [architecture/ADRS.md](architecture/ADRS.md) → [implementation/TRACEABILITY.md](implementation/TRACEABILITY.md) |
| **Run or operate it** | [implementation/RUNBOOK.md](implementation/RUNBOOK.md) |
| **Know what is risky or unfinished** | [implementation/RISKS.md](implementation/RISKS.md) → [implementation/RESEARCH.md](implementation/RESEARCH.md) (open P0 questions) |
| **Review security** | [security/threat-model.md](security/threat-model.md) → [security/incident-2026-08-26-embedded-tokens.md](security/incident-2026-08-26-embedded-tokens.md) (**still OPEN**) |
| **Review legal / compliance** | [legal/source-register.yaml](legal/source-register.yaml) (17 sources, **all `blocked`**) → the rest of [legal/](legal/) |
| **Set up a real database** | [implementation/SUPABASE-SETUP.md](implementation/SUPABASE-SETUP.md) |
| **Understand the evidence / draft export (DOCX, Markdown, UDF-deneysel)** | [implementation/EXPORT.md](implementation/EXPORT.md) |
| **Build the UI or a client against the W12 API** | [implementation/waves/W12-INTEGRATION.md](implementation/waves/W12-INTEGRATION.md) (endpoint list, `/v1/health` shape, auto-linking) → the lane report for the surface → [implementation/waves/W12-UI-SPEC.md](implementation/waves/W12-UI-SPEC.md) (reports win on conflict) |
| **Enable or reason about cloud AI** | [implementation/AI.md](implementation/AI.md) (default OFF, per-request consent, what leaves the machine, KVKK note, live-untested) |
| **Run it on the lawyer's machine** | [implementation/RUNBOOK.md](implementation/RUNBOOK.md) §15 (launcher), §16 (cloud AI), §17 (deadline rules) |
| **Run it in production on the Mac mini (target design — unvalidated on a physical Mac)** | [implementation/MAC-MINI-PRODUCTION.md](implementation/MAC-MINI-PRODUCTION.md) → [implementation/WINDOWS-TO-MAC-MIGRATION.md](implementation/WINDOWS-TO-MAC-MIGRATION.md) → [implementation/BACKUP-RESTORE.md](implementation/BACKUP-RESTORE.md) |
| **Use it as the lawyer (no engineering vocabulary)** | [KULLANIM-ColleX.md](KULLANIM-ColleX.md) (Turkish end-user guide: Başlangıç, Dosyalarım, Belgeler, Araştır, Taslak, Süreler, Ayarlar, Sorun giderme, Sınırlar) |
| **See what the review found and what was fixed or deferred** | [implementation/waves/W12-FIX.md](implementation/waves/W12-FIX.md) → [implementation/waves/W12-FIX2.md](implementation/waves/W12-FIX2.md) → [implementation/waves/W12-CLOSEOUT.md](implementation/waves/W12-CLOSEOUT.md) |
| **Know what we are and are not, against the competition** | [COMPETITIVE.md](COMPETITIVE.md) — the positioning sentence, the verified Apilex/De Jure profiles, the 22-row parity matrix and **the seven traps** (read §6 before adding a claim anywhere) |
| **Understand what W14 built and why** | [implementation/waves/W13-BACKLOG.md](implementation/waves/W13-BACKLOG.md) (the B-01..B-46 specs) → the seven [W14-L-*.md](implementation/waves/) lane reports → [implementation/waves/W14-L-FIX.md](implementation/waves/W14-L-FIX.md) (the seams between lanes, and what they cost) |
| **See what the built product actually did, and what was still broken** | [implementation/waves/W14-L-VERIFY.md](implementation/waves/W14-L-VERIFY.md) (22 findings, every one with a repro) → [W14-F-PERF.md](implementation/waves/W14-F-PERF.md) · [W14-F-API.md](implementation/waves/W14-F-API.md) · [W14-F-UI.md](implementation/waves/W14-F-UI.md) (the fixes) → **[W14-F-VERIFY.md](implementation/waves/W14-F-VERIFY.md) — the independent audit that re-derived every verdict (16/3/3) and added N-1..N-6** → [W14-C-SRV.md](implementation/waves/W14-C-SRV.md) · [W14-C-UI.md](implementation/waves/W14-C-UI.md) · [W14-C-FINAL.md](implementation/waves/W14-C-FINAL.md) → [W14-M-SRV.md](implementation/waves/W14-M-SRV.md) · [W14-M-UI.md](implementation/waves/W14-M-UI.md) · **[W14-M-CLOSE.md](implementation/waves/W14-M-CLOSE.md)** → **[W14-N7.md](implementation/waves/W14-N7.md)** (N-7 closed) → the V-1..V-22 and N-1..N-8 blocks in [TRACEABILITY.md](implementation/TRACEABILITY.md) |
| **Build a client against the W14 API** | [../control-plane/src/api/openapi.yaml](../control-plane/src/api/openapi.yaml) (65 paths / 80 operations, STATUS S8) → the lane report that owns the surface |

## The full set

### `implementation/` — plan, state, operations

| File | What it is | Read it when |
|---|---|---|
| [STATUS.md](implementation/STATUS.md) | Live state after W14 phase M (03.09.2026): the **single "Ölçülen sayılar" table** (**S1–S40**, every row re-measured or attributed), the argument for **why `PARTIAL`** with its **eight unverified surfaces**, its **two measured ceilings** and the measurement-tool caveats (N-7 and N-8), the accounting of V-1..V-22 and N-1..N-8, the delivered surfaces lane by lane, the persistence promise and its caveats, the honest list of what is still NOT closed, and what the user must still do | First. Always. |
| [FINAL_REPORT.md](implementation/FINAL_REPORT.md) | The brief §18 report. §0–§12 are the W12 edition (audit → six lanes → integration → UI → review + fix); **§13 is the W13/W14, phase-F and phase-C layer**: what the verification lane found, what the audit corrected, what the cleanup lanes closed, what is still open, and today's verdict — numbers by reference to STATUS | You need the whole picture in one document |
| [PLAN.md](implementation/PLAN.md) | The 0–9 phase plan with gates and, per phase, where this repo actually stands (Phase 7 matter memory delivered locally in W12) | Planning the next slice |
| [DECISIONS.md](implementation/DECISIONS.md) | ADR index plus smaller non-ADR decisions | "Why is it like this?" |
| [TRACEABILITY.md](implementation/TRACEABILITY.md) | Requirements → design/ADR → file → test → **measured result** → status; rows #1–#30 (27.08 baseline), #31–#60 (W12), **one row per W13 backlog item B-01..B-46**, **one row per verification finding V-1..V-22** and **one per audit finding N-1..N-8** (the defect, the fix, the regression test that fails without it, the verdict), plus the honest deferred list | Verifying a claim, or auditing coverage |
| [RISKS.md](implementation/RISKS.md) | Open risks #1–#34 — the W12 ones (lexical coverage gate, live-untested AI, UDF unverified in UYAP, pid files) plus the W14 ones: **25 of 41 deadline rules unverified (highest impact)**, 17 of 20 fee lines with no amount, the corpus-search ceiling, the trigram fallback's measured recall change, **live search that now reaches real upstreams but whose relevance is unmeasured**, `.ics` never opened, unordered background writes, **the eval harness's non-reproducible answer layer (#34)** and the absence of a backup schedule — and the retired ones with the evidence that closed them | Before promising anything |
| [RESEARCH.md](implementation/RESEARCH.md) | Dated research ledger (each finding classed `verified` / `marketing` / `historical` / `inference`) + the open P0 questions + external blockers | Before relying on a time-sensitive fact |
| [RUNBOOK.md](implementation/RUNBOOK.md) | Every command that exists (expected outputs by STATUS row id, no copied counts): setup, servers, test suites, scratch Postgres bring-up/teardown and database ownership, ingestion, demo, console + `/v1/health` + **request limits and answer budget constants**, export CLI, eval gate, live loopback gateway check, outage behavior, key rotation, **the `.cmd` launcher/stopper semantics after FIX-2, pid files, the MCP token via environment, cloud AI enablement, deadline-rule verification** | Doing anything operational |
| [SUPABASE-SETUP.md](implementation/SUPABASE-SETUP.md) | How to apply the data plane to a real Supabase project — the only place the pgvector migrations may ever run; the migration ledger rules for a hosted target | Provisioning a real target |
| [EXPORT.md](implementation/EXPORT.md) | The evidence-bundle → DOCX/Markdown exporter and the draft → DOCX / **UDF (deneysel)** exporter: contract, exit codes, verification chain, `K-n` citations, GG.AA.YYYY, ek-dogrulama | Working on exports |
| [AI.md](implementation/AI.md) | Cloud AI (Anthropic): enablement (env NAMES only), what leaves the machine per endpoint, KVKK note, the three contracts (`analyze-document`, `ocr`, `draft-paragraph`), error map, the live-smoke script and its (empty) record | Touching anything that could send data off the machine |
| [MAC-MINI-INFERENCE.md](implementation/MAC-MINI-INFERENCE.md) | **W20; since W21 an INTERIM development option only** — the final topology runs everything on the Mac with the model on localhost ([MAC-MINI-PRODUCTION.md](implementation/MAC-MINI-PRODUCTION.md)). The M2 Mac mini (8 GB) as a LAN inference appliance: server (llama.cpp or Ollama), authentication, LAN binding, firewall, the Windows-side environment, the health probe and the exact measurement commands. **No number in it has been measured** | Setting up or measuring the local model box |
| [LOCAL-OCR.md](implementation/LOCAL-OCR.md) | **W20.** The local OCR boundary (Tesseract + Poppler, detected on `PATH`, never downloaded), how OCR text lands in the physical page's own slot, low confidence as a coverage gap; **not installed on this machine** | Scanned PDFs |
| [MAC-MINI-PRODUCTION.md](implementation/MAC-MINI-PRODUCTION.md) | **W21.** The final single-node production design: ONE always-on M2 Mac mini (8 GB) runs everything — console, control plane, PostgreSQL, MCP and intake, workers, file storage, E5 embeddings, the dense lane, matter analysis, OCR and the local model on 127.0.0.1. Topology, what runs where, the 8 GB memory budget as **planning estimates, not measurements** (each with its measurement command), the low-memory profile (`COLLEX_LOCAL_LLM_CONCURRENCY=1`, `COLLEX_ANALYSIS_*`, `COLLEX_AI_POLICY`), the launchd design (`deploy/macos/*`), storage layout, the Apple Silicon dependency audit and the physical-Mac checklist. **Nothing in it has run on a Mac** | Planning or reviewing the production host |
| [BACKUP-RESTORE.md](implementation/BACKUP-RESTORE.md) | **W21.** What is irreplaceable and what is rebuildable, `pg_dump -Fc` (never a copy of a live data directory), the SHA-256 manifest, restore validation into a scratch database, version compatibility, schedule, retention, private off-machine copies, and exact Windows (`.cmd`) and macOS commands (`deploy/macos/collex-backup.sh`, `collex-restore.sh` → the W21 portable `backup.mjs --restore`) — **the macOS ones unvalidated on a physical Mac** | Taking, checking or restoring a backup |
| [WINDOWS-TO-MAC-MIGRATION.md](implementation/WINDOWS-TO-MAC-MIGRATION.md) | **W21.** The 26-step Windows → Mac mini runbook: source snapshot → dependencies → data (dump/restore plus manifest-verified originals) → inference, OCR, embeddings → migrations, health, smoke, provenance, probes, an eval subset → launchd, reboot, backup/restore → only then production. Rehearsal first, cutover second; every step has a verification and a rollback. **Unvalidated on a physical Mac** | Moving the product to the Mac mini |

### `implementation/waves/` — the lane reports (binding "as implemented" contracts)

Three blocks: **W12** (the build wave), **W13** (intelligence and design — it
changed no repo file, it wrote the specification) and **W14** (the build wave
that executed W13).

#### W13 — intelligence and design (02.09.2026)

| File | What it is |
|---|---|
| [W13-BACKLOG.md](implementation/waves/W13-BACKLOG.md) | **The specification W14 executed.** §A the positioning sentence, §B the 22-row parity matrix, §C **the seven traps**, §D/§E/§F the item specs **B-01..B-46** with acceptance criteria, §G the wave plan and the DISJOINT file ownership that made seven parallel lanes possible, §H the honesty notes |
| [W13-APILEX.md](implementation/waves/W13-APILEX.md) | Apilex's full public surface (101 URLs, 4 languages, store records, third-party signals) with `[doğrulandı]` / `[pazarlama]` / `[çıkarım]` / `[kullanıcı beyanı]` tags. No account was opened and the product was never entered |
| [W13-DEJURE.md](implementation/waves/W13-DEJURE.md) | De Jure: pricing and the package × feature matrix decoded from the page's own SVG icons, the quota clause that is in the contract and nowhere on the site, the 49 JS bundles that revealed unadvertised features, the App Store version history as a roadmap, and the desktop editor's remote-install / UYAP-identity mechanism |
| [W13-TRMARKET.md](implementation/waves/W13-TRMARKET.md) | The Turkish market: TBB advertising-ban constraints, bar association channels, what a solo practice actually pays for |
| [W13-GLOBAL.md](implementation/waves/W13-GLOBAL.md) | The global field: Stanford RegLab's measured hallucination rates behind "hallucination-free" claims, Clearbrief's Cite Check Report, the Alexi–Fastcase corpus litigation |
| [W13-ARCH.md](implementation/waves/W13-ARCH.md) · [W13-ENGRISK.md](implementation/waves/W13-ENGRISK.md) | Architecture seams and the measured engineering risks (the DNS-rebinding read, the CSRF write, the half-applied migration, the trigram lane, list-endpoint scale) |
| [W13-DESIGN.md](implementation/waves/W13-DESIGN.md) · [W13-DESIGN-SPEC.md](implementation/waves/W13-DESIGN-SPEC.md) | The console design system, written to be implementable without judgement calls |
| [W13-COPY.md](implementation/waves/W13-COPY.md) · [W13-DAILYFLOW.md](implementation/waves/W13-DAILYFLOW.md) · [W13-UXAUDIT.md](implementation/waves/W13-UXAUDIT.md) · [W13-FEATURE.md](implementation/waves/W13-FEATURE.md) | The copy audit (L1–L33, incl. the two wrong deadline rules and the invented "el yazısı" validity condition), a day in the practice measured end to end, the UX audit (P0-1 the broken quote bond, P0-2 the silent upload failure, P1-3 the ghost matter) and the feature gap list |

#### W14 — the build (02.09.2026)

| File | What it is |
|---|---|
| [W14-L-EVID.md](implementation/waves/W14-L-EVID.md) | B-01 quote-integrity gate (ADR-023), B-02 filable output (ADR-024), B-13 citation audit (ADR-028), B-24 contract review, B-30 packager, B-36 verification record. Includes the 11/11 real-HTTP gate run |
| [W14-L-ANSWER.md](implementation/waves/W14-L-ANSWER.md) | B-06 trigram lane and its query-plan test, B-07 bare-statute abstention, B-08 the legal question inside a long narrative, B-09 the temporal COMPLETE ban, B-31 entailment segments — and the honest half of B-06 that did not close |
| [W14-L-SAFE.md](implementation/waves/W14-L-SAFE.md) | B-03 backup + the real disaster drill, B-04 `localGuard` (ADR-025), B-05 multi-sentinel ledger (ADR-026), B-12 PostgreSQL in CI, B-19 folder intake, B-23 cloud-AI masking/ledger/ceiling, B-33 intake limits, B-34 data dir + VERSION + graceful stop, B-37 pre-review quality, B-44 repo cleanup, B-45 |
| [W14-L-MATTER.md](implementation/waves/W14-L-MATTER.md) | B-17 calendar + hearing + `.ics`, B-18 batch chronology, B-26 the end of silent ignoring, B-29 global search, B-30 `/original`, B-32 list scale, B-42 contacts + conflict check, B-43 activity — and the root cause of the ghost matter (it was the console, not the endpoint) |
| [W14-L-LEGAL.md](implementation/waves/W14-L-LEGAL.md) | B-11 deadline rules (two wrong rules fixed, 16 verified against article text pulled from mevzuat.gov.tr), B-25 the 24 template content fixes, B-35 the fee calculator that never invents an amount |
| [W14-L-SOURCES.md](implementation/waves/W14-L-SOURCES.md) | B-14 coverage manifest, B-15 the dead MCP lanes and the reachability test, B-16 decision search (fake-gateway verified, **live pending**), B-20 local library (ADR-027), B-38 Turkish short-form citations |
| [W14-L-CONSOLE.md](implementation/waves/W14-L-CONSOLE.md) | B-10, B-21 the document × question grid, B-22 named work cards and the vaporware gate, B-27 the warning budget, B-28 the accessibility ratios — measured in a real browser against a real server |
| [W14-L-FIX.md](implementation/waves/W14-L-FIX.md) | **Phase B1, and the most instructive report in the set:** the seams between seven lanes. Every defect it found was a line nobody owned, and both sides were green in their own unit tests — a store wrapper silently not forwarding two methods, a router mounted without its dependency, a fixture generator that would have dropped 8 cases on the next run |
| [W14-L-DOCS.md](implementation/waves/W14-L-DOCS.md) | **Phase B2:** the openapi delta (35/44 → 65/80, with a code↔spec cross-check), the rewritten counts table, the B-01..B-46 traceability rows, the six new ADRs, the competitive rewrite, and — recorded rather than hidden — a measured eval regression and one fee count corrected against a phase-A report |
| [W14-L-CONSOLE-B.md](implementation/waves/W14-L-CONSOLE-B.md) | **Phase B2, the console:** six new screens (`#karar-ara` `#denetim` `#takvim` `#kapsam` `#harc` `#sozlesme`), the backup card, folder drop and "Aslını indir" — each endpoint tried over REAL HTTP before a single control was drawn, with the honest list of what it could not reach in time |
| [W14-L-VERIFY.md](implementation/waves/W14-L-VERIFY.md) | **The independent verification round, and the report to read if you only read one.** It touched no product file: it ran every gate on one clean tree, built a 20 000-chunk probe, DESTROYED a database and restored it byte for byte, walked the console in a real browser against every W13-UXAUDIT and W13-DAILYFLOW finding, opened the final DOCX with python-docx, and left **22 defects (V-1..V-22)** with a repro each — plus a one-paragraph honest answer to "is it better than Apilex and De Jure?" |
| [W14-F-PERF.md](implementation/waves/W14-F-PERF.md) | **Phase F:** V-1 (a corpus question that took 47–59 s and returned NOTHING) and V-2 (an index the product never used). The fix was not a cheaper lane but asking WHEN it should run; the rejected alternative is written down with its measurement, and so is the half that did not close |
| [W14-F-API.md](implementation/waves/W14-F-API.md) | **Phase F:** three seams — a gateway given to one router and not its twin (V-3), a dependency `createApp` never passed on so every "Aslını indir" was a 404 under `COLLEX_DATA_DIR` (V-4), and two list filters read by the store and never fed from HTTP (V-6). Each reproduced on a real server first, then re-measured |
| [W14-F-UI.md](implementation/waves/W14-F-UI.md) | **Phase F:** fifteen defects on the lawyer's screen, measured in a real browser — a computed deadline that was silently LOST, a modal the Back button walked past, rejected evidence offered without a warning, the database name in front of the lawyer, and a template purpose sentence cut inside a citation. Eight defects were put back one at a time to prove the new tests are not vacuous |
| [W14-F-DOCS.md](implementation/waves/W14-F-DOCS.md) | **Phase F documentation pass:** the first full re-measurement AFTER the three fix lanes landed, the openapi delta of those lanes, the V-1..V-22 traceability block, ten new risk rows, and the vaporware re-check of the user guide — which screens now exist, which buttons still do not |
| [W14-F-VERIFY.md](implementation/waves/W14-F-VERIFY.md) | **The independent CLOSING audit — read this one if you read only one.** It touched no product file. It re-ran every gate, rebuilt its own 20 000-chunk probe, and re-derived all 22 verdicts from scratch, refusing three of the fix lanes' "closed" claims with numbers. It tampered with a quote in a live browser and watched the server break the bond, opened the final DOCX with python-docx, and got **"Karar ara" to return real künye rows for the first time in the wave** — while recording that they did not visibly match the query. Six new defects (N-1..N-6) and a one-paragraph honest answer to "is it better than Apilex and De Jure?" |
| [W14-C-SRV.md](implementation/waves/W14-C-SRV.md) | **Phase C, server:** the three findings the audit left open (V-14 backup archive name, V-19 the `.strict()` rejection that pointed at no field, V-21 the contrary scan on an off-topic question) plus N-2 and N-3. It also measured the trigram threshold question a third time and reached the **opposite** result from the audit — and says so, instead of choosing the convenient number |
| [W14-C-UI.md](implementation/waves/W14-C-UI.md) | **Phase C, console:** N-4 (why "Karar ara" rows looked unrelated — measured, not guessed: an unquoted query opens the source to 116 090 records ordered by date), N-5 (the 6,8-screen answer card), N-6 (a new matter that did not become the active matter), and the V-10 / V-22 remainders. Thirteen new tests, each proven non-vacuous |
| [W14-M-SRV.md](implementation/waves/W14-M-SRV.md) | **Phase M, server:** two additive fields (`/v1/health.uploadsDir`, per-source `totalRecords` — `null` when the provider publishes nothing, never 0), the **N-8 fix** (block (l) no longer races a wall clock; the guarantee it pins is unchanged and two non-vacuity proofs live inside the test), and N-7's band + gate. Its most useful paragraph is §4.4: it **disproved phase C's own diagnosis by measuring it** — the answer layer does not vary because of wall budgets, it varies because an ingest-generated relation UUID is used as a tie-break |
| [W14-M-UI.md](implementation/waves/W14-M-UI.md) | **Phase M, console:** the progress card and a working "Vazgeç" on seven long operations, measured in a real browser before and after. Read §1.3 for the discipline: the lane could not reproduce the 7,5 s ceiling on the demo corpus, so it **injected a delay to reproduce the WAIT** and said plainly that the 7,5 s is not its own number. §4.2 records a change it tried, measured as WORSE, and reverted |
| [W14-M-CLOSE.md](implementation/waves/W14-M-CLOSE.md) | **Phase M, its closing round:** the full measurement on the final tree (ten commands, all exit 0, no failing test), `vitest` three times and `run_evals` six times to re-derive both instrument findings independently — **N-8 confirmed closed, N-7 confirmed still open**, including the observation that its first two runs agreed exactly and the next four did not |
| [W14-N7.md](implementation/waves/W14-N7.md) | **N-7 closed.** Read it for the METHOD before you read the fix: two ingests of one corpus diffed on stable keys showed **identical content and different ids only**, so the defect was in a read path; an instrumented trace of the one gold row that flipped (`fx-amend-002`) showed **every retrieval lane returning the same ordered list** while the coverage-aware cap kept a different eight. The cause was one line — `AnswerPipeline`'s rank stage broke a score tie on the chunk's uuid, and every citation/citator/contrary passage carries `fusedScore: 0`, so the tie group was most of the list. Six consecutive `run_evals` runs and a `--repeats 4` band of width zero; the regression test's non-vacuity was proven by putting the defect back once |
| [W14-C-FINAL.md](implementation/waves/W14-C-FINAL.md) | **Phase C, closing round:** the last full measurement on the final tree (nine commands, all exit 0), the rebuilt counts table, and **two new findings about this repo's own measuring instruments** — the eval harness's answer-layer metrics are not reproducible run to run (N-7), and `npx vitest run` went red once in seven on an unchanged tree because one test races a 1 ms wall budget (N-8). Both weaken arguments this document set had been making, and in both the product behaved correctly |

#### W12 — the earlier build wave

| File | What it is |
|---|---|
| [W12-INTEGRATION.md](implementation/waves/W12-INTEGRATION.md) | How lanes A–F were wired into one app: `ApiDependencies`, the **35-path / 44-operation** endpoint list, matter auto-linking rules, the `/v1/health` shape, the HTTP probe transcript on `collex_demo`, the test counts **at integration time** (historical; the current counts are STATUS's "Ölçülen sayılar" table, sourced from [W12-FIX2.md](implementation/waves/W12-FIX2.md) §2) and the open notes |
| [W12-A.md](implementation/waves/W12-A.md) | Matters, persistent answers/drafts/settings, `checkDatabase`, the migration ledger and `--ensure-db` (ADR-016, ADR-020) |
| [W12-B.md](implementation/waves/W12-B.md) | Answer honesty: the question-coverage gate, unpinned citation expansion, file-scoped answers, typed `CORPUS_UNAVAILABLE`, the 02.09 eval report (ADR-017) — **SENTETİK** |
| [W12-C.md](implementation/waves/W12-C.md) | Drafting v2: 13 templates, revision/versions, `K-n` citations, GG.AA.YYYY, ek-dogrulama, uploads as exhibits, UDF deneysel (ADR-019, ADR-021) |
| [W12-D.md](implementation/waves/W12-D.md) | Süre hesabı: 30 rules **all `dogrulanmadi`**, holidays, adli tatil, the calculator and its known gaps. **Superseded by W14 B-11** (`W14-L-LEGAL.md`): 41 rules, 16 of them verified against the article text |
| [W12-E.md](implementation/waves/W12-E.md) | Cloud AI lane, consent-gated, default OFF, **no live call made** (ADR-018) |
| [W12-F.md](implementation/waves/W12-F.md) | Engineering resilience: intake timeouts and per-page scan warnings, batched ingest, files pagination/503/504, live-research persistence + progress + timeouts, `serve.mjs`/launcher lifecycle, pid files, MCP child hygiene |
| [W12-UI-SPEC.md](implementation/waves/W12-UI-SPEC.md) | The UI design text for the console (Turkish); where it conflicts with a lane report, the report wins |
| [W12-B2.md](implementation/waves/W12-B2.md) | Pipeline follow-ups: uploaded-document currentness `NOT_APPLICABLE`, live `origin`, the **answer-level eval** (report-only) and its finding on consolidated claims — **SENTETİK** |
| [W12-API2.md](implementation/waves/W12-API2.md) | Backend follow-ups for the UI: `AnswerSummary.fileScope`, `GET /v1/answers?fileId=`, list `pages`, run `warnings`, event `source` forms; two defects found and pinned (linker race, postgres.js jsonb cast) |
| [W12-UI1.md](implementation/waves/W12-UI1.md) | Console part 1: five-tab desk, matter page, document page, deadline modal, live progress, settings; Playwright walkthrough |
| [W12-UI2.md](implementation/waves/W12-UI2.md) | Console part 2: Taslak editor, cloud-AI surfaces (seen disabled only), compact header, print; Playwright walkthrough |
| [W12-FIX.md](implementation/waves/W12-FIX.md) | The review (2 P0 / 20 P1 / 45 P2): reproductions, fixes with regression tests, the P2 language sweep, its final counts (historical; superseded by W12-FIX2 §2) and the list of what it deferred to FIX-2 |
| [W12-FIX2.md](implementation/waves/W12-FIX2.md) | **FIX-2 (binding):** the 12 deferred items — drafting relevance gate (ADR-022), ledger probe grammar + atomic bootstrap (ADR-020 amendment), answer time/size budget, request-body limits, stderr → `correlationId`, MCP token via environment, launcher stop-on-DB-failure / stopper kills only ColleX processes, AI-locked sections + immutable `refId`, local-time export names, "Son araştırma" preselect + ön inceleme heuristics, 390 px, "Bulut AI" naming — each with its regression test; **the final counts (source of STATUS S1–S9, S18–S22)**; the three remaining known issues |
| [W12-DOCS1.md](implementation/waves/W12-DOCS1.md) | DOCS-1: CLAUDE.md, ADRs 016–021, overview, RUNBOOK, SUPABASE-SETUP, EXPORT, PLAN, RISKS, COMPETITIVE, this index |
| [W12-DOCS2.md](implementation/waves/W12-DOCS2.md) | DOCS-2: STATUS / FINAL_REPORT / TRACEABILITY / DEMO refresh, the Turkish end-user guide, the single counts table (written with the pre-FIX-2 numbers; reconciled by CLOSEOUT) |
| [W12-CLOSEOUT.md](implementation/waves/W12-CLOSEOUT.md) | CLOSEOUT: how STATUS / TRACEABILITY / RUNBOOK / CLAUDE.md / ADRs / AI.md / DEMO / the user guide were reconciled to FIX-2, the `openapi.yaml` additive fields (paths/operations unchanged), and the grep evidence that no stale count remains outside dated wave reports |

### `architecture/` — how it is built

| File | What it is |
|---|---|
| [overview.md](architecture/overview.md) | Target architecture, the current state as it really is (with the inert paths drawn as inert), the four end-to-end data-flow chains (ingestion, retrieval, answer+export, eval gate), the provider tool-dependency chains, and the remaining seams |
| [ADRS.md](architecture/ADRS.md) | ADR-001…**028**, each with context / candidates / decision / rationale / evidence / consequences / rollout / rollback. 007–015 record the retrieval, data-integrity and export decisions of 2026-08-27; 016–021 record W12; 022 the drafting relevance gate; **023–028 record W14** — the quote-integrity gate (023), export modes that govern content but never verification (024), `localGuard` (025), the multi-sentinel ledger amending ADR-020 again (026), the local library as a queue rather than an ingestion path (027) and the three-bucket citation audit, including the boundary that keeps `NOT_FOUND` unreachable (028) |

### `security/`

| File | What it is |
|---|---|
| [threat-model.md](security/threat-model.md) | Assets, actors, trust boundaries, and the brief §12.4 abuse-case table — each row now naming the test that enforces it and whether that test **runs**, is **phase-gated**, or is **open** |
| [incident-2026-08-26-embedded-tokens.md](security/incident-2026-08-26-embedded-tokens.md) | SEC-2026-08-26-001, historically embedded Brave/Tavily tokens. **Status: OPEN — pending user key rotation.** Contains no secret values |

### `legal/` — compliance drafts (Turkish)

Every file here is an **engineering draft marked "HUKUKÇU İNCELEMESİ
GEREKLİ"**. None of it is legal advice, and none of it has been reviewed by a
lawyer.

| File | What it is |
|---|---|
| [source-register.yaml](legal/source-register.yaml) | 17 upstream sources: owner, access method, terms, rights, privacy, operations. **Every entry is `legal_review.status: blocked` and every `terms.url` is still `null`** — this is the gate that blocks production corpus backfill |
| [retention-matrix.yaml](legal/retention-matrix.yaml) | Retention periods per data class |
| [data-flow-map.md](legal/data-flow-map.md) | L0–L3 data classes and model-routing table |
| [processing-inventory.md](legal/processing-inventory.md) | KVKK processing inventory |
| [legal-basis-matrix.md](legal/legal-basis-matrix.md) | Legal basis per processing activity |
| [subprocessor-register.md](legal/subprocessor-register.md) | Sub-processors |
| [cross-border-transfer-assessment.md](legal/cross-border-transfer-assessment.md) | Cross-border transfer assessment |
| [takedown-and-data-subject-request.md](legal/takedown-and-data-subject-request.md) | Takedown / DSAR procedure |
| [ai-use-policy-for-lawyers.md](legal/ai-use-policy-for-lawyers.md) | AI use policy for lawyers |
| [dpa-template.md](legal/dpa-template.md) | Data processing agreement template |
| [privacy-notice.md](legal/privacy-notice.md) | Privacy notice draft |

### `DEMO.md`

[DEMO.md](DEMO.md) (Turkish) explains the end-to-end demo — sourced answer,
abstention, contrary authority, temporal, tamper and the W12 sixth scenario
(matter auto-linking; result in STATUS S9) — what each one proves, how to run
it, `collex_local` vs `collex_demo`, `--force-drop-uploads`, the launcher
flow, the five-tab console walkthrough, what you see without
`ANTHROPIC_API_KEY` and without `--with-mcp`, and its known limits. **The demo
is a test, not a slideshow: it exits non-zero if any scenario misses its
expected state.**

### `KULLANIM-ColleX.md`

[KULLANIM-ColleX.md](KULLANIM-ColleX.md) (Turkish, for the lawyer, no
engineering vocabulary) walks through the launcher, Dosyalarım, Belgeler,
Araştır (what TAM / ŞERHLİ / KISMİ / ÇEKİMSER mean, the coverage percentage,
source chips), Taslak (editor, KAYNAKSIZ, versions, DOCX / Markdown / UDF
deneysel, Bulut AI paragraphs), Süreler (DOĞRULANMADI, the disclaimer),
Ayarlar (enabling Bulut AI, where the data goes), troubleshooting and the
honest limits. Screen names match the console verbatim; no images.

### `COMPETITIVE.md`

[COMPETITIVE.md](COMPETITIVE.md) (Turkish) is the W13 competitive
intelligence: the **positioning sentence**, the verified **Apilex** and
**De Jure** profiles (company, price, quota, subprocessors, the contract
clauses that retract their own accuracy claims), the honest **22-row parity
matrix**, and the **seven traps** — the things we will not do, each one
something a competitor does today. Every competitor cell keeps its
`[doğrulandı]` / `[pazarlama]` / `[çıkarım]` / `[kullanıcı beyanı]` tag and
its access date. It also records the **correction** that De Jure DOES have
case files ("Klasörlerim", a UYAP workspace, mobile "Dava dosyalarım") — the
differentiator is **location, not existence** — and that De Jure's accuracy
guarantee is narrow (that the cited decisions exist), because an unfair
criticism is not worth making.

## Documents that live outside `docs/`

| Path | What it is |
|---|---|
| `../CLAUDE.md` | The working contract for anyone (human or agent) changing this repo: directory map, real commands, the 54-tool invariant, database-name discipline, and the standing prohibitions |
| `../evals/reports/BASELINE.md` | The distinction between the measured **fixture-corpus functional baseline** and the **legal quality benchmark that does not exist yet**, plus the pre-fix historical numbers and the diagnosis that produced the 2026-08-27 retrieval fixes |
| `../evals/reports/fixture_baseline_<date>.{json,md}` | The dated measured baseline, regenerated by `scripts/run_evals.py`. **Read the numbers from the newest of these, not from prose that quotes them** |
| `../evals/datasets/SCHEMA.md` | The gold-set contract and the two-lawyer labeling/adjudication protocol |
| `../evals/datasets/FIXTURE_CORPUS_GOLD.md` | How the synthetic gold set is constructed and how database UUIDs are joined back to stable unit ids after ranking |
| `../control-plane/src/security/POLICY.md` | What the security layer defends, what it delegates, and to which component — parsed and checked by `control-plane/tests/security/policy.test.ts`, so it cannot rot |
| `../README.md`, `../README-INDEPENDENT.md`, `../KULLANIM-REHBERI.md` | The user's own files (Turkish user guide included). Not maintained by this documentation set |
| `../ColleX-Baslat.cmd`, `../ColleX-Durdur.cmd` | The lawyer's launcher and stopper (RUNBOOK §15) |
| `../evals/reports/fixture_baseline_2026-09-02.{json,md}` | The newest dated baseline (34 gold rows, coverage-gate metrics) — **SENTETİK** |

## House rules for these documents

1. **A claim needs a file, a command and an exit code.** No status is raised
   on the strength of code that exists but was not run.
2. **Never present a fixture-corpus number as a legal-quality result**, and
   never present synthetic fixture content as real Turkish case law.
3. **Never state that anything reached a live Supabase project**, because
   nothing has.
4. When a measurement changes, update the report file and cite it **by path
   and date** rather than copying numbers into prose that will go stale.
5. When a lane lands, update both `STATUS.md` and the matching row in
   `TRACEABILITY.md`.
- [implementation/LOCAL-GENERATION.md](implementation/LOCAL-GENERATION.md): isteğe bağlı yerel model sağlayıcısı, üç güven düzeyi ve `LOCAL_ONLY` veri sınırı. Hiçbir hız sayısı ölçülmedi; ölçen betik belgede.
