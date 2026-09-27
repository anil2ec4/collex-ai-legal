/**
 * Render guard: sanitize untrusted markdown before it is shown to a user
 * (Master Build Brief section 12.4, threat row "HTML/Markdown exfil":
 * sanitize, CSP, remote images off).
 *
 * TWO ENTRY POINTS, one core:
 *
 *  - `sanitizeMarkdown(md)` — for arbitrary untrusted markdown. The output
 *    contains NO angle bracket of any kind: everything is inert text.
 *  - `sanitizeAnswerMarkdown(md)` — for markdown a TRUSTED renderer produced
 *    around untrusted content (answer/renderer.ts). It is byte-identical to
 *    `sanitizeMarkdown` except that ONE line-leading `"> "` per line survives
 *    as a blockquote marker.
 *
 * Why the second one exists (added 2026-08-27, replacing a post-pass that
 * lived in pipeline/answerPipeline.ts): the answer renderer emits `"> "` at
 * the start of a line as STRUCTURE — it is how an untrusted quote is forced
 * to display as a visibly quoted block instead of as top-level text. Escaping
 * it to `&gt;` turned every quote line into a literal `&gt; ...` and destroyed
 * exactly the framing that makes an injected "SYSTEM: ..." line read as a
 * quotation. Fixing that by un-escaping `^&gt; ` AFTER sanitizing was worse
 * than it looked: the guard classified a line, and then the caller changed
 * what that line was. A line restored to `> [ref]: https&#58;//evil` is a
 * link reference definition INSIDE a blockquote — the one construct
 * `neutralizeReferenceDefinitions` exists to stop, reintroduced after it had
 * run, and entity references ARE decoded inside link destinations, so
 * `[x][ref]` came back to life. The marker is therefore handled INSIDE the
 * pass now, before the classification steps, and the guard sees the text the
 * reader will actually get.
 *
 * WHY A SURVIVING MARKER IS SAFE. Only a single leading `> ` per line
 * survives, and it survives as `>` — never as `<`, a link, or an entity.
 * Either the marker is structural (renderer-emitted), which is the intent, or
 * it came from text that happened to begin a line with `>`, and then the line
 * renders as a blockquote. A blockquote is inert: it cannot open a tag (`<`
 * stays escaped), cannot form an inline link (`](` stays escaped), cannot
 * open a reference definition (that check runs marker-aware, see step 6) and
 * cannot reach a host (URLs stay defanged). The worst outcome is a
 * cosmetically indented line.
 *
 * Both entry points are IDEMPOTENT: sanitize(sanitize(x)) === sanitize(x).
 * The test suite asserts this as a property over the adversarial corpus and
 * over generated adversarial strings.
 *
 * What it enforces:
 *  - raw HTML is neutralized: `<`/`>` are entity-escaped (entity-aware `&`
 *    escaping keeps the operation idempotent), so script/iframe/img tags and
 *    inline event handlers render as visible text, never as DOM. The output
 *    contains no `<` at all;
 *  - INLINE markdown images survive only for https URLs on
 *    `ALLOWED_SOURCE_HOSTS`; every other image becomes a plain-text
 *    placeholder;
 *  - INLINE markdown links survive only for https URLs on
 *    `ALLOWED_SOURCE_HOSTS` (title/anchor text is dropped — that is where
 *    instruction payloads hide); every other link collapses to its visible
 *    text. This runs to a FIXED POINT, because collapsing an outer link can
 *    expose an inner one (`[[x](javascript:a)](javascript:b)`). Afterwards the
 *    targets we positively decided are safe are shielded and EVERY remaining
 *    `](` is escaped to `]&#40;`, so a construct these regexes could not parse
 *    is never handed to a real CommonMark parser that might read it more
 *    liberally;
 *  - REFERENCE link definitions (`[ref]: target "title"`) survive only for
 *    https URLs on `ALLOWED_SOURCE_HOSTS`; every other definition has its
 *    `]:` marker escaped to `]&#58;` so CommonMark no longer sees a
 *    definition. This matters because entity references ARE decoded inside
 *    link destinations — defanging a bare URL to `https&#58;//evil` is NOT
 *    enough if that URL is still reachable as a reference target. This step
 *    runs LAST, because the earlier steps can turn a non-definition line into
 *    a well-formed definition (see the comment on step 6);
 *  - bare URLs on non-allowlisted hosts are defanged (`://` becomes
 *    `&#58;//`) and bare GFM `www.` autolink hosts get their first dot
 *    defanged, so autolinking cannot resurrect either as a live link — no
 *    request can ever be made to a non-allowlisted host from rendered output;
 *  - NUL and other control characters are removed, CR/LF and U+2028/U+2029
 *    normalized, and zero-width/BiDi control characters (including U+061C
 *    ARABIC LETTER MARK) stripped.
 *
 * This is an output-side guard. It complements — never replaces — the
 * viewer-side CSP and the typed data flow described in POLICY.md.
 */

import { isAllowedSourceHost } from "./urlPolicy.js";
export { ALLOWED_SOURCE_HOSTS } from "./urlPolicy.js";

/** C0/C1 controls except tab (0x09) and line feed (0x0a). */
const DISALLOWED_CONTROLS = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]",
  "g",
);

/**
 * Zero-width and BiDi control characters. U+061C ARABIC LETTER MARK is a BiDi
 * control that lives outside the U+200x/U+202x block and is easy to miss.
 */
const INVISIBLE_CHARS = new RegExp(
  "[\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]",
  "g",
);

/** Unicode line/paragraph separators — folded to `\n` so line structure is honest. */
const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");

/**
 * `&` that does NOT already start an entity — escaping only these keeps the
 * whole pass idempotent (a second pass sees `&amp;` and leaves it alone).
 */
const BARE_AMPERSAND = /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g;

/**
 * Markdown image: ![alt](target "title"). The target admits one level of
 * balanced parentheses (`javascript:void(0)` and friends) so the optional
 * title — where instruction payloads hide — is consumed with the link.
 */
const MARKDOWN_IMAGE =
  /!\[([^\]\n]*)\]\(\s*<?((?:[^()\s>]|\([^()\s>]*\))*)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

/** Markdown link (not an image): [text](target "title"). */
const MARKDOWN_LINK =
  /(?<!!)\[([^\]\n]*)\]\(\s*<?((?:[^()\s>]|\([^()\s>]*\))*)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

/**
 * Sentinel standing in for a structural blockquote marker while the escaping
 * and defanging steps run. NUL is stripped by the character-hygiene pass
 * before this is introduced, so untrusted input can never forge one.
 */
const BLOCKQUOTE_SLOT = "\u0000bq\u0000";
const BLOCKQUOTE_SLOT_RE = new RegExp("\\u0000bq\\u0000", "g");

/** One line-leading blockquote marker per line — never the second one. */
const LEADING_BLOCKQUOTE = /^> /gm;

/**
 * Anything that OPENS a link reference definition: an optional structural
 * blockquote marker (a definition inside a blockquote is still registered
 * document-wide), up to 3 spaces of indent (4+ would be an indented code
 * block), a label, and a colon. Deliberately broader than CommonMark's full
 * definition grammar — see `neutralizeReferenceDefinitions`.
 */
const REFERENCE_DEFINITION_HEAD = new RegExp(
  "^((?:&gt; |\\u0000bq\\u0000|> )?[ \\t]{0,3})\\[([^\\]\\n]{1,512})\\]:(.*)$",
);

/**
 * The remainder of a WELL-FORMED definition: a destination (optionally in
 * `<...>`), an optional title, and nothing else on the line.
 */
const REFERENCE_DEFINITION_TAIL =
  /^[ \t]*(<[^<>\n]*>|[^\s]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/;

/** A bare http(s) URL in running text. */
const BARE_URL = /\bhttps?:\/\/[^\s<>()"'\]\\]+/g;

/**
 * A bare GFM `www.` autolink host. GFM turns `www.evil.example/x` into a live
 * link with no scheme at all, so the `://` defang below never sees it. Only
 * matched where GFM would actually autolink (not mid-word, not inside a path).
 */
const BARE_WWW_HOST =
  /(?<![\w./@-])www\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+/g;

/** Any inline-link opener. Everything not shielded as safe gets escaped. */
const RESIDUAL_LINK_OPEN = /\]\(/g;

/** The normalized `](target)` tail the collapse pass emits for a KEPT link. */
const NORMALIZED_TARGET = /\]\(([^()\s\]]*)\)/g;

/**
 * Sentinel wrapper for shielded safe targets. NUL is stripped by the character
 * hygiene pass before shielding runs, so untrusted input can never forge one.
 */
const SHIELD = "\u0000";
const SHIELD_SLOT = new RegExp("\\u0000(\\d+)\\u0000", "g");

/**
 * Bound on link/image collapse passes. Each pass that changes anything strictly
 * reduces the number of `](` occurrences (an unsafe link disappears; a safe one
 * maps to itself), so >64 levels of nesting would be needed to reach it. Even
 * then nothing leaks: whatever the loop leaves behind is escaped by the
 * residual pass below.
 */
const MAX_LINK_PASSES = 64;

/**
 * True when `target` is an https URL whose host is on the source allowlist.
 * Anything unparseable, relative, protocol-relative (`//evil.example`),
 * non-https, credentialed, non-default-port or off-allowlist is unsafe.
 * Entities introduced by an earlier sanitize pass (`&amp;` in a query string)
 * do not change the host, so the answer is stable across passes.
 */
function isSafeRenderTarget(target: string): boolean {
  // A kept target is shielded from the HTML-escape pass, so it must not carry
  // markup characters of its own: `https://mevzuat.gov.tr/<script>` parses to
  // an allowlisted host but would smuggle a raw `<` into the output. Legitimate
  // destinations percent-encode all of these.
  if (/[<>"'`\\\s]/.test(target)) return false;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;
  return isAllowedSourceHost(url.hostname);
}

/**
 * Defang a URL string so autolinkers cannot make it live: every `://`
 * becomes `&#58;//` (all occurrences — a URL carrying another URL in its
 * query string must not resurface as a live link on a later pass).
 */
function defangUrl(url: string): string {
  return url.replace(/:\/\//g, "&#58;//");
}

/**
 * Neutralize link reference definitions.
 *
 * A definition is the one place a `&#58;`-defanged URL comes back to life:
 * CommonMark decodes entity references inside link destinations, so
 * `[ref]: https&#58;//evil` still resolves `[x][ref]` to a live link. The URL
 * defang is therefore NOT sufficient here.
 *
 * The rule is deliberately conservative: a definition is KEPT only when it is
 * well-formed AND its destination is https-on-allowlist. Everything else —
 * including lines that CommonMark would not treat as a definition at all —
 * has its `]:` marker escaped to `]&#58;`, which cannot open a definition
 * (CommonMark requires a literal colon there). That costs nothing: `&#58;`
 * renders as `:`, so the user sees exactly the same text either way, and the
 * guard stops depending on a precise reading of the definition grammar.
 */
function neutralizeReferenceDefinitions(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const head = line.match(REFERENCE_DEFINITION_HEAD);
    if (head === null) {
      out.push(line);
      continue;
    }

    const indent = head[1] as string;
    const label = head[2] as string;
    const rest = head[3] as string;

    // CommonMark allows the destination to start on the following line.
    const usesNextLine = rest.trim() === "" && i + 1 < lines.length;
    const tailSource = usesNextLine ? (lines[i + 1] as string) : rest;
    const tail = tailSource.match(REFERENCE_DEFINITION_TAIL);

    if (tail !== null) {
      const raw = tail[1] as string;
      const dest = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
      if (isSafeRenderTarget(dest)) {
        // Normalized single-line form (title dropped, brackets dropped) —
        // re-matching this output yields the same string.
        out.push(`${indent}[${label}]: ${dest}`);
        if (usesNextLine) i += 1;
        continue;
      }
    }

    out.push(`${indent}[${label}]&#58;${rest}`);
  }

  return out.join("\n");
}

/** One collapse pass over inline images then inline links. */
function collapseInlineTargets(md: string): string {
  let out = md.replace(MARKDOWN_IMAGE, (_whole, alt: string, target: string) => {
    if (isSafeRenderTarget(target)) {
      return `![${alt}](${target})`;
    }
    // Parenthesized placeholder ON PURPOSE: a bracketed placeholder followed
    // by original "(...)" text could reassemble into markdown link syntax on
    // the next pass, breaking idempotency.
    return alt.length > 0 ? `(görsel kaldırıldı: ${alt})` : "(görsel kaldırıldı)";
  });

  out = out.replace(MARKDOWN_LINK, (_whole, text: string, target: string) => {
    if (isSafeRenderTarget(target)) {
      return `[${text}](${target})`;
    }
    return text;
  });

  return out;
}

/**
 * Sanitize untrusted markdown for rendering. Idempotent; see module header
 * for the exact guarantees. The output contains NO angle bracket at all.
 */
export function sanitizeMarkdown(md: string): string {
  return sanitizeCore(md, false);
}

/**
 * The ANSWER renderer's guard: identical to `sanitizeMarkdown` except that a
 * single line-leading `"> "` per line survives as a blockquote marker, which
 * is the structure answer/renderer.ts emits to force untrusted quotes to
 * display as quotations. See the module header for why one surviving marker
 * is inert, and for the reference-definition trap the older
 * sanitize-then-restore arrangement fell into.
 *
 * Idempotent, and that matters: the API re-applies this before serving an
 * answer, so the property is the enforcement point for any producer other
 * than the pipeline.
 */
export function sanitizeAnswerMarkdown(md: string): string {
  return sanitizeCore(md, true);
}

function sanitizeCore(md: string, structuralBlockquotes: boolean): string {
  // 1. Character hygiene: normalize newlines and Unicode line separators, drop
  //    NUL/controls and zero-width/BiDi characters.
  let out = md
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(LINE_SEPARATORS, "\n")
    .replace(DISALLOWED_CONTROLS, "")
    .replace(INVISIBLE_CHARS, "");

  // 1a. Detach the ONE structural blockquote marker a line may open with, so
  //     the escape and defang passes below cannot see it and the definition
  //     classification below CAN. It is restored in step 5b, before the
  //     reference-definition pass classifies the text the reader will get.
  //     Everything else — a second `>` on the same line, a `>` mid-line — is
  //     content and stays escaped.
  if (structuralBlockquotes) {
    out = out.replace(LEADING_BLOCKQUOTE, BLOCKQUOTE_SLOT);
  }

  // 2. Inline images and links, run to a fixed point: keep only https +
  //    allowlisted hosts, drop titles (instruction anchors live there),
  //    collapse everything else to its visible text.
  for (let pass = 0; pass < MAX_LINK_PASSES; pass += 1) {
    const next = collapseInlineTargets(out);
    if (next === out) break;
    out = next;
  }

  // 2a. Shield the `](target)` tails the collapse pass KEPT, then escape every
  //     `](` that is left. Whatever survives step 2 is either a target we
  //     positively decided is safe, or a construct the regexes above could not
  //     parse — and an unparsed construct must never be left to a real
  //     CommonMark parser to interpret more liberally than we did. `&#40;`
  //     renders as `(`, so the reader sees identical text either way.
  const shielded: string[] = [];
  out = out.replace(NORMALIZED_TARGET, (whole, target: string) => {
    if (!isSafeRenderTarget(target)) return whole;
    shielded.push(whole);
    return `${SHIELD}${shielded.length - 1}${SHIELD}`;
  });
  out = out.replace(RESIDUAL_LINK_OPEN, "]&#40;");

  // 3. Neutralize raw HTML: entity-escape & (entity-aware), then < and >.
  out = out
    .replace(BARE_AMPERSAND, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4. Defang every remaining URL that is not https-on-allowlist, so bare
  //    URLs (including ones inside escaped HTML text) can never autolink.
  out = out.replace(BARE_URL, (url) => (isSafeRenderTarget(url) ? url : defangUrl(url)));

  // 5. Defang bare GFM `www.` autolink hosts that are not on the allowlist.
  out = out.replace(BARE_WWW_HOST, (host) =>
    isAllowedSourceHost(host.toLowerCase()) ? host : host.replace(".", "&#46;"),
  );

  // 5a. Restore the shielded safe targets now that escaping and defanging are
  //     done (they must not be touched by either).
  out = out.replace(SHIELD_SLOT, (_whole, slot: string) => shielded[Number(slot)] as string);

  // 5b. Restore the structural blockquote markers. This happens BEFORE the
  //     reference-definition pass on purpose: `> [ref]: https&#58;//evil` is a
  //     definition registered document-wide, and CommonMark decodes entity
  //     references inside link destinations — so a marker restored AFTER that
  //     pass would reintroduce exactly the construct it exists to stop.
  //     REFERENCE_DEFINITION_HEAD is marker-aware for the same reason.
  if (structuralBlockquotes) {
    out = out.replace(BLOCKQUOTE_SLOT_RE, "> ");
  }

  // 6. Link reference definitions — LAST, deliberately.
  //
  //    This must run after steps 2-5, not before them, because those steps can
  //    CREATE a definition that the input did not contain. For example
  //    `[ref]: https://evil/x ![b](https://evil/y)` is not a definition in
  //    CommonMark (trailing content after the destination is not a valid
  //    title), but once the image collapses to `(görsel kaldırıldı: b)` that
  //    trailing content becomes a well-formed parenthesized title — and the
  //    line IS a definition, pointing at the URL step 4 merely defanged.
  //    Running last means we classify the text the user will actually see.
  out = neutralizeReferenceDefinitions(out);

  return out;
}

// ---------------------------------------------------------------------------
// Plain text shown literally inside a Markdown document (drafting export)
// ---------------------------------------------------------------------------
//
// WHY A THIRD ENTRY POINT. A draft paragraph is the lawyer's PLAIN TEXT: it
// is stored raw and every surface escapes it for its own medium — the console
// assigns it with `textContent`, python-docx writes XML text runs, the UDF
// writer wraps it in CDATA. Storing it already run through `sanitizeMarkdown`
// printed the guard's entity escapes into the FILED documents: a party named
// "Yılmaz & Kaya İnşaat" came out of the DOCX, the UDF and the NİHAİ copy as
// "Yılmaz &amp; Kaya İnşaat" (drafting audit, 27.09.2026). The Markdown
// export is the one surface a Markdown renderer may read, so the escaping for
// it happens HERE, at render time, and nowhere else.
//
// This is not `sanitizeMarkdown`: its input is text, not markdown, so nothing
// is COLLAPSED (a `[x](y)` the lawyer typed stays visible as typed) and
// ordinary legal punctuation is left alone — a bare `&`, a `<` or `>` that
// cannot open markup ("%9 > yasal faiz", "<%5>") pass through unchanged. What
// it guarantees on the rendered page:
//  - no raw HTML, comment, processing instruction or autolink can open: every
//    `<` followed by a letter, digit, `/`, `!` or `?` is escaped;
//  - an `&` that would start an entity reference is escaped, so text reads as
//    written ("&lt;" typed by the lawyer shows as "&lt;");
//  - no inline link or image can form: every `](` is escaped;
//  - no link reference definition can open, and no line can open as a
//    blockquote (a forged "> Dayanak [K-1]: …" citation line);
//  - bare URLs and GFM `www.` hosts off the allowlist are defanged exactly as
//    `sanitizeMarkdown` defangs them.
// Character hygiene (controls, zero-width/BiDi) is the same as the guard's.

/** `&` that WOULD start an entity reference — the only `&` that needs escaping. */
const ENTITY_START = /&(?=(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g;

/** `<` that can open raw HTML, a comment/PI/declaration or an autolink. */
const MARKUP_OPEN = /<(?=[A-Za-z0-9/!?])/g;

/** Line-leading blockquote marker (up to three spaces of indent). */
const LINE_LEADING_GT = /^([ \t]{0,3})>/gm;

/** Line-leading reference-definition opener `[label]:` (after an escaped `>`, too). */
const LINE_LEADING_DEFINITION = /^([ \t]{0,3}(?:&gt;)?[ \t]{0,3}\[[^\]\n]{1,512}\]):/gm;

/**
 * Character hygiene only: CR/LF and U+2028/U+2029 normalized to `\n`,
 * NUL/controls and zero-width/BiDi characters removed. No escaping — for text
 * that is STORED as plain text and escaped by each renderer for its medium.
 */
export function plainTextHygiene(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(LINE_SEPARATORS, "\n")
    .replace(DISALLOWED_CONTROLS, "")
    .replace(INVISIBLE_CHARS, "");
}

/**
 * Escape PLAIN TEXT so a Markdown renderer shows it literally and inertly.
 * See the section comment above for the exact guarantees.
 */
export function escapeMarkdownText(value: string): string {
  let out = plainTextHygiene(value)
    .replace(ENTITY_START, "&amp;")
    .replace(MARKUP_OPEN, "&lt;")
    .replace(RESIDUAL_LINK_OPEN, "]&#40;")
    .replace(LINE_LEADING_GT, "$1&gt;");
  out = out.replace(BARE_URL, (url) => (isSafeRenderTarget(url) ? url : defangUrl(url)));
  out = out.replace(BARE_WWW_HOST, (host) =>
    isAllowedSourceHost(host.toLowerCase()) ? host : host.replace(".", "&#46;"),
  );
  return out.replace(LINE_LEADING_DEFINITION, "$1&#58;");
}
