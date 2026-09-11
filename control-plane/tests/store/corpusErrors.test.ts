/**
 * Classification of local-corpus failures (retrieval/corpusErrors.ts).
 * Pure unit tests over the error shapes measured on this machine (postgres.js
 * 3.4.9 / PostgreSQL 18.1); the store suite proves the same classification
 * against a real missing database and a real ended pool.
 */

import { describe, expect, it } from "vitest";

import {
  CORPUS_UNAVAILABLE_MESSAGE_TR,
  corpusErrorCode,
  isCorpusUnavailable,
  isCorpusUnavailableCode,
} from "../../src/retrieval/corpusErrors.js";

function coded(message: string, code: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}

describe("isCorpusUnavailable", () => {
  it.each([
    ["ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:55432"],
    ["ETIMEDOUT", "connect ETIMEDOUT 127.0.0.1:55432"],
    ["CONNECT_TIMEOUT", "write CONNECT_TIMEOUT 127.0.0.1:55432"],
    ["CONNECTION_ENDED", "write CONNECTION_ENDED 127.0.0.1:55432"],
    ["CONNECTION_CLOSED", "write CONNECTION_CLOSED 127.0.0.1:55432"],
    ["3D000", 'database "collex_definitely_missing_db" does not exist'],
    ["57P03", "the database system is starting up"],
    ["08006", "connection failure"],
    ["28P01", 'password authentication failed for user "postgres"'],
  ])("classifies code %s as unavailable", (code, message) => {
    expect(isCorpusUnavailable(coded(message, code))).toBe(true);
    expect(isCorpusUnavailableCode(code)).toBe(true);
  });

  it("falls back to the message when the error carries no code", () => {
    expect(isCorpusUnavailable(new Error("connect ECONNREFUSED 127.0.0.1:55432"))).toBe(true);
    expect(isCorpusUnavailable(new Error('database "x" does not exist'))).toBe(true);
    expect(isCorpusUnavailableCode(undefined, "write CONNECT_TIMEOUT 127.0.0.1:55432")).toBe(true);
  });

  it("leaves query-level failures alone: they are about OUR statement", () => {
    expect(isCorpusUnavailable(coded('relation "legal.chunks" does not exist', "42P01"))).toBe(false);
    expect(isCorpusUnavailable(coded('text search configuration "no_such_config" does not exist', "42704"))).toBe(false);
    expect(isCorpusUnavailable(coded("canceling statement due to statement timeout", "57014"))).toBe(false);
    expect(isCorpusUnavailable(new Error("connection pool is closed"))).toBe(false);
    expect(isCorpusUnavailable("not even an error")).toBe(false);
    expect(isCorpusUnavailable(null)).toBe(false);
  });

  it("reads a string code and nothing else", () => {
    expect(corpusErrorCode(coded("x", "3D000"))).toBe("3D000");
    expect(corpusErrorCode(new Error("x"))).toBeUndefined();
    expect(corpusErrorCode({ code: 42 })).toBeUndefined();
    expect(corpusErrorCode(undefined)).toBeUndefined();
  });

  it("the user-facing sentence is Turkish and carries no driver vocabulary", () => {
    // W15: the sentence was rewritten in the lawyer's Turkish (canonical
    // glossary: "korpus" -> "hukuk kütüphanesi"). The BEHAVIOUR pinned here is
    // unchanged and now stricter: one Turkish sentence, no driver vocabulary,
    // AND none of the two words the reader has never heard of.
    expect(CORPUS_UNAVAILABLE_MESSAGE_TR).toBe(
      "Bu bilgisayardaki hukuk kütüphanesi açılamadı, bu yüzden arama yapılamadı." +
        " ColleX'i kapatıp masaüstündeki ColleX simgesine yeniden çift tıklayın;" +
        " kütüphane açılınca arama yeniden çalışır.",
    );
    expect(CORPUS_UNAVAILABLE_MESSAGE_TR).not.toMatch(/ECONN|postgres|127\.0\.0\.1/i);
    expect(CORPUS_UNAVAILABLE_MESSAGE_TR).not.toMatch(/korpus|veritaban/i);
  });
});
