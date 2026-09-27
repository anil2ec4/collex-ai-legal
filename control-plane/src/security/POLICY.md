# Security guard layer — trust-boundary policy

Scope: `control-plane/src/security/`. Source of truth for the threat model:
Master Build Brief section 12.4 and `docs/security/threat-model.md`.
Acceptance corpus: `evals/datasets/adversarial_v1.jsonl`, enforced by
`control-plane/tests/security/`.

This document is executable in one respect: `tests/security/policy.test.ts`
parses the delegation table below and fails if a delegated fixture is missing,
if an `enforced` row names a component that does not exist on disk, or if a
`planned` row appears that the test does not already know about. It cannot go
stale silently.

## Trust-boundary pipeline (brief 12.4)

~~~text
untrusted file/web/tool text                (UNTRUSTED_DATA)
  -> sandboxed parser + malware/format checks        [planned, see table]
  -> quarantined extractor (no tools, no secrets, no cross-matter context)
  -> typed fact/evidence candidate          (src/evidence/types.ts)
  -> deterministic authorization/policy     (src/capabilities/policy.ts)
  -> privileged planner/executor            (src/orchestration/executor.ts)
  -> typed tool output
  -> citation/output verifier               (src/verification/validator.ts)
  -> render guard + CSP                     (src/security/renderGuard.ts)
~~~

## The primary boundary (read this before anything else)

**The primary boundary is the typed data flow, not any filter in this
directory.** The planner (`src/planner/rulePlanner.ts`) branches only on typed
fields of `EvidenceRef` / `ClaimDraft` / typed step outcomes. It never treats
raw source text as an instruction. The single place document text reaches
planner logic is `parseReferences()`
(`src/retrieval/referenceParser.ts`) — a strict deterministic extractor that
can only ever emit structured court-decision references, never a control-flow
decision, a tool name, or a URL. The tool registry
(`src/capabilities/registry.ts`) is server-side and immutable, and there is no
external-write tool, so text that names a tool cannot cause one to run.

Everything in `src/security/` is a supporting layer around that architecture.
If every module here were removed, injected text would still be unable to act;
what would be lost is telemetry, output hygiene, and SSRF containment.

## What each module enforces

### `src/security/untrusted.ts` — UNTRUSTED_DATA boundary contract

- `UntrustedText` branded type: typed code paths acknowledge provenance.
  `markUntrusted` is a pure type-level operation with no runtime effect.
- `wrapEvidenceForModel(text)`: when raw evidence text must appear in a
  prompt, it is fenced as `<untrusted_evidence>...</untrusted_evidence>`
  behind an explicit bilingual (TR + EN) non-instruction preamble.
  Guarantees, all asserted as properties in `tests/security/properties.test.ts`:
  - the payload is entity-escaped (`&`, `<`, `>`), so the body contains no `<`
    at all and each fence tag appears exactly once in the output — a payload
    carrying the literal `</untrusted_evidence>`, a partial tag, or a nested
    tag cannot terminate its own fence (delimiter collision);
  - Unicode angle-bracket look-alikes (`＜ ＞ 〈 〉 ‹ › ❬ ❭ ❰ ❱ ﹤ ﹥ ˂ ˃`) are
    folded to ASCII *before* escaping, so the fence cannot be forged visually
    either — escaping alone would leave `＜/untrusted_evidence＞` intact;
  - C0/C1 controls, zero-width and BiDi controls (including U+061C ARABIC
    LETTER MARK, which sits outside the U+200x/U+202x block) are stripped;
    CR/LF/TAB survive as whitespace and U+2028/U+2029 fold to `\n`;
  - the payload's words — including hostile ones — are preserved verbatim as
    inert data. This is escaping, not censorship.
  - NOT idempotent by design: wrap exactly once, at the prompt boundary.
- `scanForInjection(text)`: heuristic signals for TR+EN role markers
  (`SYSTEM:`, `asistan talimatı`), "önceki talimatları unut" / "ignore
  previous instructions", role-play jailbreak markers, secret-exfiltration
  bait, tool-registration directives, dangerous markdown link schemes and
  instruction-bearing link titles, active HTML (`<script>`, `<iframe>`,
  event handlers), remote `<img>` beacons, base64-looking blobs, evidence-fence
  forgery attempts, and excessive zero-width/BiDi control characters.

### `src/security/renderGuard.ts` — output sanitization (HTML/Markdown exfil row)

`sanitizeMarkdown(md)` is IDEMPOTENT: `sanitize(sanitize(x)) === sanitize(x)`.

- Raw HTML is neutralized by entity-escaping (`&` escaping is entity-aware so
  the pass stays idempotent). **The output contains no `<` character at all**,
  so `<script>`, `<iframe>`, `<img src=remote>`, `<svg onload=...>` and inline
  event handlers can only ever render as visible text.
- Inline markdown links and images survive only for https URLs on
  `ALLOWED_SOURCE_HOSTS`; titles are always dropped (that is where instruction
  payloads hide) and everything else collapses to its visible text or a plain
  placeholder. This runs to a **fixed point**, because collapsing an outer link
  exposes an inner one — `[[x](javascript:a)](javascript:b)` needs two passes,
  and a single pass would break idempotency.
- **Fail-closed on anything unparsed.** After the fixed point, the targets the
  guard positively decided are safe are shielded and every remaining `](` is
  escaped to `]&#40;`. The guard's regexes are not a CommonMark parser, so a
  construct they could not read is never left for a real parser to interpret
  more liberally. `&#40;` renders as `(`, so the reader loses nothing.
- **Reference link definitions** (`[ref]: target "title"`) are handled
  separately and LAST: a definition is kept only when it is well-formed AND its
  destination is https-on-allowlist; every other `[label]:` line has that
  marker escaped to `]&#58;`, which cannot open a definition. Two reasons this
  is not just the URL defang:
  - entity references *are* decoded inside link destinations, so a
    `https&#58;//evil` left reachable as a reference target would come back to
    life as a live link;
  - the earlier steps can CREATE a definition. `[ref]: https://evil/x
    ![b](https://evil/y)` is not a definition (trailing content is not a valid
    title), but once the image collapses to `(görsel kaldırıldı: b)` the line
    parses as one. Running last means the guard classifies the text the reader
    will actually see.
- Bare URLs on non-allowlisted hosts are defanged (`://` → `&#58;//`), and bare
  GFM `www.` autolink hosts get their first dot defanged (`www.` → `www&#46;`),
  since GFM autolinks a scheme-less `www.` host. Protocol-relative targets
  (`//evil.example`) fail `isSafeRenderTarget` (unparseable without a base) and
  collapse like any other unsafe target.
- Control characters, zero-width and BiDi characters (U+061C included) are
  stripped; CR/LF and U+2028/U+2029 are normalized.
- **Guarantee used by the exfil fixtures**: after sanitization, no inline link
  target, image target, surviving reference definition, bare URL or bare `www.`
  host points at a host outside `ALLOWED_SOURCE_HOSTS`. No beacon request can
  be constructed from rendered output.
- Complements the viewer-side CSP (remote images off); it does not replace it.
- **Plain text is not markdown (27.09.2026).** Draft paragraphs are stored as
  the lawyer's PLAIN TEXT (`plainTextHygiene`: controls and zero-width/BiDi
  characters dropped, nothing escaped) — storing them already sanitized
  printed `&amp;` into filed DOCX/UDF copies. Each surface escapes for its own
  medium: the console assigns `textContent`, the Python writers escape XML,
  and the draft Markdown export runs `escapeMarkdownText` at render time. That
  entry point escapes every `<` that could open markup or an autolink, every
  `&` that would start an entity, every `](`, a line-leading `>` and a
  line-leading `[label]:`, and defangs off-allowlist URLs and `www.` hosts
  exactly as `sanitizeMarkdown` does — while ordinary text ("A & B",
  "%9 > yasal", "<%5>") reads as written. It is not idempotent and is applied
  exactly once, at render.

### `src/security/urlPolicy.ts` — SSRF / fetch policy

- The fetch API takes `(source, externalId)` ONLY. `resolveSourceUrl` is the
  single constructor of outbound URLs, expanding server-side templates per
  provider family onto `ALLOWED_SOURCE_HOSTS`. Model-provided or
  document-provided raw URLs are NEVER fetched. External ids are validated
  segment-by-segment (no `.`/`..`, no traversal, no arbitrary characters) and
  percent-encoded.
- `checkFetchUrl` / `assertSafeFetchUrl` reject, with these reason codes:

  | Reason | Fires on |
  |---|---|
  | `UNPARSEABLE_URL` | unparseable input, embedded control/space chars (tab, CR, LF — the WHATWG parser strips those silently), protocol-relative `//host` |
  | `NON_HTTPS_SCHEME` | `http:`, `file:`, `gopher:`, `data:`, everything not https |
  | `HAS_USERINFO` | `https://allowed.host@attacker.example/` and `user:pass@` |
  | `NON_DEFAULT_PORT` | any explicit port other than 443 |
  | `IP_LITERAL_HOST` | non-private IPv4/IPv6 literals and dotted quads embedded in DNS names (`127.0.0.1.nip.io`) |
  | `LOOPBACK_OR_LOCAL_HOST` | `127.0.0.0/8`, `0.0.0.0/8`, `[::1]`, `[::]`, `localhost`, `*.localhost`, `*.internal`, `*.local` |
  | `PRIVATE_OR_LINK_LOCAL_ADDRESS` | RFC1918, `169.254.0.0/16`, CGNAT `100.64.0.0/10`, IPv6 `fe80::/10` and `fc00::/7` |
  | `METADATA_ENDPOINT` | `169.254.169.254`, `metadata.google.internal`, `metadata.goog`, bare `metadata` |
  | `NON_ASCII_OR_PUNYCODE_HOST` | any host with a non-ASCII or `xn--` label (IDN homograph defense) |
  | `HOST_NOT_IN_ALLOWLIST` | everything else, including empty labels (trailing-dot FQDN form) |
  | `UNKNOWN_SOURCE_FAMILY` / `INVALID_EXTERNAL_ID` | `resolveSourceUrl` inputs |

  Checks run in that order, so `http://127.0.0.1:6379/` reports
  `NON_HTTPS_SCHEME` rather than a host reason. Alternate IPv4 encodings
  (decimal `2130706433`, hex `0x7f000001`, octal `0177.0.0.1`, short `127.1`)
  are normalized to dotted form by the WHATWG parser before classification, so
  they land on the same reason as `127.0.0.1`.
- PURE STRING POLICY: no DNS resolution is performed. Anything not explicitly
  allowlisted is rejected, so DNS-rebinding / wildcard-DNS tricks never reach
  the network layer. The loopback / RFC1918 / metadata classifications exist to
  produce precise telemetry, not as the primary control.

## Delegated threats (documented here, enforced elsewhere)

These adversarial fixtures are asserted against their owning layer, not this
directory. `tests/security/policy.test.ts` parses this table: `enforced` rows
must name a path that exists; `planned` rows are known, tracked gaps and must
appear in the test's `KNOWN_GAPS` set. Paths are repo-root-relative.

| Fixture | Threat | Status | Enforcing component |
| --- | --- | --- | --- |
| `adv-fabricate-001` | fabricated_citation | enforced | `control-plane/src/verification/validator.ts` |
| `adv-fabricate-002` | fabricated_citation | enforced | `control-plane/src/verification/validator.ts` |
| `adv-cite-tamper-001` | citation_tampering | enforced | `control-plane/src/verification/validator.ts` |
| `adv-tool-001` | tool_schema_manipulation | enforced | `control-plane/src/capabilities/registry.ts` |
| `adv-tenant-001` | cross_tenant_leak | enforced | `supabase/migrations/20260826060000_rls.sql` |
| `adv-tenant-002` | cross_tenant_cache | enforced | `supabase/migrations/20260826060000_rls.sql` |
| `adv-tenant-002` | cross_tenant_cache | planned | no retrieval cache layer exists yet, so there is nothing to key or invalidate |
| `adv-resource-001` | resource_exhaustion | planned | no quarantined archive extractor exists yet (no upload path is implemented) |
| `adv-xxe-001` | xxe_ssrf (XML-entity half) | planned | no XML document parser exists yet; the network half is enforced here by `urlPolicy.ts` |

Notes on the enforced rows:

- **Citation integrity** — `validateEvidence` checks offsets, the code-point
  quote slice, the quote hash and the document-version hash, in that order,
  returning `OFFSET_OUT_OF_RANGE` / `QUOTE_OFFSET_MISMATCH` /
  `QUOTE_HASH_MISMATCH` / `DOCUMENT_VERSION_MISMATCH`. The one-character
  diacritic edit in `adv-cite-tamper-001` fails it. Hard invariants (brief
  13.1): fabricated decision/legislation ID: 0; unresolvable citation: 0;
  quote/hash mismatch shown to the user: 0.
- **Tool registry** — `CAPABILITY_TOOLS` and `ALL_TOOL_NAMES` are frozen at
  module load and `EXPECTED_TOOL_COUNT` is 54, matching
  `scripts/smoke_check.py`. A tool named in document text cannot be registered
  or called. `scanForInjection` additionally flags such directives as
  telemetry (`tool_registration_directive`).
- **Tenant isolation** — `app_private.current_tenant_id()` resolves the tenant
  from the verified JWT claim (never from model text) and every tenant-scoped
  table carries an RLS policy against it; with no tenant context set,
  tenant-scoped rows are invisible and unwritable.

Notes on the planned rows — these are open gaps, stated plainly rather than
implied to be covered:

- There is no upload/archive ingest path in this repository yet, so there is no
  decompression limit to enforce. When one lands it must apply size, entry and
  ratio caps before decompression, run in a sandbox, and fail with a typed
  error (brief 12.4 "Zip/PDF/UDF attack" row).
- There is no XML document parser yet. When one lands it must disable external
  entity resolution and DTD loading. Until then the only XXE mitigation in
  place is `urlPolicy.ts` refusing the `file://` and `169.254.169.254` fetches
  such a payload would attempt.
- There is no retrieval/answer cache yet. When one lands its keys must include
  tenant, matter and the authorization epoch, so that revoking access to a
  matter makes previously cached entries unreachable (brief 12.3).

## Non-goals

- **NO regex-only defense claim.** The heuristics in `untrusted.ts` are
  DEFENSE-IN-DEPTH TELEMETRY for logging, review queues and CI fixtures. They
  are not the boundary. Concretely: a clean `scanForInjection` result is NOT a
  safety proof, a flagged result is NOT by itself a block, and no control-flow
  decision anywhere in the control plane may be gated on `flagged`. The
  boundary is the typed data flow (see "The primary boundary" above) plus the
  deterministic validators. Brief 12.4: "Regex injection filtresi tek savunma
  değildir."
- Heuristics are tuned to avoid firing on ordinary Turkish legal questions —
  `adv-fabricate-001/002` are legitimate-looking user questions and are
  deliberately NOT flagged; their defense is the citation validator.
- No DNS resolution, no reputation lookups, no outbound verification calls from
  this layer (it must stay pure and offline-testable).
- No HTML rendering or DOM parsing: `renderGuard` neutralizes markup textually
  against CommonMark + GFM semantics; the browser-side CSP remains the
  rendering authority. `sanitizeMarkdown` is not an HTML sanitizer and must not
  be used to produce HTML.
- No guard model: an LLM-based guard may be added as another additive layer,
  but nothing in this directory depends on one (brief 12.4: "Guard model
  yalnız ek katmandır").
- No secret handling: this layer never sees or logs credentials; telemetry
  excerpts are bounded to 120 characters and content-off logging rules apply
  upstream.
- No authentication or authorization decisions: identity comes from a verified
  token, never from model text (brief 12.4 security gate).
