/**
 * W14 (B-42) — kişi kartları + menfaat çatışması uyarısı.
 *
 * KABUL (W13-BACKLOG B-42): a contact is entered ONCE and used in two matters;
 * entering the same name as the opposing side raises the warning; the draft
 * blocks fill from the contact and carry an "otomatik — kontrol edin" chip.
 * The chip is a console string (phase B); the server half proven here is the
 * card, the reuse and the conflict scan.
 */

import { describe, expect, it } from "vitest";
import {
  CONTACT_ROLE_LABELS,
  InMemoryContactStore,
  foldName,
  isValidTckn,
  isVknShaped,
  scanConflicts,
  type Contact,
} from "../../src/matters/contacts.js";
import { createContactsRouter, ContactService, contactWarnings } from "../../src/matters/contactsRoutes.js";
import { createMattersRouter } from "../../src/matters/routes.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import type { Matter, MatterSummary } from "../../src/matters/types.js";

interface ErrorBody {
  error: { kind: string; message: string; issues?: Array<{ path: string; message: string }> };
}

function clock(start = "2026-09-02T09:00:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

function harness() {
  const now = clock();
  const store = new InMemoryMatterStore(now);
  const contacts = new InMemoryContactStore();
  const app = createMattersRouter({ store, contacts, now });
  const json = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  const post = (path: string, body: unknown) =>
    json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const patch = (path: string, body: unknown) =>
    json(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const del = (path: string) => json(path, { method: "DELETE" });
  return { app, store, contacts, now, json, post, patch, del };
}

describe("contact helpers", () => {
  it("folds Turkish names for comparison", () => {
    expect(foldName("  AHMET   YILMAZ ")).toBe(foldName("Ahmet Yılmaz"));
    expect(foldName("Ahmet Yılmaz")).not.toBe(foldName("Ahmet Yilmaz")); // ı ≠ i, documented
  });

  it("checks a TCKN with the official algorithm and a VKN by length", () => {
    expect(isValidTckn("10000000146")).toBe(true); // canonical valid example
    expect(isValidTckn("10000000147")).toBe(false);
    expect(isValidTckn("01000000146")).toBe(false); // leading zero
    expect(isValidTckn("123")).toBe(false);
    expect(isVknShaped("1234567890")).toBe(true);
    expect(isVknShaped("12345")).toBe(false);
  });

  it("a bad identity number is a WARNING, never a rejection", () => {
    expect(contactWarnings({ tckn: "10000000146", vkn: "" })).toEqual([]);
    const warnings = contactWarnings({ tckn: "111", vkn: "22" });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("kayıt yine de saklandı");
  });

  it("labels every role in Turkish", () => {
    expect(CONTACT_ROLE_LABELS["karsi-taraf"]).toBe("Karşı taraf");
    expect(CONTACT_ROLE_LABELS.muvekkil).toBe("Müvekkil");
  });
});

describe("scanConflicts (pure)", () => {
  const matter = (id: string, title: string, client: string, opposing: string): MatterSummary =>
    ({
      id,
      title,
      client,
      opposing,
      court: "",
      docketNo: "",
      kind: "dava",
      status: "acik",
      createdAt: "",
      updatedAt: "",
      counts: { files: 0, answers: 0, drafts: 0, notes: 0, events: 0, deadlines: 0, hearings: 0 },
      nextDeadline: null,
      overdueCount: 0,
      nextHearing: null,
      lastActivityAt: "",
    }) as MatterSummary;

  const matters = [
    matter("m1", "Yılmaz / Kira", "Ayşe Yılmaz", "Mehmet Demir"),
    matter("m2", "Demir / Alacak", "MEHMET DEMİR", "Kartal Ltd."),
  ];

  it("flags a would-be client who is already the opposing side", () => {
    const report = scanConflicts("Mehmet Demir", "muvekkil", matters);
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts.map((c) => [c.matterId, c.side])).toEqual([["m1", "opposing"]]);
    // The same person on OUR side elsewhere is context, not a conflict.
    expect(report.sameSide.map((c) => c.matterId)).toEqual(["m2"]);
    expect(report.message).toContain("Menfaat çatışması olabilir");
    expect(report.message).toContain("Yılmaz / Kira");
  });

  it("flags the reverse direction too", () => {
    const report = scanConflicts("Ayşe Yılmaz", "karsi-taraf", matters);
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.side).toBe("client");
  });

  it("says clearly when there is nothing", () => {
    const report = scanConflicts("Zeynep Kaya", "muvekkil", matters);
    expect(report.hasConflict).toBe(false);
    expect(report.conflicts).toEqual([]);
    expect(report.message).toContain("karşı taraf olarak geçmiyor");
    expect(report.message).toContain("değerlendirmesi size aittir");
  });
});

describe("/v1/contacts", () => {
  it("a contact is entered once and reused in two matters", async () => {
    const h = harness();
    const created = await h.post("/v1/contacts", {
      ad: "Ayşe Yılmaz",
      tckn: "10000000146",
      adres: "İzmir",
      telefon: "0232 000 00 00",
      rol: "muvekkil",
    });
    expect(created.status).toBe(201);
    const contact = created.body as Contact & { warnings: string[] };
    expect(contact.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(contact.warnings).toEqual([]);

    // The same card fills the client field of two matters.
    const first = (await h.post("/v1/matters", { title: "Kira tahliye", client: contact.ad })).body as Matter;
    const second = (await h.post("/v1/matters", { title: "Depozito", client: contact.ad })).body as Matter;
    expect(first.client).toBe("Ayşe Yılmaz");
    expect(second.client).toBe("Ayşe Yılmaz");

    const listed = (await h.json("/v1/contacts")).body as { contacts: Contact[] };
    expect(listed.contacts).toHaveLength(1);
    const byRole = (await h.json("/v1/contacts?rol=karsi-taraf")).body as { contacts: Contact[] };
    expect(byRole.contacts).toEqual([]);
    const byQuery = (await h.json("/v1/contacts?q=yılmaz")).body as { contacts: Contact[] };
    expect(byQuery.contacts).toHaveLength(1);
  });

  it("raises the conflict warning when the same name is entered as the opposing side", async () => {
    const h = harness();
    await h.post("/v1/matters", { title: "Kira tahliye", client: "Ayşe Yılmaz", opposing: "Mehmet Demir" });
    const res = await h.post("/v1/contacts/conflict-check", { ad: "Ayşe Yılmaz", rol: "karsi-taraf" });
    expect(res.status).toBe(200);
    const report = res.body as { hasConflict: boolean; message: string; conflicts: Array<{ side: string }> };
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.side).toBe("client");
    expect(report.message).toContain("Kira tahliye");

    // The scan also runs when the card itself is created.
    const created = await h.post("/v1/contacts", { ad: "Ayşe Yılmaz", rol: "karsi-taraf" });
    expect((created.body as { conflict: { hasConflict: boolean } }).conflict.hasConflict).toBe(true);
  });

  it("patches, deletes and 404s an unknown card", async () => {
    const h = harness();
    const contact = (await h.post("/v1/contacts", { ad: "Kartal Ltd.", vkn: "1234567890", rol: "diger" }))
      .body as Contact;
    const patched = await h.patch(`/v1/contacts/${contact.id}`, { adres: "İzmir / Konak" });
    expect(patched.status).toBe(200);
    expect((patched.body as Contact).adres).toBe("İzmir / Konak");
    expect((patched.body as Contact).ad).toBe("Kartal Ltd.");

    expect((await h.del(`/v1/contacts/${contact.id}`)).status).toBe(204);
    expect((await h.del(`/v1/contacts/${contact.id}`)).status).toBe(404);
    expect((await h.json(`/v1/contacts/${contact.id}`)).status).toBe(404);
  });

  it("refuses an unknown field and an empty name in Turkish", async () => {
    const h = harness();
    const bad = await h.post("/v1/contacts", { ad: "", meslek: "avukat" });
    expect(bad.status).toBe(400);
    const issues = (bad.body as ErrorBody).error.issues ?? [];
    expect(issues.some((i) => i.message === "Tanınmayan alan.")).toBe(true);
    expect(issues.some((i) => i.message === "Ad boş bırakılamaz.")).toBe(true);
  });

  it("the lane is absent (404) when no contact store is configured", async () => {
    const now = clock();
    const app = createMattersRouter({ store: new InMemoryMatterStore(now), now });
    expect((await app.request("/v1/contacts")).status).toBe(404);
  });

  it("the router can be mounted on its own with a service", async () => {
    const matters = new InMemoryMatterStore(clock());
    const app = createContactsRouter({
      service: new ContactService({ store: new InMemoryContactStore(), matters }),
    });
    const res = await app.request("/v1/contacts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contacts: [] });
  });
});
