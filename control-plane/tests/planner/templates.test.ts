import { describe, expect, it } from "vitest";
import { lookupCapability } from "../../src/capabilities/registry.js";
import { analyzeIntake, type IntakeAnalysis } from "../../src/planner/intake.js";
import { parsePlannerNote } from "../../src/planner/outcomes.js";
import {
  buildFetchInput,
  buildRegulatorSearchInput,
  fetchDescriptorForProvider,
  fetchToolForProvider,
  gapQueryForIssue,
  primaryQueryForIssue,
  REGULATOR_SEARCH_TOOLS,
  RESEARCH_TEMPLATES,
  selectTemplate,
  TemplateNotImplementedError,
  type PlannedCall,
  type TemplateId,
} from "../../src/planner/templates.js";
import { makeIntake } from "./helpers.js";

const RICH_QUESTION =
  "5237 sayılı TCK m.157 dolandırıcılık suçu ve ihale sürecinde kişisel veri, açık rıza";

const ACTIVE_TEMPLATES = (Object.keys(RESEARCH_TEMPLATES) as TemplateId[]).filter(
  (id) => RESEARCH_TEMPLATES[id].status === "active",
);

function analyze(question: string, asOf?: string): IntakeAnalysis {
  return analyzeIntake(makeIntake(question, asOf !== undefined ? { asOf } : undefined));
}

function callsOf(id: TemplateId, question = RICH_QUESTION): PlannedCall[] {
  return RESEARCH_TEMPLATES[id].buildStaticCalls(analyze(question));
}

function roleOf(call: PlannedCall): string | undefined {
  return parsePlannerNote(call.note)?.role;
}

function phrasesOf(calls: PlannedCall[], role?: string): string[] {
  return calls
    .filter((c) => role === undefined || roleOf(c) === role)
    .map((c) => String(c.input["phrase"] ?? c.input["icerik"] ?? ""))
    .filter((p) => p.length > 0);
}

describe("template registry", () => {
  it("declares exactly the five brief-14.5 templates", () => {
    expect(Object.keys(RESEARCH_TEMPLATES).sort()).toEqual([
      "aym_norm_denetimi",
      "cross_regulator",
      "mevzuat_amendment_ictihat",
      "uploaded_claims_counter_evidence",
      "yargitay_danistay_contrary",
    ]);
  });

  it("uploaded-claims template is interface-only and throws a typed error", () => {
    const template = RESEARCH_TEMPLATES.uploaded_claims_counter_evidence;
    expect(template.status).toBe("interface-only");
    expect(() => template.buildStaticCalls(analyze(RICH_QUESTION))).toThrow(
      TemplateNotImplementedError,
    );
  });

  it.each(ACTIVE_TEMPLATES)(
    "%s: every declared tool belongs to its declared capability",
    (id) => {
      const calls = callsOf(id);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        if (call.toolName !== undefined) {
          expect(lookupCapability(call.toolName)).toBe(call.capability);
        } else {
          expect(call.capability).toBe("legislation.resolveTarget");
        }
      }
    },
  );

  it.each(ACTIVE_TEMPLATES)(
    "%s: has a MANDATORY contrary step for every material issue",
    (id) => {
      const analysis = analyze(RICH_QUESTION);
      const calls = RESEARCH_TEMPLATES[id].buildStaticCalls(analysis);
      for (const issue of analysis.issues.filter((i) => i.material)) {
        const contrary = calls.filter((c) => {
          const note = parsePlannerNote(c.note);
          return note?.issueId === issue.issueId && note.role === "contrary";
        });
        expect(contrary.length, `${id}/${issue.issueId}`).toBeGreaterThanOrEqual(1);
        // Every contrary lane really flips the outcome or targets a divergence.
        for (const call of contrary) {
          const query = JSON.stringify(call.input);
          expect(query).toMatch(
            /aksi yönde|bozma|karşı oy|direnme|içtihadı birleştirme|reddi|beraat|ihlal bulunmadığı|kabul edilemez/u,
          );
        }
      }
    },
  );

  it.each(ACTIVE_TEMPLATES)(
    "%s: emits the mandatory contrary lanes before the enrichment phase",
    (id) => {
      const roles = callsOf(id).map(roleOf);
      const lastContrary = roles.lastIndexOf("contrary");
      expect(lastContrary).toBeGreaterThanOrEqual(0);
      for (const enrichmentRole of ["statute", "amendment"]) {
        const first = roles.indexOf(enrichmentRole);
        if (first >= 0) expect(first).toBeGreaterThan(lastContrary);
      }
    },
  );

  it("the four active templates are genuinely different strategies", () => {
    // Signature = the ordered (tool, primary-argument-names) pairs. Two
    // templates that only differed by label would collide here.
    const signature = (id: TemplateId): string =>
      JSON.stringify(
        callsOf(id).map((c) => [
          c.toolName ?? c.capability,
          Object.keys(c.input).sort(),
          roleOf(c),
        ]),
      );
    const signatures = ACTIVE_TEMPLATES.map(signature);
    expect(new Set(signatures).size).toBe(ACTIVE_TEMPLATES.length);

    // And they reach different sources, not just different arguments.
    const tools = (id: TemplateId) =>
      new Set(callsOf(id).map((c) => c.toolName ?? c.capability));
    expect(tools("mevzuat_amendment_ictihat")).toContain("search_within_kanun");
    expect(tools("aym_norm_denetimi")).toContain("search_anayasa_unified");
    expect(tools("cross_regulator")).toContain("search_kvkk_decisions");
    expect(tools("mevzuat_amendment_ictihat")).not.toContain("search_kvkk_decisions");
    expect(tools("cross_regulator")).not.toContain("search_within_kanun");
  });
});

describe("template 1: mevzuat + değişiklik + içtihat (statute-first)", () => {
  const analysis = analyze("5237 sayılı TCK m.157 hakkında içtihat", "2026-05-01");
  const calls = RESEARCH_TEMPLATES.mevzuat_amendment_ictihat.buildStaticCalls(analysis);

  it("looks the law up by its official number, not by free text", () => {
    const lookup = calls.find((c) => c.toolName === "search_mevzuat");
    expect(lookup?.input).toMatchObject({ mevzuat_no: "5237" });
    expect(lookup?.input["page_size"]).toBe(5); // legislation page_size stays 1..20
    // No mevzuat_tur filter: a numbered reference may be a KHK or a CB kararnamesi.
    expect(lookup?.input["mevzuat_tur"]).toBeUndefined();
  });

  it("looks a CONCEPT up in the legislation full text, restricted to statutes", () => {
    const conceptCalls = callsOf("mevzuat_amendment_ictihat", "kira tespit davası");
    const lookup = conceptCalls.find((c) => c.toolName === "search_mevzuat");
    expect(lookup?.input).toMatchObject({ phrase: "kira", mevzuat_tur: "KANUN" });
    expect(lookup?.input["mevzuat_no"]).toBeUndefined();
  });

  it("reads the referenced article inside the law", () => {
    const within = calls.find((c) => c.toolName === "search_within_kanun");
    expect(within?.capability).toBe("document.searchWithin");
    expect(within?.input).toMatchObject({ mevzuat_no: "5237", keyword: "madde 157" });
  });

  it("reads inside the law by concept when no article number was given", () => {
    const noArticle = callsOf(
      "mevzuat_amendment_ictihat",
      "6098 sayılı kanun kapsamında kira uyarlaması",
    );
    const within = noArticle.find((c) => c.toolName === "search_within_kanun");
    // Never the citation itself: a law does not contain its own "6098 sayılı".
    expect(within?.input).toMatchObject({ mevzuat_no: "6098", keyword: "kira" });
  });

  it("skips the within-law read when there is no article and no concept", () => {
    const bare = callsOf("mevzuat_amendment_ictihat", "6098 sayılı kanun hakkında bilgi");
    expect(bare.some((c) => c.toolName === "search_within_kanun")).toBe(false);
  });

  it("resolves the amendment target with the as_of anchor", () => {
    const resolver = calls.find((c) => c.capability === "legislation.resolveTarget");
    expect(resolver?.toolName).toBeUndefined();
    expect(resolver?.input).toMatchObject({
      targetLegislationNo: "5237",
      articleNo: "157",
      asOf: "2026-05-01",
    });
  });

  it("bounds case-law searches by the as_of date", () => {
    const bedesten = calls.filter((c) => c.toolName === "search_bedesten_unified");
    expect(bedesten.length).toBeGreaterThan(0);
    for (const call of bedesten) {
      expect(call.input["kararTarihiEnd"]).toBe("2026-05-01");
      expect(call.input["court_types"]).toEqual(["YARGITAYKARARI", "DANISTAYKARAR"]);
    }
  });
});

describe("template 2: Yargıtay/Danıştay karşıt yaklaşım (divergence-first)", () => {
  const calls = callsOf("yargitay_danistay_contrary", "işe iade davasında karşıt içtihat");

  it("searches the two judicial orders in separate lanes", () => {
    const courts = calls
      .filter((c) => roleOf(c) === "primary" && Array.isArray(c.input["court_types"]))
      .map((c) => (c.input["court_types"] as string[]).join(","));
    expect(courts).toContain("YARGITAYKARARI");
    expect(courts).toContain("DANISTAYKARAR");
    // Never a single combined lane: that would hide the split.
    expect(courts).not.toContain("YARGITAYKARARI,DANISTAYKARAR");
  });

  it("targets direnme via the Hukuk Genel Kurulu and içtihadı birleştirme", () => {
    const contrary = calls.filter((c) => roleOf(c) === "contrary");
    const direnme = contrary.find((c) => String(c.input["phrase"]).includes("direnme"));
    expect(direnme?.input["birimAdi"]).toBe("HGK");
    expect(direnme?.input["court_types"]).toEqual(["YARGITAYKARARI"]);

    const unification = contrary.find((c) =>
      String(c.input["phrase"]).includes("içtihadı birleştirme"),
    );
    expect(unification).toBeDefined();
    // An içtihadı birleştirme decision may come from either order.
    expect(unification?.input["birimAdi"]).toBeUndefined();
  });

  it("adds the Uyuşmazlık Mahkemesi lane only for a jurisdiction question", () => {
    const withoutAngle = callsOf(
      "yargitay_danistay_contrary",
      "işe iade davasında karşıt içtihat",
    );
    expect(withoutAngle.some((c) => c.toolName === "search_uyusmazlik_decisions")).toBe(
      false,
    );

    const withAngle = callsOf(
      "yargitay_danistay_contrary",
      "Bu uyuşmazlıkta görev adli yargıda mı idari yargıda mı, çelişkili karar var",
    );
    const uyusmazlik = withAngle.find(
      (c) => c.toolName === "search_uyusmazlik_decisions",
    );
    expect(uyusmazlik?.capability).toBe("caseLaw.search");
    expect(uyusmazlik?.input).toMatchObject({ search_scope: "All", page_number: 1 });
    expect(String(uyusmazlik?.input["icerik"]).length).toBeGreaterThan(0);
  });
});

describe("template 3: AYM norm denetimi + hedef mevzuat", () => {
  const calls = callsOf(
    "aym_norm_denetimi",
    "5651 sayılı kanunun anayasaya aykırı olduğu iddiasıyla norm denetimi",
  );

  it("searches norm denetimi and passes keywords as an array", () => {
    const primary = calls.find((c) => roleOf(c) === "primary");
    expect(primary?.toolName).toBe("search_anayasa_unified");
    expect(primary?.input["decision_type"]).toBe("norm_denetimi");
    expect(primary?.input["keywords"]).toEqual(['"5651 sayılı"']);
    expect(primary?.input["results_per_page"]).toBe(10);
  });

  it("looks up the TARGET legislation (hedef mevzuat) and resolves it", () => {
    const lookup = calls.find((c) => c.toolName === "search_mevzuat");
    expect(lookup?.input).toMatchObject({ mevzuat_no: "5651" });
    const resolver = calls.find((c) => c.capability === "legislation.resolveTarget");
    expect(resolver?.input).toMatchObject({ targetLegislationNo: "5651" });
  });

  it("contrary lanes cover both an upheld norm and an inadmissible application", () => {
    const contrary = calls.filter((c) => roleOf(c) === "contrary");
    const types = contrary.map((c) => c.input["decision_type"]);
    expect(types).toContain("norm_denetimi");
    expect(types).toContain("bireysel_basvuru");
    const keywords = contrary.flatMap((c) => c.input["keywords"] as string[]);
    expect(keywords).toContain("iptal isteminin reddi");
    expect(keywords).toContain("kabul edilemez");
  });
});

describe("template 4: regülatörler arası konu (regulator-first)", () => {
  const calls = callsOf(
    "cross_regulator",
    "İhale sürecinde kişisel veri paylaşımı ve açık rıza",
  );

  it("emits one lane per hinted regulator, each with its own parameters", () => {
    const kvkk = calls.find((c) => c.toolName === "search_kvkk_decisions");
    expect(kvkk?.capability).toBe("regulator.search");
    expect(typeof kvkk?.input["keywords"]).toBe("string");

    const kik = calls.find((c) => c.toolName === "search_kik_v2_decisions");
    expect(kik?.input).toMatchObject({ decision_type: "uyusmazlik" });
    expect(typeof kik?.input["karar_metni"]).toBe("string");
  });

  it("reviews regulator decisions in the ADMINISTRATIVE court lane only", () => {
    const bedesten = calls.filter((c) => c.toolName === "search_bedesten_unified");
    expect(bedesten.length).toBeGreaterThan(0);
    for (const call of bedesten) {
      expect(call.input["court_types"]).toEqual(["DANISTAYKARAR"]);
    }
  });

  it("stays regulator-centric: no statute reading lane", () => {
    expect(calls.some((c) => c.capability === "document.searchWithin")).toBe(false);
  });
});

describe("selectTemplate", () => {
  it("selects aym_norm_denetimi on norm-denetimi markers", () => {
    expect(
      selectTemplate(analyze("Bu hükmün anayasaya aykırı olduğu iddiasıyla norm denetimi")),
    ).toBe("aym_norm_denetimi");
  });

  it("selects cross_regulator when two or more regulators are hinted", () => {
    expect(selectTemplate(analyze("İhale sürecinde kişisel veri paylaşımı ve açık rıza"))).toBe(
      "cross_regulator",
    );
  });

  it("selects yargitay_danistay_contrary on contrary markers", () => {
    expect(
      selectTemplate(analyze("İşe iade konusunda Yargıtay ve Danıştay görüş ayrılığı")),
    ).toBe("yargitay_danistay_contrary");
    expect(
      selectTemplate(analyze("Bu konuda içtihadı birleştirme kararı var mı")),
    ).toBe("yargitay_danistay_contrary");
    expect(selectTemplate(analyze("Yerel mahkemenin direnme kararı yerinde midir"))).toBe(
      "yargitay_danistay_contrary",
    );
  });

  it("defaults to mevzuat_amendment_ictihat", () => {
    expect(selectTemplate(analyze("kira tespit davası şartları"))).toBe(
      "mevzuat_amendment_ictihat",
    );
  });

  it("an explicit override wins", () => {
    expect(selectTemplate(analyze("kira tespit davası şartları"), "aym_norm_denetimi")).toBe(
      "aym_norm_denetimi",
    );
  });
});

describe("query builders + tool maps", () => {
  it("round-1 query stays short; a statute is searched the way decisions cite it", () => {
    const analysis = analyze("5237 sayılı TCK m.157 dolandırıcılık suçu");
    const exact = analysis.issues.find((i) => i.kind === "exact_reference");
    const concept = analysis.issues.find((i) => i.concept === "dolandırıcılık");
    expect(primaryQueryForIssue(exact!)).toBe('"5237 sayılı" 157');
    // NOT the four-term expansion: a keyword engine ANDs everything it is given.
    expect(primaryQueryForIssue(concept!)).toBe("dolandırıcılık");
  });

  it("the round-2 gap query is a different angle, not a narrower one", () => {
    const analysis = analyze("dolandırıcılık suçu");
    const issue = analysis.issues[0]!;
    const primary = primaryQueryForIssue(issue);
    const gap = gapQueryForIssue(issue);
    expect(gap).not.toBe(primary);
    // The statutory element ALONE. W14/B-15: the old builder appended a
    // constant "emsal karar", which — Bedesten ANDs its tokens — made round-2
    // strictly NARROWER than round-1. A gap query may substitute or drop
    // tokens, never add one.
    expect(gap).toBe("hileli davranış");
    expect(gap.split(/\s+/u).length).toBeLessThanOrEqual(
      primary.split(/\s+/u).length + 1,
    );
  });

  it("broadens an exact reference in round 2 instead of narrowing it", () => {
    const legislation = analyze("6098 sayılı TBK m. 344 kira artışı").issues.find(
      (i) => i.reference?.kind === "legislation",
    );
    expect(primaryQueryForIssue(legislation!)).toBe('"6098 sayılı" 344');
    // The article number is DROPPED: strictly broader than round 1.
    expect(gapQueryForIssue(legislation!)).toBe('"6098 sayılı"');

    const decision = analyze("Yargıtay E. 2023/45, K. 2024/12 sayılı kararı").issues.find(
      (i) => i.reference?.kind === "court_decision",
    );
    expect(gapQueryForIssue(decision!)).toBe("E. 2023/45");
  });

  it("an E./K. issue keeps its docket/decision pair as the query", () => {
    const analysis = analyze("Yargıtay E. 2023/45, K. 2024/12 sayılı kararı");
    const issue = analysis.issues.find((i) => i.reference?.kind === "court_decision");
    expect(primaryQueryForIssue(issue!)).toBe("E. 2023/45 K. 2024/12");
  });

  it("fetchToolForProvider maps every provider to a document.fetch tool", () => {
    const providers = [
      "BEDESTEN",
      "EMSAL",
      "AYM",
      "MEVZUAT",
      "KIK",
      "KVKK",
      "REKABET",
      "SAYISTAY",
      "BDDK",
      "BTK",
      "GIB",
      "SIGORTA",
    ];
    for (const provider of providers) {
      const tool = fetchToolForProvider(provider);
      expect(tool, provider).toBeDefined();
      expect(lookupCapability(tool as string)).toBe("document.fetch");
      const descriptor = fetchDescriptorForProvider(provider);
      expect(descriptor?.idParam.length).toBeGreaterThan(0);
      // The id lands under the tool's OWN parameter name.
      const input = buildFetchInput(provider, "X-1") as Record<string, unknown>;
      expect(input[descriptor?.idParam as string]).toBe("X-1");
    }
    expect(fetchToolForProvider("BEDESTEN")).toBe("fetch");
    expect(buildFetchInput("BEDESTEN", "doc-1")).toEqual({ id: "doc-1" });
    expect(buildFetchInput("MEVZUAT", "345097")).toEqual({
      mevzuat_id: "345097",
      page_number: 1,
      // W23: the tool's largest page, so a long law is paged in few calls.
      page_size: 50_000,
    });
    // A Sayıştay fetch mirrors the decision_type the planner searched with.
    expect(buildFetchInput("SAYISTAY", "s-1")).toMatchObject({ decision_type: "daire" });
  });

  it("never guesses a tool or a parameter for an unknown provider", () => {
    expect(fetchToolForProvider("UNKNOWN")).toBeUndefined();
    expect(fetchDescriptorForProvider("UNKNOWN")).toBeUndefined();
    expect(buildFetchInput("UNKNOWN", "x")).toBeUndefined();
  });

  it("every regulator search tool belongs to regulator.search and gets its own arg", () => {
    for (const tool of Object.values(REGULATOR_SEARCH_TOOLS)) {
      expect(lookupCapability(tool)).toBe("regulator.search");
    }
    expect(buildRegulatorSearchInput("KVKK", "açık rıza")).toEqual({
      keywords: "açık rıza",
      page: 1,
    });
    // Rekabet searches the decision body, not the title.
    expect(buildRegulatorSearchInput("REKABET", "kartel")).toMatchObject({
      PdfText: "kartel",
    });
    expect(buildRegulatorSearchInput("SAYISTAY", "kamu zararı")).toMatchObject({
      decision_type: "daire",
      web_karar_metni: "kamu zararı",
    });
  });
});

describe("phrase escaping", () => {
  it("multi-word flip phrases are quoted, single tokens are not", () => {
    const contrary = phrasesOf(
      callsOf("mevzuat_amendment_ictihat", "dolandırıcılık suçu"),
      "contrary",
    );
    expect(contrary).toContain("dolandırıcılık beraat");
    expect(contrary).toContain('dolandırıcılık "karşı oy"');
  });
});
