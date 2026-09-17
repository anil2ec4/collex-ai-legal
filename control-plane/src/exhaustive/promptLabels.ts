/**
 * W21 (round-two review): the labels of the analysis prompt blocks.
 *
 * Every analytical prompt puts document text inside a fenced data block and
 * structures that block with its own labels: `[e1]` candidates and the
 * İDDİA / ADAYLAR headings (weighing), `[o1]` findings and the KISIM /
 * BULGULAR headings (synthesis), `[p1]` pairs and the "A (belgeden birebir
 * alıntı)" side markers (contradiction classification). The model maps its
 * answer back onto the shown items by those labels alone, so a quote that
 * carries a label of its own ("Kira ödendi. [o5] OLGU: …") could make the
 * model cite a real, unrelated item.
 *
 * `neutralizeDataLabels` rewrites every such look-alike inside a payload
 * into a parenthesised form the block never uses. It folds what a model
 * would read as the same label: hidden characters (removed from the whole
 * payload first — the fence strips them AFTER this runs, which would
 * otherwise rebuild a label: `[<U+200B>e3]`), compatibility forms (NFKC:
 * fullwidth letters and brackets), bracket look-alikes, case and the Turkish
 * I forms, spacing inside the label, and look-alike letters from other
 * scripts.
 *
 * This is a structure aid, not the security boundary: the boundary is the
 * fence and the system prompt saying the block is data.
 */

/** Unicode format characters and C0/C1 controls other than tab and line feed. */
const HIDDEN_CHARACTERS = /[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;

/** `[` and the look-alikes NFKC does not fold (CJK, math, small forms). */
const LABEL_OPEN = "\\[\\u3010\\u3014\\u3016\\u3018\\u301A\\u27E6\\u2045\\uFE5D\\uFE47\\u298B\\u298D\\u298F";
/** `]` and its look-alikes. */
const LABEL_CLOSE = "\\]\\u3011\\u3015\\u3017\\u3019\\u301B\\u27E7\\u2046\\uFE5E\\uFE48\\u298C\\u298E\\u2990";

/** A bracketed run with no bracket and no line break inside. */
const BRACKETED = new RegExp(`[${LABEL_OPEN}]([^${LABEL_OPEN}${LABEL_CLOSE}\\n]+)[${LABEL_CLOSE}]`, "gu");

/**
 * Letters from other scripts that read as the Latin letters of the labels.
 * Written as escapes: in source they would look exactly like what they imitate.
 */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  a: "аАαΑɑᴀ",
  b: "вВΒ",
  c: "сС",
  d: "ԁԀᴅ",
  e: "еЕεΕᴇ",
  h: "нНΗ",
  i: "іІӀӏιΙɪ",
  j: "јЈϳᴊ",
  k: "кКκΚ",
  l: "ӏІ",
  m: "мМΜ",
  n: "Ν",
  o: "оОοΟᴏ",
  p: "рРρΡᴘ",
  s: "ѕЅꜱ",
  t: "тТΤ",
  u: "ᴜ",
  v: "ᴠ",
  y: "уУΥ",
  z: "Ζᴢ",
};

const HOMOGLYPH_TO_LATIN: ReadonlyMap<string, string> = new Map(
  Object.entries(HOMOGLYPHS).flatMap(([latin, lookalikes]) => [...lookalikes].map((c) => [c, latin] as const)),
);

/** The folded form of a bracketed run: `[ E 3 ]`, `[е3]` (Cyrillic) -> "e3". */
function refKey(inner: string): string {
  return [...inner.normalize("NFKC").replace(/[\s\p{P}\p{S}\p{M}]/gu, "")]
    .map((character) => HOMOGLYPH_TO_LATIN.get(character) ?? character)
    .join("")
    .replace(/[İIı]/gu, "i")
    .toLowerCase();
}

/** A block reference: `e1` (weighing), `o12` (synthesis), `p3` (classification). */
const REF_KEY = /^[eop]\d{1,4}$/u;

function escapeForClass(character: string): string {
  return /[\\\]^-]/u.test(character) ? `\\${character}` : character;
}

function escapeForPattern(character: string): string {
  return /[.*+?^${}()|[\]\\/]/u.test(character) ? `\\${character}` : character;
}

/** Every form a model would read as this letter (case, Turkish I forms, look-alikes). */
function letterClass(letter: string): string {
  const lower = letter === "İ" ? "i" : letter === "I" ? "ı" : letter.toLocaleLowerCase("tr");
  const forms = new Set<string>([lower, lower.toLocaleUpperCase("tr"), lower.toUpperCase(), lower.toLowerCase()]);
  if (lower === "i" || lower === "ı") for (const form of "iIİı") forms.add(form);
  const latin = lower === "ı" ? "i" : lower;
  for (const form of HOMOGLYPHS[latin] ?? "") forms.add(form);
  return `[${[...forms].map(escapeForClass).join("")}]`;
}

/**
 * A heading label followed by a colon, in any of the folded forms: "ADAYLAR:",
 * "adaylar :", "A D A Y L A R:", "İDD İA (savunma):".
 */
function headingPattern(label: string): RegExp {
  let body = "";
  for (const character of label) {
    if (/\s/u.test(character)) body += "\\s*";
    else if (/\p{L}/u.test(character)) body += `${letterClass(character)}\\s*`;
    else body += `\\s*${escapeForPattern(character)}\\s*`;
  }
  return new RegExp(`(?<!\\p{L})${body}\\s*:`, "gu");
}

const HEADING_PATTERNS = new Map<string, RegExp>();

function headingPatternOf(label: string): RegExp {
  let pattern = HEADING_PATTERNS.get(label);
  if (pattern === undefined) {
    pattern = headingPattern(label);
    HEADING_PATTERNS.set(label, pattern);
  }
  pattern.lastIndex = 0;
  return pattern;
}

/**
 * The payload with every block reference look-alike (`[e3]`, `[o5]`, `[p2]`
 * and their folded forms) written as `(e3)`, and every given heading label
 * followed by a colon written as `(LABEL)`. Longer labels are rewritten first
 * ("İDDİA (savunma)" before "İDDİA"). Double quotes become typographic ones,
 * so a quoted payload cannot close its own quotation marks.
 */
export function neutralizeDataLabels(text: string, headings: readonly string[] = []): string {
  let out = text.normalize("NFKC").replace(HIDDEN_CHARACTERS, "");
  out = out.replace(BRACKETED, (whole: string, inner: string) =>
    REF_KEY.test(refKey(inner)) ? `(${refKey(inner)})` : whole,
  );
  for (const label of [...headings].sort((a, b) => b.length - a.length)) {
    out = out.replace(headingPatternOf(label), `(${label.replace(/[()]/gu, "").replace(/\s+/gu, " ").trim()})`);
  }
  return out.replace(/"/gu, "”");
}
