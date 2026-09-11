/**
 * W14/B-20 — yerel kütüphane.
 *
 * ARCH measured `collex_local` as completely empty: 0 documents, 0 chunks. So
 * every research run went to the network for documents it had already fetched,
 * and "Yerel korpus" was permanently ÇEKİMSER. This suite proves the
 * control-plane half: a run's FULL documents are persisted with complete
 * provenance, deduplicated by identity + content hash, never labelled
 * "(SENTETİK)", and a failed write never damages the answer.
 *
 * The Python half (a `SourcePort` over this spool, publishing through the
 * existing ingestion pipeline into `collex_local`) belongs to the lane that
 * owns `ingestion/**` and is requested in W14-L-SOURCES.md — until it lands,
 * NOTHING is written to `collex_local` and the manifest says the library is
 * off rather than implying a growing corpus.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { FakeGateway } from "../../src/gateway/gateway.js";
import type { Outcome } from "../../src/capabilities/types.js";
import {
  DisabledLocalLibrary,
  FileLocalLibrary,
  InMemoryLocalLibrary,
  LIBRARY_ORIGIN_LABEL,
  LIBRARY_RECORD_SCHEMA,
  libraryKey,
  parseLibraryRecord,
  type LibraryWriteInput,
} from "../../src/sources/localLibrary.js";
import { createResearchRouter } from "../../src/research/routes.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const T0 = "2026-09-02T10:00:00.000Z";
const TEXT =
  "Tahliye taahhüdünün kira sözleşmesinden sonra verilmiş olması gerekir.\n\n" +
  "Aksi hâlde taahhüt geçersizdir ve tahliye kararı verilemez; bu husus resen gözetilir.";

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collex-library-"));
  tempDirs.push(dir);
  return dir;
}

function input(overrides: Partial<LibraryWriteInput> = {}): LibraryWriteInput {
  const text = overrides.text ?? TEXT;
  return {
    source: "BEDESTEN",
    externalId: "doc-1",
    title: "Yargıtay 3. HD kararı",
    sourceUrl: "https://mevzuat.adalet.gov.tr/ictihat/doc-1",
    toolName: "fetch",
    fetchedAt: T0,
    text,
    contentSha256: sha256HexUtf8(text),
    ...overrides,
  };
}

describe("B-20 spool record", () => {
  it("keys a record by provider + external id + content hash", () => {
    const key = libraryKey("BEDESTEN", "doc-1", "a".repeat(64));
    expect(key).toBe(`BEDESTEN__doc-1__${"a".repeat(16)}`);
    // A URL-shaped external id stays a safe file name.
    expect(libraryKey("KVKK", "https://kvkk.gov.tr/x?y=1", "b".repeat(64))).toMatch(
      /^KVKK__https_kvkk.gov.tr_x_y_1__b{16}$/u,
    );
  });

  it("writes full provenance and NEVER the word SENTETİK", async () => {
    const dir = await tempDir();
    const library = new FileLocalLibrary(dir);
    const outcome = await library.put(input());
    expect(outcome.action).toBe("written");
    expect(outcome.path).toBeDefined();

    const raw = await readFile(outcome.path as string, "utf8");
    expect(raw).not.toContain("SENTETİK");
    const record = parseLibraryRecord(raw);
    expect(record).toBeDefined();
    expect(record?.schema).toBe(LIBRARY_RECORD_SCHEMA);
    expect(record?.originLabel).toBe(LIBRARY_ORIGIN_LABEL);
    expect(record?.originLabel).toBe("resmî kaynak");
    expect(record?.scope).toBe("public");
    expect(record?.source).toBe("BEDESTEN");
    expect(record?.externalId).toBe("doc-1");
    expect(record?.sourceUrl).toContain("mevzuat.adalet.gov.tr");
    expect(record?.toolName).toBe("fetch");
    expect(record?.fetchedAt).toBe(T0);
    expect(record?.contentSha256).toBe(sha256HexUtf8(TEXT));
    expect(record?.contentCodePoints).toBe([...TEXT].length);
  });

  it("deduplicates the same document with the same text", async () => {
    const dir = await tempDir();
    const library = new FileLocalLibrary(dir);
    expect((await library.put(input())).action).toBe("written");
    expect((await library.put(input())).action).toBe("duplicate");
    expect(await library.keys()).toHaveLength(1);
  });

  it("keeps a CHANGED text as a separate record, so a new version can be appended", async () => {
    const dir = await tempDir();
    const library = new FileLocalLibrary(dir);
    await library.put(input());
    await library.put(input({ text: `${TEXT} Ek fıkra.` }));
    const keys = await library.keys();
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((k) => k.split("__")[1]))).toEqual(new Set(["doc-1"]));
  });

  it("refuses an envelope it does not know or a record whose length lies", () => {
    expect(parseLibraryRecord("not json")).toBeUndefined();
    expect(parseLibraryRecord(JSON.stringify({ schema: "other" }))).toBeUndefined();
    expect(
      parseLibraryRecord(
        JSON.stringify({
          schema: LIBRARY_RECORD_SCHEMA,
          text: "abc",
          contentSha256: "x",
          contentCodePoints: 99,
          originLabel: LIBRARY_ORIGIN_LABEL,
        }),
      ),
    ).toBeUndefined();
  });

  it("reports a write it could not perform instead of pretending it worked", async () => {
    const library = new FileLocalLibrary(join(await tempDir(), "\u0000invalid"));
    const outcome = await library.put(input());
    expect(outcome.action).toBe("failed");
    expect(outcome.reason).toMatch(/^LIBRARY_WRITE_FAILED:/u);
  });

  it("is OFF by default and says so", async () => {
    const disabled = new DisabledLocalLibrary();
    const outcome = await disabled.put(input());
    expect(outcome.action).toBe("failed");
    expect(outcome.reason).toBe("LIBRARY_DISABLED");
    expect(await disabled.keys()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A live research run fills the library
// ---------------------------------------------------------------------------

function ok(data: unknown): Outcome<unknown> {
  return { status: "ok", data, provider: "BEDESTEN", observedAt: T0, warnings: [] };
}

function researchGateway(): FakeGateway {
  return new FakeGateway((request) => {
    if (request.toolName === "search_bedesten_unified") {
      return ok({
        decisions: [
          {
            documentId: "doc-77",
            itemType: { name: "YARGITAYKARARI" },
            esasNo: "2023/9",
            kararNo: "2024/4",
            kararTarihi: "2024-05-11T00:00:00.000Z",
          },
        ],
      });
    }
    if (request.toolName === "fetch") {
      return ok({
        id: request.args["id"],
        title: "Yargıtay kararı",
        text: TEXT,
        url: "https://mevzuat.adalet.gov.tr/ictihat/doc-77",
      });
    }
    if (request.toolName === "search_mevzuat") return ok({ result: "Sonuç bulunamadı." });
    return ok({ decisions: [] });
  });
}

describe("B-20 a live research run fills the library", () => {
  it("spools every fetched full document with its run id", async () => {
    const library = new InMemoryLocalLibrary();
    const app = createResearchRouter({
      gateway: researchGateway(),
      library,
      now: () => T0,
      newRunId: () => "run-library",
    });
    const response = await app.request("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "tahliye taahhüdü geçerlilik şartları nelerdir" }),
    });
    expect(response.status).toBe(200);

    const records = [...library.records.values()];
    expect(records.length).toBeGreaterThan(0);
    const record = records[0];
    expect(record?.source).toBe("BEDESTEN");
    expect(record?.externalId).toBe("doc-77");
    expect(record?.runId).toBe("run-library");
    expect(record?.originLabel).toBe("resmî kaynak");
    expect(record?.contentSha256).toBe(sha256HexUtf8(record?.text ?? ""));
  });

  it("does not touch the library when none is configured (today's behaviour)", async () => {
    const app = createResearchRouter({
      gateway: researchGateway(),
      now: () => T0,
      newRunId: () => "run-no-library",
    });
    const response = await app.request("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "tahliye taahhüdü geçerlilik şartları nelerdir" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { warnings: string[] };
    expect(body.warnings.some((w) => w.startsWith("LIBRARY_"))).toBe(false);
  });

  it("warns but does not fail the run when the library cannot be written", async () => {
    const failing = {
      async put(): Promise<{ action: "failed"; key: string; reason: string }> {
        return { action: "failed", key: "k", reason: "LIBRARY_WRITE_FAILED:Error" };
      },
      async keys(): Promise<string[]> {
        return [];
      },
    };
    const app = createResearchRouter({
      gateway: researchGateway(),
      library: failing,
      now: () => T0,
      newRunId: () => "run-library-fail",
    });
    const response = await app.request("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "tahliye taahhüdü geçerlilik şartları nelerdir" }),
    });
    // The ANSWER still stands: a library that cannot be written is a smaller
    // library, not a wrong answer.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { warnings: string[]; evidence: unknown[] };
    expect(body.warnings.some((w) => w.startsWith("LIBRARY_WRITE_FAILED:"))).toBe(true);
    expect(body.evidence.length).toBeGreaterThan(0);
  });
});
