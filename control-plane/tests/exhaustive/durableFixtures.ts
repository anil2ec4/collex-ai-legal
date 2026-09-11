/**
 * Shared fixtures for the W20 durable-analysis suites.
 *
 * Uploads are inserted with the SAME column shape intake writes (the proven
 * shape from tests/store/fixtures.ts), including chunks and a page map, so
 * the durable store reads them exactly as it reads a real upload. The text is
 * synthetic: this proves plumbing and provenance, never Turkish legal quality.
 */

import { createHash } from "node:crypto";
import type { Sql } from "../../src/store/db.js";
import { LOCAL_TENANT_ID } from "../../src/exhaustive/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import type { JsonGenerator } from "../../src/exhaustive/modelExtractor.js";
import {
  LocalGenerationError,
  type GenerateJsonRequest,
} from "../../src/llm/localGenerationAdapter.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const FILLER =
  "Bu paragraf dosyanın hacmini artırmak için eklenmiş olup esasa ilişkin" +
  " hiçbir bilgi içermemektedir ve yalnızca metnin uzunluğunu sağlamak amacıyla" +
  " buraya yazılmıştır; okunması gerekmez, ancak okunduğu kayda geçmelidir.";

/** `count` filler paragraphs with `planted` paragraphs spread through them. */
export function paragraphs(planted: readonly string[], count = 40): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < count; i += 1) blocks.push(`Paragraf ${i + 1}. ${FILLER}`);
  planted.forEach((text, index) => {
    const at = Math.min(blocks.length, Math.floor(((index + 1) * count) / (planted.length + 1)));
    blocks.splice(at, 0, text);
  });
  return blocks;
}

async function insertVersion(
  sql: Sql,
  documentId: string,
  fileId: string,
  label: string,
  blocks: readonly string[],
  unreadablePage: boolean,
): Promise<string> {
  const canonical = blocks.join("\n\n");
  const snapRows = await sql`
    insert into legal.source_snapshots
      (source, external_id, retrieved_at, media_type, raw_sha256,
       parser_name, parser_version)
    values ('UPLOAD', ${fileId}, now(), 'text/plain',
            ${sha256(`${fileId}:${label}:${canonical}`)}, 'test-parser', '1.0.0')
    returning id`;
  const snapshotId = String(snapRows[0]!["id"]);
  const versionRows = await sql`
    insert into legal.document_versions
      (document_id, source_snapshot_id, version_label, status,
       canonical_text, normalized_text, content_sha256)
    values (${documentId}, ${snapshotId}, ${label}, 'published',
            ${canonical}, ${canonical.toLowerCase()}, ${sha256(canonical)})
    returning id`;
  const versionId = String(versionRows[0]!["id"]);
  let cursor = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const text = blocks[index] as string;
    const start = cursor;
    const end = start + [...text].length;
    await sql`
      insert into legal.chunks
        (document_version_id, ordinal, structural_path, start_char, end_char,
         original_text, search_text, normalizer_version, content_sha256)
      values (${versionId}, ${index}, ${["metin"]}, ${start}, ${end}, ${text},
              ${text.toLowerCase()}, 'trnorm-v1', ${sha256(text)})`;
    cursor = end + 2;
  }
  const length = [...canonical].length;
  await sql`
    insert into legal.document_version_segments (document_version_id,
      segment_no, locator_kind, locator_label, start_char, end_char,
      extraction_method, extraction_status)
    values (${versionId}, 1, 'page', '1', 0, ${length}, 'pdf_text_layer', 'EXTRACTED')`;
  if (unreadablePage) {
    await sql`
      insert into legal.document_version_segments (document_version_id,
        segment_no, locator_kind, locator_label, start_char, end_char,
        extraction_method, extraction_status)
      values (${versionId}, 2, 'page', '2', ${length}, ${length}, 'none', 'UNREADABLE')`;
  }
  return versionId;
}

/** A tenant upload with chunks and a page map, as intake would write it. */
export async function insertUpload(
  sql: Sql,
  options: {
    fileId: string;
    title: string;
    blocks: readonly string[];
    unreadablePage?: boolean;
    /** Another tenant's upload (isolation tests). Defaults to the local tenant. */
    tenantId?: string;
  },
): Promise<{ documentId: string; versionId: string }> {
  const docRows = await sql`
    insert into legal.documents
      (scope, tenant_id, source, external_id, document_type, jurisdiction, title)
    values ('tenant'::legal.document_scope, ${options.tenantId ?? LOCAL_TENANT_ID}::uuid, 'UPLOAD',
            ${options.fileId}, 'upload', 'TR', ${options.title})
    returning id`;
  const documentId = String(docRows[0]!["id"]);
  const versionId = await insertVersion(
    sql,
    documentId,
    options.fileId,
    "v1",
    options.blocks,
    options.unreadablePage === true,
  );
  return { documentId, versionId };
}

/** Publish a NEW current version of an existing upload (re-upload). */
export async function insertNewVersion(
  sql: Sql,
  documentId: string,
  fileId: string,
  label: string,
  blocks: readonly string[],
): Promise<string> {
  return insertVersion(sql, documentId, fileId, label, blocks, false);
}

export async function linkFiles(
  matters: MatterStore,
  matterId: string,
  fileIds: readonly string[],
): Promise<void> {
  for (const fileId of fileIds) {
    await matters.addItem(matterId, {
      kind: "file",
      refId: fileId,
      payload: { fileName: `${fileId}.pdf` },
    });
  }
}

export interface Requester {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

export async function post(
  app: Requester,
  path: string,
  body: unknown = {},
): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

export async function get(app: Requester, path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path);
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

/**
 * A scripted, deterministic stand-in for a local model.
 *
 * It is a TEST DOUBLE and is named as one: it proves that the product
 * consumes model output correctly (structure, provenance checks, task
 * routing), never that any real model can do the work. Extraction classifies
 * sentences of the unit text by keyword and returns them as EXACT quotes;
 * `fakeQuote` injects one item whose quote does not occur in the text.
 */
export class ScriptedModel implements JsonGenerator {
  readonly trust = "LOCAL_PROCESS" as const;
  readonly calls: GenerateJsonRequest[] = [];

  constructor(
    readonly model = "scripted-test-model",
    private readonly options: {
      fakeQuote?: string;
      failWhen?: (request: GenerateJsonRequest) => boolean;
      unsupportedClaimMarker?: string;
    } = {},
  ) {}

  async generateJson<T = unknown>(request: GenerateJsonRequest): Promise<T> {
    this.calls.push(request);
    if (this.options.failWhen?.(request) === true) {
      throw new LocalGenerationError("scripted failure", "UNREACHABLE");
    }
    const text = request.untrustedText ?? "";
    if (request.instruction.includes("şu türdeki öğeleri çıkar")) {
      return { items: this.extract(text, request.instruction) } as T;
    }
    if (request.instruction.startsWith("İDDİA:")) {
      const refs = [...text.matchAll(/\[(e\d+)\]/gu)].map((match) => match[1] as string);
      const marker = this.options.unsupportedClaimMarker;
      const unsupported = marker !== undefined && request.instruction.includes(marker);
      return {
        links: refs.map((ref, index) => ({
          ref,
          stance: unsupported ? "unrelated" : index === 0 ? "supports" : "unrelated",
          rationale: "sınama gerekçesi",
        })),
      } as T;
    }
    if (request.instruction.includes("Müvekkil:")) {
      const refs = [...text.matchAll(/\[(o\d+)\]/gu)].map((match) => match[1] as string);
      const kinds = request.shapeHint.includes("opposing_theory")
        ? ["opposing_theory", "weakness", "contrary_evidence", "procedural_vulnerability", "hypothetical_argument"]
        : ["favorable_point", "unfavorable_point"];
      return {
        points: [
          ...kinds.map((kind, index) => ({
            kind,
            title: `Sınama noktası ${index + 1} (${kind})`,
            body: null,
            refs: [refs[index % Math.max(1, refs.length)] ?? "o1"],
          })),
          // A point that cites nothing it was shown must be rejected.
          { kind: kinds[0], title: "Dayanaksız nokta", body: null, refs: ["o999"] },
        ],
      } as T;
    }
    return {} as T;
  }

  private extract(text: string, instruction: string): unknown[] {
    const items: unknown[] = [];
    const allowed = (kind: string): boolean => instruction.includes(`- ${kind}:`);
    for (const raw of text.split(/(?<=\.)\s+/u)) {
      const sentence = raw.trim();
      if (sentence.length < 12 || !text.includes(sentence)) continue;
      if (sentence.includes("iddia") && allowed("claim")) {
        items.push({ kind: "claim", text: sentence, quote: sentence, party: "davacı" });
      } else if (sentence.includes("savun") && allowed("defense")) {
        items.push({ kind: "defense", text: sentence, quote: sentence, party: "davalı" });
      } else if (sentence.includes("dekont") && allowed("evidence")) {
        items.push({ kind: "evidence", text: sentence, quote: sentence });
      } else if (sentence.includes("Anlaşmazlık") && allowed("legal_issue")) {
        items.push({ kind: "legal_issue", text: "Kira bedelinin ödenip ödenmediği", quote: sentence });
      } else if (sentence.includes("tebliğ") && allowed("procedural_event")) {
        items.push({ kind: "procedural_event", text: sentence, quote: sentence, date: "2024-03-11" });
      }
      if (sentence.includes("Ahmet Yılmaz") && allowed("entity")) {
        items.push({ kind: "entity", text: "Ahmet Yılmaz", quote: "Ahmet Yılmaz", role: "davacı", entityType: "person" });
      }
    }
    if (this.options.fakeQuote !== undefined && allowed("claim") && items.length > 0) {
      items.push({ kind: "claim", text: "Uydurma iddia", quote: this.options.fakeQuote });
    }
    return items;
  }
}
