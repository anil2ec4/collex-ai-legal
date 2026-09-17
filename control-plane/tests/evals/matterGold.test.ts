/**
 * W21 whole-Matter gold: validation (quotes are LOCATED by the application,
 * never taken on the annotator's word), scoring of a findings JSON, expected
 * abstentions, alternatives, completeness and provenance checks.
 *
 * The runs here are hand-built findings JSONs in the shape of
 * GET /v1/matters/{id}/analysis/{runId}/findings; no server is involved.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  goldPassageSchema,
  MATTER_GOLD_SCHEMA,
  matterGoldSchema,
  parseMatterGold,
  renderMatterScoreMarkdown,
  scoreMatterRun,
  sliceCodePoints,
  spansMatch,
  spansTouch,
  type LocatedGold,
} from "../../src/evals/matterGold.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SAMPLE_FILE = join(REPO_ROOT, "evals", "gold", "samples", "ornek-kira-davasi.json");
const SCHEMA_FILE = join(REPO_ROOT, "evals", "gold", "matter-gold.schema.json");

function sample(): Record<string, unknown> {
  return JSON.parse(readFileSync(SAMPLE_FILE, "utf8")) as Record<string, unknown>;
}

function located(raw: unknown = sample(), texts: Record<string, string> = {}): LocatedGold {
  const result = parseMatterGold(raw, texts);
  if (result.located === undefined) throw new Error(result.errors.join("\n"));
  return result.located;
}

// ---------------------------------------------------------------------------
// Run builders: a source at the offsets the gold located (what a correct
// system would cite), with a stable observation id per gold passage.
// ---------------------------------------------------------------------------

let seq = 0;

function src(gold: LocatedGold, key: string, role = "basis"): Record<string, unknown> {
  const span = gold.spans.get(key);
  if (span === undefined) throw new Error(`no span ${key}`);
  const text = gold.texts.get(span.fileId) as string;
  return {
    role,
    observationId: `obs:${key}`,
    fileId: span.fileId,
    startChar: span.start,
    endChar: span.end,
    quote: sliceCodePoints(text, span.start, span.end),
  };
}

function item(kind: string, title: string, sources: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return { itemId: `i${seq}`, kind, title, sources, ...extra };
}

/** The same source one code point off: the quote no longer sits at its offsets (CRLF/BOM drift). */
function shifted(source: Record<string, unknown>): Record<string, unknown> {
  return { ...source, startChar: (source["startChar"] as number) + 1, endChar: (source["endChar"] as number) + 1 };
}

/** A verified source from the first occurrence of `from` through the end of `to` (code points). */
function quoteSrc(gold: LocatedGold, fileId: string, from: string, to: string, role = "basis"): Record<string, unknown> {
  const text = gold.texts.get(fileId) as string;
  const startU = text.indexOf(from);
  const endU = text.indexOf(to, startU) + to.length;
  if (startU === -1 || endU < to.length) throw new Error(`no stretch ${from}…${to} in ${fileId}`);
  const start = Array.from(text.slice(0, startU)).length;
  const end = Array.from(text.slice(0, endU)).length;
  return { role, fileId, startChar: start, endChar: end, quote: sliceCodePoints(text, start, end) };
}

// A JSON Schema (2020-12) evaluator for exactly the keywords
// matter-gold.schema.json uses. An unknown keyword throws, so the parity
// check below can never pass by silently ignoring part of the schema.
const SCHEMA_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description", "type", "additionalProperties", "required",
  "properties", "allOf", "oneOf", "if", "then", "const", "enum", "pattern", "minLength", "maxLength",
  "minItems", "maxItems", "items", "minimum",
]);
type JsonSchema = Record<string, unknown>;
function schemaValid(root: JsonSchema, schema: JsonSchema, value: unknown): boolean {
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.has(key)) throw new Error(`schema keyword not supported by the test evaluator: ${key}`);
  }
  if (typeof schema["$ref"] === "string") {
    const name = (schema["$ref"] as string).replace("#/$defs/", "");
    return schemaValid(root, (root["$defs"] as Record<string, JsonSchema>)[name] as JsonSchema, value);
  }
  if ("const" in schema && value !== schema["const"]) return false;
  if (Array.isArray(schema["enum"]) && !(schema["enum"] as unknown[]).includes(value)) return false;
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  const type = schema["type"];
  if (type !== undefined) {
    const ok =
      type === "object" ? isObject : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) : typeof value === type;
    if (!ok) return false;
  }
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (typeof schema["minLength"] === "number" && length < schema["minLength"]) return false;
    if (typeof schema["maxLength"] === "number" && length > schema["maxLength"]) return false;
    if (typeof schema["pattern"] === "string" && !new RegExp(schema["pattern"], "u").test(value)) return false;
  }
  if (typeof value === "number" && typeof schema["minimum"] === "number" && value < schema["minimum"]) return false;
  if (Array.isArray(value)) {
    if (typeof schema["minItems"] === "number" && value.length < schema["minItems"]) return false;
    if (typeof schema["maxItems"] === "number" && value.length > schema["maxItems"]) return false;
    if (schema["items"] !== undefined && !value.every((entry) => schemaValid(root, schema["items"] as JsonSchema, entry))) return false;
  }
  if (isObject) {
    const record = value as Record<string, unknown>;
    const properties = (schema["properties"] ?? {}) as Record<string, JsonSchema>;
    if (Array.isArray(schema["required"]) && !(schema["required"] as string[]).every((key) => key in record)) return false;
    for (const [key, sub] of Object.entries(properties)) {
      if (key in record && !schemaValid(root, sub, record[key])) return false;
    }
    if (schema["additionalProperties"] === false && Object.keys(record).some((key) => !(key in properties))) return false;
  }
  if (Array.isArray(schema["allOf"]) && !(schema["allOf"] as JsonSchema[]).every((sub) => schemaValid(root, sub, value))) return false;
  if (Array.isArray(schema["oneOf"]) && (schema["oneOf"] as JsonSchema[]).filter((sub) => schemaValid(root, sub, value)).length !== 1) {
    return false;
  }
  if (schema["if"] !== undefined && schemaValid(root, schema["if"] as JsonSchema, value)) {
    if (schema["then"] !== undefined && !schemaValid(root, schema["then"] as JsonSchema, value)) return false;
  }
  return true;
}

// Structural parity (W21 #45): every $def and every field of the JSON Schema
// must be the zod validator's shape — same keys, same required set, same
// enums and literals, same string/number/array bounds and patterns. A field
// or bound changed on one side only fails here, whatever its depth.
function unwrapZod(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current.unwrap();
    else if (current instanceof z.ZodEffects) current = current.innerType();
    else if (current instanceof z.ZodDefault) current = current.removeDefault();
    else return current;
  }
}
function resolveRef(root: JsonSchema, node: JsonSchema): JsonSchema {
  const ref = node["$ref"];
  if (typeof ref !== "string") return node;
  return (root["$defs"] as Record<string, JsonSchema>)[ref.replace("#/$defs/", "")] as JsonSchema;
}
function expectSchemaMirrors(root: JsonSchema, node: JsonSchema, field: z.ZodTypeAny, path: string): void {
  const json = resolveRef(root, node);
  const inner = unwrapZod(field);
  if (inner instanceof z.ZodObject) {
    expect(json["type"], path).toBe("object");
    expect(json["additionalProperties"], path).toBe(false);
    expect((inner._def as { unknownKeys: string }).unknownKeys, path).toBe("strict");
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const properties = (json["properties"] ?? {}) as Record<string, JsonSchema>;
    expect(Object.keys(properties).sort(), path).toEqual(Object.keys(shape).sort());
    const required = Object.entries(shape).filter(([, sub]) => !sub.isOptional()).map(([key]) => key).sort();
    expect([...((json["required"] ?? []) as string[])].sort(), path).toEqual(required);
    for (const [key, sub] of Object.entries(shape)) expectSchemaMirrors(root, properties[key] as JsonSchema, sub, `${path}.${key}`);
  } else if (inner instanceof z.ZodDiscriminatedUnion) {
    const options = inner.options as Array<z.ZodObject<z.ZodRawShape>>;
    const oneOf = json["oneOf"] as JsonSchema[];
    expect(oneOf.length, path).toBe(options.length);
    for (const option of options) {
      const tag = (option.shape[inner.discriminator] as z.ZodLiteral<string>).value;
      const twin = oneOf.find(
        (sub) => ((resolveRef(root, sub)["properties"] as Record<string, JsonSchema>)[inner.discriminator] as JsonSchema)["const"] === tag,
      );
      expect(twin, `${path}<${tag}>`).toBeDefined();
      expectSchemaMirrors(root, twin as JsonSchema, option, `${path}<${tag}>`);
    }
  } else if (inner instanceof z.ZodArray) {
    expect(json["type"], path).toBe("array");
    const def = inner._def as { minLength: { value: number } | null; maxLength: { value: number } | null };
    expect({ min: json["minItems"], max: json["maxItems"] }, path).toEqual({ min: def.minLength?.value, max: def.maxLength?.value });
    expectSchemaMirrors(root, json["items"] as JsonSchema, inner.element, `${path}[]`);
  } else if (inner instanceof z.ZodEnum) {
    expect([...(json["enum"] as string[])].sort(), path).toEqual([...inner.options].sort());
  } else if (inner instanceof z.ZodLiteral) {
    expect(json["const"], path).toBe(inner.value);
  } else if (inner instanceof z.ZodString) {
    expect(json["type"], path).toBe("string");
    const checks = (inner._def as { checks: Array<{ kind: string; value?: number; regex?: RegExp }> }).checks;
    const bound = (kind: string): number | undefined => checks.find((check) => check.kind === kind)?.value;
    expect({ min: json["minLength"], max: json["maxLength"], pattern: json["pattern"] }, path).toEqual({
      min: bound("min"),
      max: bound("max"),
      pattern: checks.find((check) => check.kind === "regex")?.regex?.source,
    });
  } else if (inner instanceof z.ZodNumber) {
    expect(json["type"], path).toBe(inner.isInt ? "integer" : "number");
    expect(json["minimum"], path).toBe(inner.minValue ?? undefined);
  } else if (inner instanceof z.ZodBoolean) {
    expect(json["type"], path).toBe("boolean");
  } else {
    throw new Error(`${path}: zod type not covered by the parity check: ${inner.constructor.name}`);
  }
}

/** A run that finds exactly what the sample gold says, and nothing else. */
function perfectRun(gold: LocatedGold): { status: string; processingCoverage: unknown; exhaustiveClaimRefusedBecause: null; items: Record<string, unknown>[]; links: unknown[]; relations: unknown[] } {
  const dekont = item("evidence", "Banka dekontu", [src(gold, "e1#evidence.0")]);
  const d1 = item("defense", "Mart kirası havale ile ödendi", [src(gold, "d1#sources.0"), src(gold, "e1#evidence.0", "support")], {
    supportStatus: "supported",
  });
  return {
    status: "done",
    processingCoverage: { complete: true, filesTotal: 4, filesProcessed: 4 },
    exhaustiveClaimRefusedBecause: null,
    items: [
      item("claim", "Mart kirası ödenmedi", [src(gold, "c1#sources.0"), src(gold, "e2#evidence.0", "oppose")], {
        supportStatus: "opposed",
      }),
      item("claim", "İhtarname tebliğ edildi, süre geçti", [src(gold, "c2#sources.0"), src(gold, "e3#evidence.0", "support")], {
        supportStatus: "supported",
      }),
      d1,
      item("defense", "İhtarname tebliğ edilmedi", [src(gold, "d2#sources.0"), src(gold, "e4#evidence.0", "oppose")], {
        supportStatus: "opposed",
      }),
      dekont,
      item("contradiction", "Ödeme konusunda bağdaşmayan ifadeler", [src(gold, "x1#left"), src(gold, "x1#right")], {
        attributes: { relation: "CONTRADICTION" },
      }),
      item("contradiction", "Tebliğ konusunda bağdaşmayan ifadeler", [src(gold, "x2#left"), src(gold, "x2#right")], {
        attributes: { relation: "CONTRADICTION" },
      }),
      item("event", "Kira sözleşmesi başladı", [src(gold, "t1#sources.0")], { occurredOn: "2023-01-01" }),
      item("event", "Havale yapıldı", [src(gold, "t2#sources.0")], { occurredOn: "2024-03-05" }),
      item("procedural_event", "İhtarname tebliğ edildi", [src(gold, "t3#sources.0")], { occurredOn: "2024-03-11" }),
      item("legal_issue", "Kira ödenmiş mi; tahliye koşulları", [src(gold, "l1#sources.0")]),
      item("legal_issue", "İhtarnamenin tebliği usule uygun mu", []),
    ],
    // The same support, once more as an item link: counted once.
    links: [{ fromItemId: dekont["itemId"], toItemId: d1["itemId"], linkKind: "supports" }],
    // The same contradiction, once more from the relations list: counted once.
    relations: [
      {
        relation: "CONTRADICTION",
        left: { observationId: "obs:x1#left", fileId: "f-dilekce" },
        right: { observationId: "obs:x1#right", fileId: "f-cevap" },
      },
    ],
  };
}

describe("gold validation", () => {
  it("the shipped synthetic sample validates and every passage is located", () => {
    const gold = located();
    expect(gold.gold.schema).toBe(MATTER_GOLD_SCHEMA);
    expect(gold.gold.source).toBe("synthetic");
    expect(gold.spans.size).toBe(24);
    for (const span of gold.spans.values()) expect(span.end).toBeGreaterThan(span.start);
  });

  it("rejects a gold quote that does not occur in the file", () => {
    const raw = sample();
    (raw["claims"] as Array<{ sources: Array<{ quote: string }> }>)[0]!.sources[0]!.quote = "Davalı kirayı hiç ödemedi.";
    const result = parseMatterGold(raw);
    expect(result.located).toBeUndefined();
    expect(result.errors.join("\n")).toMatch(/c1#sources\.0: quote not found in f-dilekce/u);
  });

  it("an ambiguous quote needs an occurrence, and a startChar hint is checked, never trusted", () => {
    const text = (sample()["files"] as Array<{ fileId: string; text: string }>).find((file) => file.fileId === "f-dilekce")!.text;
    const second = Array.from(text).join("").indexOf("10.000 TL", text.indexOf("10.000 TL") + 1);
    const secondCp = Array.from(text.slice(0, second)).length;
    const withQuote = (passage: Record<string, unknown>): Record<string, unknown> => {
      const raw = sample();
      raw["claims"] = [
        ...(raw["claims"] as unknown[]),
        { id: "c9", statement: "Tutar", sources: [{ fileId: "f-dilekce", ...passage }] },
      ];
      return raw;
    };
    expect(parseMatterGold(withQuote({ quote: "10.000 TL" })).errors.join("\n")).toMatch(/occurs 2 times.*occurrence/u);
    const byOccurrence = parseMatterGold(withQuote({ quote: "10.000 TL", occurrence: 2 }));
    expect(byOccurrence.errors).toEqual([]);
    expect(byOccurrence.located!.spans.get("c9#sources.0")!.start).toBe(secondCp);
    expect(parseMatterGold(withQuote({ quote: "10.000 TL", startChar: secondCp })).errors).toEqual([]);
    expect(parseMatterGold(withQuote({ quote: "10.000 TL", startChar: secondCp + 1 })).errors.join("\n")).toMatch(
      /startChar .* does not point at the quote/u,
    );
    expect(parseMatterGold(withQuote({ quote: "10.000 TL", occurrence: 3 })).errors.join("\n")).toMatch(/occurrence 3/u);
  });

  it("rejects dangling references, unknown files, duplicate ids and unsigned lawyer gold", () => {
    const raw = sample();
    (raw["evidenceLinks"] as Array<{ target: string }>)[0]!.target = "yok";
    (raw["claims"] as Array<{ id: string }>)[1]!.id = "d1";
    (raw["defenses"] as Array<{ sources: Array<{ fileId: string }> }>)[1]!.sources[0]!.fileId = "f-yok";
    const errors = parseMatterGold(raw).errors.join("\n");
    expect(errors).toContain("e1: target yok is not a claim or defense");
    expect(errors).toContain("duplicate id: d1");
    const unknownFile = sample();
    (unknownFile["defenses"] as Array<{ sources: Array<{ fileId: string }> }>)[1]!.sources[0]!.fileId = "f-yok";
    expect(parseMatterGold(unknownFile).errors.join("\n")).toContain("file f-yok is not listed in files");
    const lawyer = { ...sample(), source: "lawyer_annotated", annotators: [] };
    expect(parseMatterGold(lawyer).errors.join("\n")).toContain("needs at least one annotator");
    expect(parseMatterGold("{nope").errors).toEqual(["not JSON"]);
  });

  it("a lawyer gold file need not carry client text: the product's text is supplied separately", () => {
    const raw = sample();
    const texts: Record<string, string> = {};
    for (const file of raw["files"] as Array<{ fileId: string; text?: string }>) {
      texts[file.fileId] = file.text as string;
      delete file.text;
    }
    expect(parseMatterGold(raw).errors.join("\n")).toMatch(/has no text; supply the product's extracted text/u);
    expect(parseMatterGold(raw, texts).errors).toEqual([]);
  });

  it("the JSON Schema mirrors the validator's fields", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
    const shape = matterGoldSchema.innerType().shape;
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(shape).sort());
    const required = Object.entries(shape)
      .filter(([, field]) => !(field as { isOptional(): boolean }).isOptional())
      .map(([key]) => key)
      .sort();
    expect([...schema.required].sort()).toEqual(required);
    expect(Object.keys(schema.$defs.passage.properties).sort()).toEqual(Object.keys(goldPassageSchema.shape).sort());
    expect(schema.properties.schema.const).toBe(MATTER_GOLD_SCHEMA);
    // W21 #45: and every $def below the top level — keys, required set,
    // enums, bounds and patterns — not only the top-level keys.
    expectSchemaMirrors(schema, schema, matterGoldSchema, "gold");
    // The check itself is load-bearing: a field dropped from one $def fails it.
    const drifted = structuredClone(schema) as JsonSchema;
    delete ((drifted["$defs"] as Record<string, JsonSchema>)["chronologyEvent"]!["properties"] as Record<string, unknown>)["precision"];
    expect(() => expectSchemaMirrors(drifted, drifted, matterGoldSchema, "gold")).toThrow();
  });
});

describe("scoring a findings JSON", () => {
  it("a run that finds exactly the gold scores 1 everywhere and respects every abstention", () => {
    const gold = located();
    const score = scoreMatterRun(gold, perfectRun(gold));
    for (const [name, category] of Object.entries(score.categories)) {
      expect(category, name).not.toBeNull();
      expect(category!.recall, `${name} recall`).toBe(1);
      expect(category!.precision, `${name} precision`).toBe(1);
      expect(category!.missed, name).toEqual([]);
    }
    expect(score.categories.evidenceLinks!.runAssertions).toBe(4); // the duplicate link was not counted twice
    expect(score.categories.contradictions!.runAssertions).toBe(2); // relation + item = one assertion
    expect(score.categories.contradictions!.labelAccuracy).toBe(1);
    expect(score.abstentions).toEqual({ total: 4, respected: 4, respectRate: 1, violated: [], unverifiable: [] });
    expect(score.completeness.map((result) => result.status)).toEqual(["met", "met", "met"]);
    expect(score.provenance.unverified).toBe(0);
    expect(score.provenance.verified).toBe(score.provenance.runSources);
  });

  it("asserting what the lawyer said must NOT be asserted is reported as a violation, separately", () => {
    const gold = located();
    const run = perfectRun(gold);
    run.items.push(
      // a1: a formatting difference in the amount called a contradiction
      item("contradiction", "Tutar farklı", [src(gold, "a1#left"), src(gold, "a1#right")], {
        attributes: { relation: "CONTRADICTION" },
      }),
      // a3: a party statement presented as evidence
      item("evidence", "Çatı sızıntısı", [src(gold, "a3#passage")]),
      // a4: a computed deadline shown as an event date
      item("event", "Süre bitti", [src(gold, "a4#passage")], { occurredOn: "2024-04-10" }),
    );
    // a2: the defense the mazbata refutes marked "supported"
    const d2 = run.items.find((entry) => entry["title"] === "İhtarname tebliğ edilmedi")!;
    d2["supportStatus"] = "supported";
    const score = scoreMatterRun(gold, run);
    expect(score.abstentions!.violated.map((violation) => violation.id).sort()).toEqual(["a1", "a2", "a3", "a4"]);
    expect(score.abstentions!.respectRate).toBe(0);
    // Recall is unchanged — finding everything does not offset the violations.
    expect(score.categories.contradictions!.recall).toBe(1);
    expect(score.categories.contradictions!.precision).toBeCloseTo(2 / 3, 4);
    expect(score.categories.chronology!.precision).toBeCloseTo(3 / 4, 4);
    expect(score.noticesTr.join(" ")).toContain("söylenmemeli");
    expect(renderMatterScoreMarkdown(score)).toContain("ihlal: a1");
  });

  it("a forbidden support status is caught whatever kind the run filed the statement under", () => {
    const gold = located();
    const run = perfectRun(gold);
    run.items.push(item("claim", "Tebliğ yapılmadı (iddia diye kaydedilmiş)", [src(gold, "d2#sources.0")], { supportStatus: "supported" }));
    const score = scoreMatterRun(gold, run);
    expect(score.abstentions!.violated).toEqual([
      { id: "a2", type: "no_support_status", by: [run.items[run.items.length - 1]!["itemId"] as string] },
    ]);
  });

  it("a run source whose quote is not the file text at its offsets matches nothing", () => {
    const gold = located();
    const run = perfectRun(gold);
    const c1 = run.items[0]!;
    const sources = c1["sources"] as Array<Record<string, unknown>>;
    sources[0] = { ...sources[0], startChar: (sources[0]!["startChar"] as number) + 1, endChar: (sources[0]!["endChar"] as number) + 1 };
    const score = scoreMatterRun(gold, run);
    expect(score.provenance.unverified).toBe(1);
    expect(score.categories.claims!.missed).toEqual(["c1"]);
    expect(score.categories.claims!.recall).toBe(0.5);
    expect(score.noticesTr.join(" ")).toContain("doğrulanamadı");
  });

  it("accepted alternatives widen the gold; optional entries are never counted as missed", () => {
    const gold = located();
    const run = perfectRun(gold);
    // x2 labelled TENSION: accepted by alt2. x1 labelled TENSION: not accepted.
    const contradictions = run.items.filter((entry) => entry["kind"] === "contradiction");
    (contradictions[1]!["attributes"] as Record<string, unknown>)["relation"] = "TENSION";
    // t3 cited from the petition instead of the mazbata: accepted by alt1.
    const t3 = run.items.find((entry) => entry["occurredOn"] === "2024-03-11")!;
    t3["sources"] = [src(gold, "alt1#acceptSources.0")];
    // l2 (optional) not found at all.
    run.items = run.items.filter((entry) => entry["title"] !== "İhtarnamenin tebliği usule uygun mu");
    let score = scoreMatterRun(gold, run);
    expect(score.categories.contradictions!.labelAccuracy).toBe(1);
    expect(score.categories.chronology!.recall).toBe(1);
    expect(score.categories.legalIssues!.missed).toEqual([]);
    expect(score.categories.legalIssues!.required).toBe(1);
    // x1 is asserted twice (relation list + item); relabel both.
    (contradictions[0]!["attributes"] as Record<string, unknown>)["relation"] = "TENSION";
    (run.relations[0] as Record<string, unknown>)["relation"] = "TENSION";
    score = scoreMatterRun(gold, run);
    expect(score.categories.contradictions!.labelAccuracy).toBe(0.5);
  });

  it("an empty category means 'there is none': every assertion of that kind is wrong", () => {
    const raw = sample();
    raw["contradictions"] = [];
    raw["alternatives"] = (raw["alternatives"] as Array<{ appliesTo: string }>).filter((alt) => alt.appliesTo !== "x2");
    const gold = located(raw);
    const run = perfectRun(located());
    const score = scoreMatterRun(gold, run);
    expect(score.categories.contradictions!.recall).toBeNull();
    expect(score.categories.contradictions!.precision).toBe(0);
    expect(score.categories.contradictions!.unmatched).toHaveLength(2);
    // An absent category is not scored at all.
    const unannotated = sample();
    delete unannotated["legalIssues"];
    unannotated["alternatives"] = (unannotated["alternatives"] as Array<{ appliesTo: string }>).filter((alt) => alt.appliesTo !== "l2");
    expect(scoreMatterRun(located(unannotated), run).categories.legalIssues).toBeNull();
  });

  it("completeness is 'unknown' when the response does not say, never 'met'", () => {
    const gold = located();
    const run = perfectRun(gold) as Record<string, unknown>;
    delete run["processingCoverage"];
    const unknown = scoreMatterRun(gold, run);
    expect(unknown.completeness.find((result) => result.id === "k2")!.status).toBe("unknown");
    expect(unknown.completeness.find((result) => result.id === "k3")!.status).toBe("unknown");

    const raw = sample();
    raw["completenessRequirements"] = [{ id: "g1", type: "coverage_gap_reported" }];
    const gapGold = located(raw);
    const claimedComplete = scoreMatterRun(gapGold, perfectRun(gapGold));
    expect(claimedComplete.completeness[0]!.status).toBe("not_met");
    const honest = {
      ...perfectRun(gapGold),
      processingCoverage: { complete: false, filesTotal: 4, filesProcessed: 3 },
      exhaustiveClaimRefusedBecause: "Bir dosya okunamadı.",
    };
    expect(scoreMatterRun(gapGold, honest).completeness[0]!.status).toBe("met");
    const silent = { ...honest, exhaustiveClaimRefusedBecause: null };
    expect(scoreMatterRun(gapGold, silent).completeness[0]!.status).toBe("not_met");
  });

  it("rejects a findings JSON of the wrong shape, and the report carries no file text", () => {
    const gold = located();
    expect(() => scoreMatterRun(gold, { items: [{ kind: "claim" }] })).toThrow(/wrong shape/u);
    const markdown = renderMatterScoreMarkdown(scoreMatterRun(gold, perfectRun(gold)));
    expect(markdown).toContain("sentetik");
    expect(markdown).not.toContain("Davalı, Mart 2024 kira bedelini ödememiştir.");
  });

  it("spans are credited only when each covers at least half of the other, in the same file only", () => {
    // W21 #34: this test pinned the old shorter-span rule, under which any
    // run quote CONTAINING a gold passage matched it; containment alone no
    // longer earns credit.
    expect(spansMatch({ fileId: "a", start: 0, end: 10 }, { fileId: "a", start: 2, end: 12 })).toBe(true);
    expect(spansMatch({ fileId: "a", start: 0, end: 43 }, { fileId: "a", start: 0, end: 46 })).toBe(true); // the whole numbered line
    expect(spansMatch({ fileId: "a", start: 0, end: 10 }, { fileId: "a", start: 4, end: 20 })).toBe(false);
    expect(spansMatch({ fileId: "a", start: 40, end: 84 }, { fileId: "a", start: 0, end: 192 })).toBe(false); // three lines for one
    expect(spansMatch({ fileId: "a", start: 0, end: 10 }, { fileId: "b", start: 0, end: 10 })).toBe(false);
    expect(spansMatch({ fileId: "a", start: 0, end: 10 }, { fileId: "a", start: 10, end: 12 })).toBe(false);
    // Detecting a forbidden assertion keeps the lenient (shorter-span) reading.
    expect(spansTouch({ fileId: "a", start: 0, end: 10 }, { fileId: "a", start: 4, end: 20 })).toBe(true);
    expect(spansTouch({ fileId: "a", start: 40, end: 84 }, { fileId: "a", start: 0, end: 192 })).toBe(true);
    expect(spansTouch({ fileId: "a", start: 0, end: 10 }, { fileId: "a", start: 6, end: 20 })).toBe(false);
    expect(spansTouch({ fileId: "a", start: 0, end: 10 }, { fileId: "b", start: 0, end: 10 })).toBe(false);
  });
});

describe("W21 verifier fixes · the scorer never credits what it cannot check", () => {
  it("an unresolved forbidden relation makes a no_contradiction abstention unverifiable, never respected", () => {
    const gold = located();
    const run = perfectRun(gold);
    run.relations.push({
      relation: "CONTRADICTION",
      left: { observationId: "obs:nowhere-left", fileId: "f-dilekce" },
      right: { observationId: "obs:nowhere-right", fileId: "f-cevap" },
    });
    const score = scoreMatterRun(gold, run);
    expect(score.abstentions!.violated).toEqual([]);
    expect(score.abstentions!.unverifiable.map((entry) => entry.id)).toEqual(["a1"]);
    expect(score.abstentions!.respected).toBe(3);
    expect(score.abstentions!.respectRate).toBe(0.75);
    expect(score.noticesTr.join(" ")).toContain("denetlenemedi");
    expect(renderMatterScoreMarkdown(score)).toContain("denetlenemedi: a1");
  });

  it("a contradiction alternative must name its side, and widens only that side", () => {
    const missingSide = structuredClone(sample()) as { alternatives: unknown[] };
    missingSide.alternatives.push({
      id: "alt8",
      appliesTo: "x1",
      description: "Dekonttaki açıklama aynı ödemeyi söyler.",
      acceptSources: [{ fileId: "f-dekont", quote: "Açıklama: Mart 2024 kira bedeli" }],
    });
    const refused = parseMatterGold(missingSide, {});
    expect(refused.located).toBeUndefined();
    expect(refused.errors.join(" ")).toContain("must name the side");

    const raw = structuredClone(sample()) as { alternatives: unknown[] };
    raw.alternatives.push({
      id: "alt9",
      appliesTo: "x1",
      side: "right",
      description: "Dekonttaki açıklama sağ tarafı yeniden söyler.",
      acceptSources: [{ fileId: "f-dekont", quote: "Açıklama: Mart 2024 kira bedeli" }],
    });
    const gold = located(raw);
    const withoutX1 = (): ReturnType<typeof perfectRun> => {
      const run = perfectRun(gold);
      run.items = run.items.filter((entry) => entry["title"] !== "Ödeme konusunda bağdaşmayan ifadeler");
      run.relations = [];
      return run;
    };
    // The restatement paired with the side it restates: not the gold pair.
    const selfPair = withoutX1();
    selfPair.items.push(
      item("contradiction", "Yeniden söyleyiş ile kendisi", [src(gold, "alt9#acceptSources.0"), src(gold, "x1#right")], {
        attributes: { relation: "CONTRADICTION" },
      }),
    );
    expect(scoreMatterRun(gold, selfPair).categories.contradictions!.missed).toContain("x1");
    // The restatement standing in for the right side against the left: found.
    const restated = withoutX1();
    restated.items.push(
      item("contradiction", "Sol taraf ile sağın yeniden söyleyişi", [src(gold, "x1#left"), src(gold, "alt9#acceptSources.0")], {
        attributes: { relation: "CONTRADICTION" },
      }),
    );
    expect(scoreMatterRun(gold, restated).categories.contradictions!.missed).not.toContain("x1");
  });

  it("a month-only run event is not credited as an exact gold date", () => {
    const gold = located();
    const exact = scoreMatterRun(gold, perfectRun(gold));
    expect(exact.categories.chronology!.missed).toEqual([]);
    const run = perfectRun(gold);
    const havale = run.items.find((entry) => entry["title"] === "Havale yapıldı")!;
    havale["datePrecision"] = "month";
    expect(scoreMatterRun(gold, run).categories.chronology!.missed).toContain("t2");
    havale["datePrecision"] = "exact";
    expect(scoreMatterRun(gold, run).categories.chronology!.missed).toEqual([]);
  });
});

describe("W21 hostile-review fixes · matter gold scoring (lane F1)", () => {
  it("#32 a forbidden support status, item kind or date on an uncheckable source is 'denetlenemedi', never respected", () => {
    const gold = located();
    // d2 marked "supported", its basis one code point off: the scorer cannot
    // tell whether this is the refuted defense, so a2 is not "respected".
    const run = perfectRun(gold);
    const d2 = run.items.find((entry) => entry["title"] === "İhtarname tebliğ edilmedi")!;
    d2["supportStatus"] = "supported";
    d2["sources"] = [shifted(src(gold, "d2#sources.0")), src(gold, "e4#evidence.0", "oppose")];
    const score = scoreMatterRun(gold, run);
    expect(score.provenance.unverified).toBe(1);
    expect(score.abstentions!.violated).toEqual([]);
    expect(score.abstentions!.unverifiable).toEqual([{ id: "a2", type: "no_support_status", by: [d2["itemId"] as string] }]);
    expect(score.abstentions!.respected).toBe(3);
    expect(score.abstentions!.respectRate).toBe(0.75);
    expect(score.noticesTr.join(" ")).toContain("denetlenemedi");
    expect(renderMatterScoreMarkdown(score)).toContain("denetlenemedi: a2");

    // The same for no_item (unverified offsets) and no_event_date (a file
    // this gold cannot read), and for an item that cites nothing at all.
    const more = perfectRun(gold);
    more.items.push(
      item("evidence", "Çatı sızıntısı", [shifted(src(gold, "a3#passage"))]),
      item("fact", "Süre doldu", [{ ...src(gold, "a4#passage"), fileId: "f-baska" }], { occurredOn: "2024-04-10" }),
      item("defense", "Tebliğ yapılmadı", [], { supportStatus: "supported" }),
    );
    const unchecked = scoreMatterRun(gold, more);
    expect(unchecked.provenance.outOfScope).toBe(1);
    expect(unchecked.abstentions!.violated).toEqual([]);
    expect(unchecked.abstentions!.unverifiable.map((entry) => entry.id)).toEqual(["a2", "a3", "a4"]);
    expect(unchecked.abstentions!.respected).toBe(1);

    // A verified basis on another passage rules an item out: the perfect run
    // has "supported" items (c2, d1), yet a2 stays respected.
    expect(scoreMatterRun(gold, perfectRun(gold)).abstentions!.unverifiable).toEqual([]);
  });

  it("#33 a forbidden date is caught on any dated item, not only on event items", () => {
    for (const kind of ["fact", "claim", "evidence"]) {
      const gold = located();
      const run = perfectRun(gold);
      const dated = item(kind, "Süre 10.04.2024 günü doldu", [src(gold, "a4#passage")], {
        occurredOn: "2024-04-10",
        datePrecision: "exact",
      });
      run.items.push(dated);
      const score = scoreMatterRun(gold, run);
      expect(score.abstentions!.violated, kind).toEqual([{ id: "a4", type: "no_event_date", by: [dated["itemId"] as string] }]);
      // The chronology category stays the timeline: event items only.
      expect(score.categories.chronology!.runAssertions, kind).toBe(3);
    }
  });

  it("#34 the stricter credit rule does not weaken detection: a forbidden assertion on a longer passage is still a violation", () => {
    const gold = located();
    const run = perfectRun(gold);
    const dated = item("event", "Ödeme süresi doldu", [quoteSrc(gold, "f-dilekce", "Davalıya 11.03.2024", "süre verilmiştir.")], {
      occurredOn: "2024-04-10",
    });
    run.items.push(dated);
    expect(scoreMatterRun(gold, run).abstentions!.violated).toEqual([
      { id: "a4", type: "no_event_date", by: [dated["itemId"] as string] },
    ]);
    // The same for a forbidden item kind and a forbidden support status: the
    // whole cevap body (lines 1-3, more than twice the passage) earns no
    // credit under spansMatch, yet still asserts the forbidden thing.
    const wide = quoteSrc(gold, "f-cevap", "1. Mart 2024", "giderilmemiştir.");
    const wideSpan = { fileId: "f-cevap", start: wide["startChar"] as number, end: wide["endChar"] as number };
    expect(spansMatch(wideSpan, gold.spans.get("a3#passage")!)).toBe(false);
    expect(spansTouch(wideSpan, gold.spans.get("a3#passage")!)).toBe(true);
    expect(spansMatch(wideSpan, gold.spans.get("d2#sources.0")!)).toBe(false);
    const long = perfectRun(gold);
    const asEvidence = item("evidence", "Cevap dilekçesi", [wide]);
    const asSupported = item("defense", "Cevap dilekçesindeki savunmalar", [wide], { supportStatus: "supported" });
    long.items.push(asEvidence, asSupported);
    expect(scoreMatterRun(gold, long).abstentions!.violated).toEqual([
      { id: "a2", type: "no_support_status", by: [asSupported["itemId"] as string] },
      { id: "a3", type: "no_item", by: [asEvidence["itemId"] as string] },
    ]);
  });

  it("#34 one long quote spanning two claims finds neither; one item is credited to one gold entry only", () => {
    const gold = located();
    const withoutClaims = (): ReturnType<typeof perfectRun> => {
      const run = perfectRun(gold);
      run.items = run.items.filter((entry) => entry["kind"] !== "claim");
      return run;
    };
    // One undifferentiated assertion quoting dilekçe lines 2-4.
    const long = withoutClaims();
    const merged = item("claim", "Kira ödenmedi, ihtar tebliğ edildi, süre geçti", [
      quoteSrc(gold, "f-dilekce", "2. Davalı, Mart", "ödeme yapılmamıştır."),
    ]);
    long.items.push(merged);
    const claims = scoreMatterRun(gold, long).categories.claims!;
    expect(claims.found).toBe(0);
    expect(claims.missed).toEqual(["c1", "c2"]);
    expect(claims.unmatched).toEqual([merged["itemId"] as string]);
    expect(claims.precision).toBe(0);

    // One item citing c1's and c2's passages exactly: one assertion, one claim.
    const twoSources = withoutClaims();
    twoSources.items.push(item("claim", "İki iddia tek kayıtta", [src(gold, "c1#sources.0"), src(gold, "c2#sources.0")]));
    let score = scoreMatterRun(gold, twoSources);
    expect(score.categories.claims!.found).toBe(1);
    expect(score.categories.claims!.recall).toBe(0.5);
    expect(score.noticesTr.join(" ")).toContain("yalnız bir altın kayıt için sayıldı");
    // A second item for c2: now each gold claim has its own assertion.
    twoSources.items.push(item("claim", "İkinci iddia ayrıca", [src(gold, "c2#sources.1")]));
    score = scoreMatterRun(gold, twoSources);
    expect(score.categories.claims!.found).toBe(2);
    expect(score.categories.claims!.missed).toEqual([]);
  });

  it("#34 a contradiction whose side is a paragraph holding both same-file gold sides is not found", () => {
    const raw = sample();
    (raw["contradictions"] as unknown[]).push({
      id: "x3",
      relation: "TENSION",
      left: { fileId: "f-dilekce", quote: "Davalıya 11.03.2024 tarihinde ihtarname tebliğ edilmiş" },
      right: { fileId: "f-dilekce", quote: "Verilen süre içinde de ödeme yapılmamıştır." },
    });
    const gold = located(raw);
    const wide = perfectRun(gold);
    wide.items.push(
      item("contradiction", "Paragraf ile kendi cümlesi", [quoteSrc(gold, "f-dilekce", "3. Davalıya", "ödeme yapılmamıştır."), src(gold, "x3#right")], {
        attributes: { relation: "TENSION" },
      }),
    );
    const widely = scoreMatterRun(gold, wide).categories.contradictions!;
    expect(widely.missed).toEqual(["x3"]);
    expect(widely.unmatched).toHaveLength(1);
    // The two sentences cited as two separate sides: found.
    const exact = perfectRun(gold);
    exact.items.push(
      item("contradiction", "İki ayrı cümle", [src(gold, "x3#left"), src(gold, "x3#right")], { attributes: { relation: "TENSION" } }),
    );
    expect(scoreMatterRun(gold, exact).categories.contradictions!.missed).toEqual([]);
  });

  it("#34 contradiction sides must be two separate passages, each standing for one gold side", () => {
    const asSpan = (source: Record<string, unknown>): { fileId: string; start: number; end: number } => ({
      fileId: source["fileId"] as string,
      start: source["startChar"] as number,
      end: source["endChar"] as number,
    });
    // (a) The two run sides overlap each other: one stretch cut in two is
    // not two statements, although each cut matches one gold side.
    const raw = sample();
    (raw["contradictions"] as unknown[]).push({
      id: "x3",
      relation: "TENSION",
      left: { fileId: "f-dilekce", quote: "Davalıya 11.03.2024 tarihinde ihtarname tebliğ edilmiş" },
      right: { fileId: "f-dilekce", quote: "Verilen süre içinde de ödeme yapılmamıştır." },
    });
    const gold = located(raw);
    const left = quoteSrc(gold, "f-dilekce", "Davalıya 11.03.2024", "ödeme için otuz");
    const right = quoteSrc(gold, "f-dilekce", "otuz gün", "ödeme yapılmamıştır.");
    expect(spansMatch(asSpan(left), gold.spans.get("x3#left")!)).toBe(true);
    expect(spansMatch(asSpan(right), gold.spans.get("x3#right")!)).toBe(true);
    expect(asSpan(left).end).toBeGreaterThan(asSpan(right).start); // they share "otuz"
    const overlapping = perfectRun(gold);
    overlapping.items.push(item("contradiction", "Tek parça ikiye bölünmüş", [left, right], { attributes: { relation: "TENSION" } }));
    const overlapped = scoreMatterRun(gold, overlapping).categories.contradictions!;
    expect(overlapped.missed).toEqual(["x3"]);
    expect(overlapped.unmatched).toHaveLength(1);

    // (b) One run side matches BOTH gold sides (degenerate gold whose sides
    // overlap each other): it identifies neither, so the pair is not the
    // gold pair even when the other side matches through an alternative.
    const degenerate = sample();
    (degenerate["contradictions"] as unknown[]).push({
      id: "x4",
      relation: "TENSION",
      left: { fileId: "f-dilekce", quote: "aylık 10.000 TL bedelli kira" },
      right: { fileId: "f-dilekce", quote: "10.000 TL bedelli kira sözleşmesi" },
    });
    (degenerate["alternatives"] as unknown[]).push({
      id: "alt4",
      appliesTo: "x4",
      side: "right",
      description: "Dekonttaki tutar sağ tarafı yeniden söyler.",
      acceptSources: [{ fileId: "f-dekont", quote: "Tutar: 10.000,00 TL" }],
    });
    const gold4 = located(degenerate);
    const both = quoteSrc(gold4, "f-dilekce", "aylık 10.000 TL", "kira sözleşmesi");
    expect(spansMatch(asSpan(both), gold4.spans.get("x4#left")!)).toBe(true);
    expect(spansMatch(asSpan(both), gold4.spans.get("x4#right")!)).toBe(true);
    const ambiguous = perfectRun(gold4);
    ambiguous.items.push(
      item("contradiction", "İki tarafı birden kapsayan alıntı", [both, src(gold4, "alt4#acceptSources.0")], {
        attributes: { relation: "TENSION" },
      }),
    );
    expect(scoreMatterRun(gold4, ambiguous).categories.contradictions!.missed).toEqual(["x4"]);
  });

  it("#34 one-to-one credit holds for chronology, legal issues and evidence links too", () => {
    const raw = sample();
    // t9 is t2 read at month precision; l9 wants the keyword l1 already
    // wants; e9 is e1's first passage once more. One run assertion matches
    // each pair and is credited to one of them only.
    (raw["chronology"] as unknown[]).push({
      id: "t9",
      date: "2024-03",
      precision: "month",
      description: "Mart 2024 içinde yapılan havale",
      sources: [{ fileId: "f-dekont", quote: "İşlem tarihi: 05.03.2024" }],
    });
    (raw["legalIssues"] as unknown[]).push({ id: "l9", statement: "Tahliye şartları", keywords: ["tahliye"] });
    (raw["evidenceLinks"] as unknown[]).push({
      id: "e9",
      target: "d1",
      stance: "supports",
      evidence: [{ fileId: "f-dekont", quote: "Açıklama: Mart 2024 kira bedeli" }],
    });
    const gold = located(raw);
    const score = scoreMatterRun(gold, perfectRun(gold));
    expect(score.categories.chronology!.required).toBe(4);
    expect(score.categories.chronology!.found).toBe(3);
    expect(score.categories.chronology!.missed).toHaveLength(1);
    expect(score.categories.legalIssues!.required).toBe(2);
    expect(score.categories.legalIssues!.found).toBe(1);
    expect(score.categories.evidenceLinks!.required).toBe(5);
    expect(score.categories.evidenceLinks!.found).toBe(4);
    // Precision is untouched: none of those assertions is wrong.
    expect(score.categories.chronology!.precision).toBe(1);
    expect(score.categories.legalIssues!.precision).toBe(1);
    expect(score.categories.evidenceLinks!.precision).toBe(1);
    expect(score.noticesTr.join(" ")).toContain("3 sistem kaydı altın dosyada birden çok kayda uyuyordu");
    // A second, month-precision event for t9: every gold event now has its own.
    const run = perfectRun(gold);
    run.items.push(item("event", "Mart ayı içinde havale", [src(gold, "t9#sources.0")], { occurredOn: "2024-03-05", datePrecision: "month" }));
    expect(scoreMatterRun(gold, run).categories.chronology!.missed).toEqual([]);
  });

  it("#44 coverage_gap_reported is 'unknown' when the response does not carry the refusal field", () => {
    const raw = sample();
    raw["completenessRequirements"] = [{ id: "g1", type: "coverage_gap_reported" }];
    const gapGold = located(raw);
    const run = {
      ...perfectRun(gapGold),
      processingCoverage: { complete: false, filesTotal: 4, filesProcessed: 3 },
    } as Record<string, unknown>;
    delete run["exhaustiveClaimRefusedBecause"];
    const score = scoreMatterRun(gapGold, run);
    expect(score.completeness[0]!.status).toBe("unknown");
    expect(score.noticesTr.join(" ")).toContain("'bilinmiyor' olarak bırakıldı");
    expect(renderMatterScoreMarkdown(score)).toContain("g1 (coverage_gap_reported): bilinmiyor");
  });

  it("#45 the JSON Schema and the validator agree on chronology date/precision combinations", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8")) as JsonSchema;
    expect(schemaValid(schema, schema, sample())).toBe(true);
    const cases: Array<[string, string | undefined, boolean]> = [
      ["2024", "exact", false],
      ["2024", "month", false],
      ["2024-03", "exact", false],
      ["2024-03-05", "exact", true],
      ["2024-03", "month", true],
      ["2024-03-05", "month", true],
      ["2024", "year", true],
      ["2024", undefined, true],
      ["2024-03", "approximate", true],
    ];
    for (const [date, precision, valid] of cases) {
      const raw = sample();
      const t1 = (raw["chronology"] as Array<Record<string, unknown>>)[0]!;
      t1["date"] = date;
      if (precision === undefined) delete t1["precision"];
      else t1["precision"] = precision;
      expect(schemaValid(schema, schema, raw), `schema ${date}/${precision}`).toBe(valid);
      expect(parseMatterGold(raw).errors.length === 0, `validator ${date}/${precision}`).toBe(valid);
    }
    // Other shape rules the schema carries agree with the validator too.
    const unsigned = { ...sample(), source: "lawyer_annotated", annotators: [] };
    expect(schemaValid(schema, schema, unsigned)).toBe(false);
    expect(parseMatterGold(unsigned).errors).not.toEqual([]);
    const extraField = { ...sample(), score: 1 };
    expect(schemaValid(schema, schema, extraField)).toBe(false);
    expect(parseMatterGold(extraField).errors).not.toEqual([]);
  });
});

describe("W21 review round two · evidence-link precision keeps what it cannot check (R2-38)", () => {
  /** A copy of e1's dekont quote one code point off, under its own observation id. */
  const drifted = (gold: LocatedGold, n: number, role = "basis"): Record<string, unknown> => ({
    ...shifted(src(gold, "e1#evidence.0", role)),
    observationId: `obs:kayık-${n}`,
  });

  it("four support links whose evidence cannot be verified count as four wrong assertions, not as none", () => {
    const gold = located();
    const run = perfectRun(gold);
    const d1 = run.items.find((entry) => entry["title"] === "Mart kirası havale ile ödendi")!;
    const unverifiable = [1, 2, 3, 4].map((n) => item("evidence", `Doğrulanamayan delil ${n}`, [drifted(gold, n)]));
    run.items.push(...unverifiable);
    run.links.push(...unverifiable.map((entry) => ({ fromItemId: entry["itemId"], toItemId: d1["itemId"], linkKind: "supports" })));
    const score = scoreMatterRun(gold, run);
    const links = score.categories.evidenceLinks!;
    // Before: runAssertions 4, precision 1.000 — the four links did not exist for the scorer.
    expect(links.runAssertions).toBe(8);
    expect(links.matchedRunAssertions).toBe(4);
    expect(links.precision).toBe(0.5);
    expect(links.unresolvedRunAssertions).toBe(4);
    expect(links.recall).toBe(1);
    expect(links.unmatched).toHaveLength(4);
    expect(score.provenance.unverified).toBe(4);
    expect(score.noticesTr.join(" ")).toContain("kesinlik hesabında kaldı");
    const markdown = renderMatterScoreMarkdown(score);
    expect(markdown).toContain("| Delil bağlantıları | 4 | 4 | 4 | 1.000 | 8 | 4 | 0.500 | — |");
    expect(markdown).toContain("kaynağı doğrulanamayan sistem bağlantısı: 4");
  });

  it("one checkable link and four uncheckable ones is precision 0.2, like the same shape of claims", () => {
    const gold = located();
    const d1 = item("defense", "Mart kirası havale ile ödendi", [src(gold, "d1#sources.0")]);
    const dekont = item("evidence", "Banka dekontu", [src(gold, "e1#evidence.0")]);
    const uncheckable = [1, 2, 3, 4].map((n) => item("evidence", `Kayık delil ${n}`, [drifted(gold, n)]));
    const run = {
      status: "done",
      items: [d1, dekont, ...uncheckable],
      links: [dekont, ...uncheckable].map((from) => ({ fromItemId: from["itemId"], toItemId: d1["itemId"], linkKind: "supports" })),
    };
    const links = scoreMatterRun(gold, run).categories.evidenceLinks!;
    expect(links.runAssertions).toBe(5);
    expect(links.matchedRunAssertions).toBe(1);
    expect(links.precision).toBe(0.2);

    // The same judgement written twice — a link from the evidence item and a
    // support source on the defense with the same observation id, as
    // stageFinalize writes it — is ONE assertion, verified or not.
    d1["sources"] = [src(gold, "d1#sources.0"), drifted(gold, 1, "support")];
    expect(scoreMatterRun(gold, run).categories.evidenceLinks!.runAssertions).toBe(5);
    // A support source on the defense with no link behind it is an assertion of its own.
    d1["sources"] = [src(gold, "d1#sources.0"), drifted(gold, 9, "support")];
    expect(scoreMatterRun(gold, run).categories.evidenceLinks!.runAssertions).toBe(6);

    // A link to an item the run does not contain, and a link from an item
    // that cites nothing, are assertions that match nothing.
    d1["sources"] = [src(gold, "d1#sources.0")];
    const bare = item("evidence", "Kaynaksız delil", []);
    const more = {
      ...run,
      items: [...run.items, bare],
      links: [
        ...run.links,
        { fromItemId: dekont["itemId"], toItemId: "olmayan-kayıt", linkKind: "opposes" },
        { fromItemId: bare["itemId"], toItemId: d1["itemId"], linkKind: "supports" },
      ],
    };
    const counted = scoreMatterRun(gold, more).categories.evidenceLinks!;
    expect(counted.runAssertions).toBe(7);
    expect(counted.unresolvedRunAssertions).toBe(6);
    expect(counted.precision).toBeCloseTo(1 / 7, 4);
  });
});
