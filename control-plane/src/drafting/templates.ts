/**
 * Draft template registry (brief 11.5 — şablon + kullanıcı talimatıyla
 * outline; W12 lane C — 13 templates, typed console fields).
 *
 * The copy here is lawyer-facing: section order and headings follow how
 * these documents are actually structured in practice. Clauses reference the
 * governing provisions IN TEXT (TBK m.344, İş K. m.17, Avukatlık K. m.164 …)
 * as references for the reviewing lawyer — the as-of engine is not consulted
 * here and no clause is presented as verified law.
 *
 * SLOT SEMANTICS. A section is a list of slots the composer fills:
 *
 *   baslik               court address / document title line (matter.baslik
 *                        or matter.mahkeme override the template default).
 *   taraflar             HMK m.119 party block from matter.taraflar (TCKN /
 *                        VKN, adres, vekil), plus DOSYA NO / DAVA DEĞERİ.
 *   konu                 subject line (ekBilgiler.konu overrides the default).
 *   olaylar              chronological numbered facts from matter.olaylar.
 *   arabuluculuk         dava şartı arabuluculuk line (matter.arabuluculuk).
 *   hukukiDegerlendirme  legal assessment paragraphs — built ONLY from
 *                        validated evidence claims. `zorunlu:true` means the
 *                        slot must exist: with no evidence it produces a
 *                        loudly-marked KAYNAKSIZ paragraph.
 *   hukukiSebepler       mevzuat/emsal references — only the entries the
 *                        document actually relies on (see composer).
 *   deliller             exhibit list (ekBilgiler.deliller + uploaded files).
 *   talepler             SONUÇ VE İSTEM built from matter.talepler.
 *   imza                 date/place + signature block (vekil-aware).
 *   hukum                an authored contractual/procedural clause. `{anahtar}`
 *                        placeholders are filled from matter.ekBilgiler; a
 *                        missing optional key renders as a visible
 *                        "[Alan adı — doldurun]" placeholder plus a warning.
 *   liste                numbered items from an ekBilgiler list (`bilgiKey`) —
 *                        string (one item per line) OR array — or `emptyText`
 *                        when the key is absent.
 *
 * `requiredFields` are dot paths into `matter`; the composer refuses to
 * compose (a 400 at the API) when one is missing or empty.
 */

import type { DraftKind, SlotKind } from "./types.js";
import { KARSI_ICTIHAT_SECTION_ID, KARSI_ICTIHAT_SECTION_TITLE } from "./types.js";
import type { LegalDomain } from "./relevance.js";
import { OLAY_ANLATISI_KEY } from "./input.js";

export interface TemplateSlot {
  kind: SlotKind;
  /** Authored text: default for baslik/konu, clause body for hukum. */
  text?: string;
  /** ekBilgiler keys consumed by this slot ({placeholder} fill order). */
  bilgi?: string[];
  /** For "liste": the ekBilgiler key holding the items. */
  bilgiKey?: string;
  /** For "liste": what to say when the key is absent. */
  emptyText?: string;
  /**
   * For "talepler": the lead-in line before the numbered items. Absent keeps
   * the dilekçe wording ("Yukarıda arz ve izah olunan nedenlerle;"); "" drops
   * the line entirely. A hukukî mütalaa asks questions, it does not petition.
   */
  giris?: string;
  /** For "talepler": the closing line after the items; "" drops it. */
  kapanis?: string;
  /**
   * Evidence-bound slots: true = KAYNAKSIZ placeholder when no evidence.
   * On a "karsiIctihat" slot it means the ALEYHE section may never be empty:
   * with no contrary source the composer writes the fixed
   * "bulunamadı ≠ yok" sentence instead of dropping the section.
   */
  zorunlu?: boolean;
}

export interface TemplateSection {
  id: string;
  title: string;
  slots: TemplateSlot[];
}

/** Console input kinds (W12 contract [D]). */
export type TemplateFieldKind =
  | "text"
  | "list"
  | "party-list"
  | "event-list"
  | "date"
  | "number"
  | "select";

/** Field group labels (W12 contract [D]); the console renders them as fieldsets. */
export const FIELD_GROUPS = {
  mahkeme: "Mahkeme ve dosya",
  /**
   * Additive (W14 B-25 / W13-COPY C15): contracts, ihtarname and the
   * arabuluculuk form have no court at all — their date/place fields used to
   * sit under a fieldset headed "Mahkeme ve dosya" with no court field in it.
   */
  belge: "Belge künyesi",
  taraflar: "Taraflar",
  vekil: "Vekil",
  olaylar: "Olaylar",
  talepler: "Talepler",
  deliller: "Deliller",
  ek: "Ek bilgiler",
} as const;

export type TemplateFieldGroup = (typeof FIELD_GROUPS)[keyof typeof FIELD_GROUPS];

/**
 * One console-renderable input field (cross-lane contract B; additive).
 *
 * `path` is the FULL request path ("matter.taraflar",
 * "matter.ekBilgiler.karar") so a 400 issue's `path` matches a field 1:1 and
 * the console can attach the error to the right input. `requiredFields`
 * keeps its old matter-relative convention untouched (backwards compat).
 */
export interface TemplateField {
  path: string;
  /** Human Turkish label — never a machine path. */
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required: boolean;
  /** Additive (W12): input widget kind; absent = "text". */
  kind?: TemplateFieldKind;
  /** Additive (W12): choices for kind "select". */
  options?: string[];
  /** Additive (W12): one-sentence lawyer-facing help. */
  help?: string;
  /** Additive (W12): fieldset label (see FIELD_GROUPS). */
  group?: string;
}

export interface DraftTemplate {
  id: string;
  kind: DraftKind;
  /**
   * Additive (W12-FIX2, relevance gate): the field of law the document
   * belongs to. Evidence of an incompatible domain (a TCK provision under a
   * hukuk davası dilekçesi) never becomes a dayanak unless the matter text
   * names it — see relevance.ts.
   */
  domain: LegalDomain;
  title: string;
  description: string;
  requiredFields: string[];
  /** Additive (contract B): human-labeled input fields for the console. */
  fields: TemplateField[];
  sections: TemplateSection[];
}

/** Shorthand for building a TemplateField. */
function field(
  path: string,
  label: string,
  options: Partial<Omit<TemplateField, "path" | "label">> = {},
): TemplateField {
  const out: TemplateField = { path, label, required: options.required ?? false };
  if (options.placeholder !== undefined) out.placeholder = options.placeholder;
  if (options.multiline !== undefined) out.multiline = options.multiline;
  if (options.kind !== undefined) out.kind = options.kind;
  if (options.options !== undefined) out.options = options.options;
  if (options.help !== undefined) out.help = options.help;
  if (options.group !== undefined) out.group = options.group;
  return out;
}

// ---------------------------------------------------------------------------
// Shared field groups
// ---------------------------------------------------------------------------

/** Court / docket fields every dilekçe form starts with. */
function courtFields(options: { esasNo?: boolean; davaDegeri?: boolean } = {}): TemplateField[] {
  const out: TemplateField[] = [
    field("matter.mahkeme", "Hitap edilen mahkeme / merci", {
      placeholder: "İstanbul 3. Asliye Hukuk Mahkemesi",
      help: "Başlık satırı boşsa buradan '…MAHKEMESİ'NE' biçiminde üretilir.",
      group: FIELD_GROUPS.mahkeme,
    }),
    field("matter.baslik", "Başlık satırı (tam metin)", {
      placeholder: "İSTANBUL NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE",
      group: FIELD_GROUPS.mahkeme,
    }),
  ];
  if (options.esasNo !== false) {
    out.push(
      field("matter.esasNo", "Dosya / esas numarası", {
        placeholder: "2025/123 E.",
        group: FIELD_GROUPS.mahkeme,
      }),
    );
  }
  if (options.davaDegeri !== false) {
    out.push(
      field("matter.davaDegeri", "Dava değeri (HMK m.119/1-d)", {
        placeholder: "50.000 TL",
        help: "Malvarlığı haklarına ilişkin davalarda zorunludur; harca esas değerdir.",
        group: FIELD_GROUPS.mahkeme,
      }),
    );
  }
  out.push(
    field("matter.tarih", "Belge tarihi", {
      kind: "date",
      help: "Boş bırakılırsa bugünün tarihi GG.AA.YYYY olarak yazılır.",
      group: FIELD_GROUPS.mahkeme,
    }),
    field("matter.ekBilgiler.yer", "Düzenleme yeri (imza satırı)", {
      placeholder: "İstanbul",
      group: FIELD_GROUPS.mahkeme,
    }),
  );
  return out;
}

function partyField(label: string, help: string): TemplateField {
  return field("matter.taraflar", label, {
    required: true,
    multiline: true,
    kind: "party-list",
    help,
    group: FIELD_GROUPS.taraflar,
  });
}

const PARTY_HELP_DILEKCE =
  "Her satır 'Rol : Ad' (örn. 'Davacı : Ayşe Yılmaz'). T.C. kimlik no, adres ve" +
  " vekil bilgileri HMK m.119 için taraf kaydına eklenir.";

function vekilFields(): TemplateField[] {
  return [
    field("matter.vekil.ad", "Vekil (Av.)", {
      placeholder: "Av. Mehmet Demir",
      help: "İmza bloğu buradan üretilir; boşsa taraf kaydındaki vekil kullanılır.",
      group: FIELD_GROUPS.vekil,
    }),
    field("matter.vekil.baro", "Baro", { placeholder: "İstanbul Barosu", group: FIELD_GROUPS.vekil }),
    field("matter.vekil.sicilNo", "Baro sicil no", { placeholder: "12345", group: FIELD_GROUPS.vekil }),
    field("matter.vekil.adres", "Vekil adresi", { multiline: true, group: FIELD_GROUPS.vekil }),
  ];
}

function olaylarField(label = "Olaylar (kronolojik; her satır bir olay)"): TemplateField {
  return field("matter.olaylar", label, {
    required: true,
    multiline: true,
    kind: "event-list",
    help: "Satır başına 'GG.AA.YYYY — olay' yazılabilir; tarih verilirse kronolojik sıralanır.",
    group: FIELD_GROUPS.olaylar,
  });
}

function taleplerField(label = "Talepler (her satır bir talep)"): TemplateField {
  return field("matter.talepler", label, {
    required: true,
    multiline: true,
    kind: "list",
    group: FIELD_GROUPS.talepler,
  });
}

function konuField(): TemplateField {
  return field("matter.ekBilgiler.konu", "Konu (bir cümle)", { group: FIELD_GROUPS.olaylar });
}

function delillerField(label = "Deliller (her satır bir delil)"): TemplateField {
  return field("matter.ekBilgiler.deliller", label, {
    multiline: true,
    kind: "list",
    help: "Yüklenen belgeler ayrıca 'Ek-n' olarak listelenir; buraya yalnızca diğer delilleri yazın.",
    group: FIELD_GROUPS.deliller,
  });
}

function arabuluculukFields(): TemplateField[] {
  return [
    field("matter.arabuluculuk.yapildi", "Dava şartı arabuluculuk yapıldı mı?", {
      kind: "select",
      options: ["Evet", "Hayır"],
      help: "İş, ticari, tüketici ve kira uyuşmazlıklarında dava şartıdır; yapılmadan açılan dava usulden reddedilir.",
      group: FIELD_GROUPS.ek,
    }),
    field("matter.arabuluculuk.tarih", "Arabuluculuk son tutanak tarihi", {
      kind: "date",
      group: FIELD_GROUPS.ek,
    }),
    field("matter.arabuluculuk.sonuc", "Arabuluculuk sonucu", {
      placeholder: "anlaşma sağlanamamıştır",
      group: FIELD_GROUPS.ek,
    }),
  ];
}

/** Contract party field. */
function contractPartyField(roles: string): TemplateField {
  return field("matter.taraflar", `Taraflar (ad ve rol: ${roles})`, {
    required: true,
    multiline: true,
    kind: "party-list",
    help: "Her satır 'Rol : Ad'. Vergi/T.C. kimlik no ve adres taraf kaydına eklenir.",
    group: FIELD_GROUPS.taraflar,
  });
}

function ek(
  key: string,
  label: string,
  options: Partial<Omit<TemplateField, "path" | "label">> = {},
): TemplateField {
  return field(`matter.ekBilgiler.${key}`, label, { group: FIELD_GROUPS.ek, ...options });
}

// ---------------------------------------------------------------------------
// Olay anlatısı + dayanak kapsamı (W16 lane E)
// ---------------------------------------------------------------------------

/**
 * The single free-text narrative field every dilekçe form offers. Optional,
 * always. What the lawyer writes here is HIS OWN STATEMENT: the composer
 * writes it into AÇIKLAMALAR as beyan paragraphs, offers its dated sentences
 * as fact SUGGESTIONS and names its concept words as a search suggestion —
 * and never lets it back a hukukî değerlendirme paragraph or a Dayanak
 * (ADR-021, the same rule that governs an uploaded document).
 */
export function olayAnlatisiField(): TemplateField {
  return ek(OLAY_ANLATISI_KEY, "Olayı kendi cümlelerinizle anlatın", {
    multiline: true,
    placeholder:
      "Müvekkil 12.03.2025 tarihinde kira sözleşmesini imzaladı; 05.06.2025 tarihinde ihtarname gönderildi…",
    help:
      "İsteğe bağlıdır. Yazdığınız metin AÇIKLAMALAR bölümüne sizin beyanınız olarak girer;" +
      " tarih taşıyan cümleler ayrıca 'olay önerisi' olarak listelenir ve dilekçeye" +
      " kendiliğinden yazılmaz. Anlatı hiçbir zaman hukukî değerlendirmenin dayanağı olmaz.",
    group: FIELD_GROUPS.olaylar,
  });
}

/** ekBilgiler key of the narrative field (shared with composer/input). */
export { OLAY_ANLATISI_KEY };

/** The two scope choices, exactly as they are written in the select. */
export const KAPSAM_KISA = "Kısa";
export const KAPSAM_GENIS = "Geniş";

/** ekBilgiler key of the scope select. */
export const KAPSAM_KEY = "kapsam";

/**
 * The fixed sentence that explains what the scope switch does — and what it
 * does NOT do. It sits in the field's own help text (so it is on screen next
 * to the control in every draft form that offers the choice) and the composer
 * repeats it in `draft.warnings` whenever a scope was actually chosen.
 *
 * The honesty point: a competitor sells "normal/uzun". Length is not a
 * quality we can deliver honestly — more sentences from the same sources
 * would be padding. What the wide scope really buys is MORE SOURCES, and the
 * verification is identical in both.
 */
export const KAPSAM_SABIT_CUMLE =
  "Geniş kapsam daha çok KAYNAK demektir, daha çok CÜMLE demek değildir.";

/**
 * What the two scopes actually do, in one sentence each — the composer and
 * the console print the SAME text, and the second half is the part that may
 * not be softened: the verification does not change with the scope.
 */
export const KAPSAM_ACIKLAMASI =
  `${KAPSAM_SABIT_CUMLE} Kısa kapsam yalnız doğrudan dayanakları yazar; geniş kapsam` +
  " bunlara, seçilen dayanakların metninde anılan (atıfla ulaşılan) kaynakları da" +
  " ekler. Her iki kapsamda da aynı doğrulama çalışır.";

/** The scope select, offered by every template that lists HUKUKÎ SEBEPLER. */
export function kapsamField(): TemplateField {
  return ek(KAPSAM_KEY, "Dayanak kapsamı", {
    kind: "select",
    options: [KAPSAM_KISA, KAPSAM_GENIS],
    help: KAPSAM_ACIKLAMASI,
  });
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

function imzaSection(id = "imza"): TemplateSection {
  return { id, title: "", slots: [{ kind: "imza" }] };
}

function sonucSection(): TemplateSection {
  return { id: "sonuc", title: "SONUÇ VE İSTEM", slots: [{ kind: "talepler" }] };
}

/**
 * Machine-authored legal notes for a CONTRACT.
 *
 * W14 (B-25 / W13-COPY L26): this section used to sit immediately BEFORE the
 * signature block, so in six contract templates the parties signed underneath
 * a machine-written "for information" commentary — in a signed contract those
 * notes can be read as part of the agreement. It is now placed AFTER the
 * signature block and its heading says, in the heading itself, that it is not
 * part of the contract.
 */
function dayanakNotlariSection(): TemplateSection {
  return {
    id: "dayanak",
    title: "EK — HUKUKÎ DAYANAK NOTLARI (SÖZLEŞMENİN PARÇASI DEĞİLDİR; İMZAYA GİRMEZ)",
    slots: [
      { kind: "hukukiDegerlendirme", zorunlu: false },
      { kind: "hukukiSebepler", zorunlu: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. Dava dilekçesi
// ---------------------------------------------------------------------------

const DAVA_DILEKCESI: DraftTemplate = {
  id: "dava-dilekcesi",
  kind: "dilekce",
  domain: "ozel-hukuk",
  title: "Dava Dilekçesi",
  description:
    "Hukuk mahkemesine sunulacak dava dilekçesi taslağı (HMK m.119): başlık, HMK" +
    " m.119 unsurlarıyla taraflar (T.C. kimlik no, adres, vekil), dava değeri, konu," +
    " dava şartı arabuluculuk beyanı, kronolojik açıklamalar ve hukukî değerlendirme," +
    " hukukî sebepler, deliller, sonuç ve istem ile imza bloğu. Hukukî değerlendirme" +
    " ve sebepler yalnızca doğrulanmış kanıtlardan kurulur; kanıt yoksa KAYNAKSIZ" +
    " olarak işaretlenir.",
  requiredFields: ["taraflar", "olaylar", "talepler"],
  fields: [
    ...courtFields({ esasNo: false }),
    partyField("Taraflar (ad ve rol)", PARTY_HELP_DILEKCE),
    ...vekilFields(),
    olaylarField(),
    olayAnlatisiField(),
    kapsamField(),
    konuField(),
    ...arabuluculukFields(),
    taleplerField(),
    delillerField(),
  ],
  sections: [
    {
      id: "baslik",
      title: "",
      slots: [{ kind: "baslik", text: "NÖBETÇİ [GÖREVLİ VE YETKİLİ] MAHKEMESİ'NE" }],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "konu",
      title: "KONU",
      slots: [
        {
          kind: "konu",
          text: "Aşağıda arz ve izah edilen nedenlerle taleplerimizin kabulü istemidir.",
        },
      ],
    },
    {
      id: "aciklamalar",
      title: "AÇIKLAMALAR",
      slots: [
        { kind: "arabuluculuk" },
        { kind: "olaylar" },
        { kind: "hukukiDegerlendirme", zorunlu: true },
      ],
    },
    {
      id: "hukuki-sebepler",
      title: "HUKUKÎ SEBEPLER",
      slots: [{ kind: "hukukiSebepler", zorunlu: true }],
    },
    // W14 (W13-COPY C13): HMK m.119/1-f says "deliller"; "hukukî delil" is not
    // a concept — a delil is not hukukî, a sebep is.
    { id: "deliller", title: "DELİLLER", slots: [{ kind: "deliller" }] },
    sonucSection(),
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 2. Cevap dilekçesi
// ---------------------------------------------------------------------------

const CEVAP_DILEKCESI: DraftTemplate = {
  id: "cevap-dilekcesi",
  kind: "dilekce",
  domain: "ozel-hukuk",
  title: "Cevap Dilekçesi",
  description:
    "Dava dilekçesine karşı cevap taslağı (HMK m.129): dosya numarası, taraflar, ilk" +
    " itirazlar (HMK m.116: kesin olmayan yetki ve tahkim itirazı — cevap dilekçesiyle" +
    " ileri sürülmezse dinlenmez, m.117/1) ve dava şartı / usul itirazları (görev," +
    " derdestlik gibi dava şartları m.114–115 uyarınca her aşamada ileri sürülebilir;" +
    " her satır bir itiraz), DEF'İLER (zamanaşımı, takas, hapis hakkı — HMK m.141/1:" +
    " dilekçelerin karşılıklı verilmesinden sonra savunma genişletilemez), varsa KARŞI" +
    " DAVA talepleri (HMK m.133/1 — cevap dilekçesiyle veya esasa cevap süresi içinde)," +
    " esasa ilişkin cevaplar ve hukukî değerlendirme, hukukî" +
    " sebepler, karşı deliller, sonuç ve istem. Usul itirazı yazılmamışsa görünür bir" +
    " boşluk bırakılır; hukukî değerlendirme yalnızca doğrulanmış kanıtlardan kurulur.",
  requiredFields: ["taraflar", "olaylar", "talepler"],
  fields: [
    ...courtFields(),
    partyField("Taraflar (ad ve rol: Davalı / Davacı)", PARTY_HELP_DILEKCE),
    ...vekilFields(),
    ek("usulItirazlari", "Usul itirazları ve ilk itirazlar (her satır bir itiraz)", {
      multiline: true,
      kind: "list",
      help:
        "İlk itirazlar (HMK m.116: kesin olmayan yetki ve tahkim itirazı) cevap dilekçesiyle" +
        " ileri sürülmezse dinlenmez (m.117/1). Görev, derdestlik gibi dava şartı itirazları" +
        " (m.114–115) her aşamada ileri sürülebilir; yine de burada yazılması önerilir.",
    }),
    // W14 (B-25 / W13-COPY L23): the cevap dilekçesi form had no field at all
    // for def'iler — zamanaşımı is the most frequently lost defence.
    ek("defiler", "Def'iler (zamanaşımı, takas, hapis hakkı …) — her satır bir def'i", {
      multiline: true,
      kind: "list",
      help:
        "Def'iler cevap dilekçesiyle ileri sürülür; dilekçelerin karşılıklı verilmesinden" +
        " sonra savunma genişletilemez veya değiştirilemez (HMK m.141/1). Islah ve karşı" +
        " tarafın açık muvafakati saklıdır (m.141/2).",
    }),
    // W14 (B-25 / W13-COPY L24): karşı davanın süresi cevap süresine bağlıdır.
    ek("karsiDava", "Karşı dava talepleri (varsa) — her satır bir talep", {
      multiline: true,
      kind: "list",
      help:
        "Karşı dava, cevap dilekçesiyle veya esasa cevap süresi içinde ayrı bir dilekçe" +
        " verilmek suretiyle açılır (HMK m.133/1); süresinden sonra açılırsa mahkeme" +
        " davaların ayrılmasına karar verir (m.133/2).",
    }),
    olaylarField("Esasa ilişkin cevaplar (her satır bir beyan)"),
    olayAnlatisiField(),
    kapsamField(),
    konuField(),
    taleplerField(),
    delillerField("Karşı deliller (her satır bir delil)"),
  ],
  sections: [
    {
      id: "baslik",
      title: "",
      slots: [{ kind: "baslik", text: "[DAVANIN GÖRÜLDÜĞÜ] MAHKEMESİ'NE" }],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "konu",
      title: "KONU",
      slots: [
        {
          kind: "konu",
          text: "Dava dilekçesine karşı süresi içinde cevaplarımızın sunulmasıdır.",
        },
      ],
    },
    {
      id: "usul",
      title: "USUL İTİRAZLARI VE İLK İTİRAZLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "Görev, yetki, süre ve sair usule ilişkin itiraz haklarımız saklı olup," +
            " HMK m.116–117 uyarınca ilk itirazlarımız ile dava şartlarına ve usule" +
            " ilişkin beyanlarımız aşağıda arz edilmektedir.",
        },
        {
          kind: "liste",
          bilgiKey: "usulItirazlari",
          // A visible placeholder, never an affirmative "there is no objection"
          // sentence: an empty field must not read as a signed waiver
          // (HMK m.117/1 — ilk itirazlar sonradan ileri sürülemez).
          emptyText: "[Usul itirazları — doldurun veya bu bölümü silin]",
        },
      ],
    },
    {
      id: "defiler",
      title: "DEF'İLERİMİZ",
      slots: [
        {
          kind: "liste",
          bilgiKey: "defiler",
          // Never an affirmative "we raise no defence" sentence: an empty
          // field must not read as a signed waiver.
          emptyText: "[Def'iler (zamanaşımı, takas, hapis hakkı …) — doldurun veya bu bölümü silin]",
        },
      ],
    },
    {
      id: "esas",
      title: "ESASA İLİŞKİN CEVAPLARIMIZ",
      slots: [{ kind: "olaylar" }, { kind: "hukukiDegerlendirme", zorunlu: true }],
    },
    {
      id: "karsi-dava",
      title: "KARŞI DAVA",
      slots: [
        {
          kind: "liste",
          bilgiKey: "karsiDava",
          emptyText: "[Karşı dava talebi varsa buraya yazın; yoksa bu bölümü silin]",
        },
      ],
    },
    {
      id: "hukuki-sebepler",
      title: "HUKUKÎ SEBEPLER",
      slots: [{ kind: "hukukiSebepler", zorunlu: true }],
    },
    { id: "karsi-deliller", title: "KARŞI DELİLLER", slots: [{ kind: "deliller" }] },
    sonucSection(),
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 3. İstinaf başvuru dilekçesi
// ---------------------------------------------------------------------------

const ISTINAF_BASVURU: DraftTemplate = {
  id: "istinaf-basvuru",
  kind: "dilekce",
  domain: "ozel-hukuk",
  title: "İstinaf Başvuru Dilekçesi",
  description:
    "İlk derece kararına karşı istinaf başvuru taslağı (HMK m.342; süre HMK m.345 —" +
    " kararın tebliğinden itibaren iki hafta): kararın künyesi (ekBilgiler.karar —" +
    " 'Mahkeme, E. .../..., K. .../..., T. ...' biçiminde tek satır), kararın tebliğ" +
    " tarihi (m.342/2-ç) ve KARARIN ÖZETİ (m.342/2-d) zorunlu unsurlarıyla, istinaf" +
    " sebepleri (olgu + doğrulanmış kanıta bağlı hukukî değerlendirme) ve kararın" +
    " kaldırılması/düzeltilmesi istemi.",
  requiredFields: ["taraflar", "olaylar", "talepler", "ekBilgiler.karar", "ekBilgiler.tebligTarihi"],
  fields: [
    ...courtFields(),
    partyField("Taraflar (ad ve rol: İstinaf Eden / Karşı Taraf)", PARTY_HELP_DILEKCE),
    ...vekilFields(),
    ek("karar", "İstinafa konu karar (Mahkeme, E. .../..., K. .../..., T. ...)", {
      required: true,
      placeholder: "İstanbul 3. Asliye Hukuk Mahkemesi, E. 2025/10, K. 2026/4, T. 01.02.2026",
      help: "HMK m.342/2-c: istinaf edilen kararın hangi mahkemeden verildiği, tarihi ve sayısı.",
    }),
    ek("tebligTarihi", "Kararın tebliğ tarihi", {
      required: true,
      kind: "date",
      help:
        "HMK m.342/2-ç: kararın başvurana tebliğ edildiği tarih istinaf dilekçesinde bulunmalıdır." +
        " Süre hesabını Süreler ekranındaki 'İstinaf başvuru süresi (HMK m.345)' kuralıyla doğrulayın.",
    }),
    ek("kararOzeti", "Kararın özeti", {
      required: true,
      multiline: true,
      help:
        "HMK m.342/2-d: istinaf dilekçesinde kararın özeti bulunmalıdır — hükmün ne olduğunu," +
        " neye dayandığını ve hangi talebin kabul/reddedildiğini birkaç cümleyle yazın.",
    }),
    olaylarField("İstinaf sebepleri — olgular (her satır bir sebep)"),
    olayAnlatisiField(),
    kapsamField(),
    konuField(),
    taleplerField(),
    delillerField(),
  ],
  sections: [
    {
      id: "baslik",
      title: "",
      slots: [
        {
          kind: "baslik",
          text:
            "BÖLGE ADLİYE MAHKEMESİ İLGİLİ HUKUK DAİRESİ'NE" +
            " GÖNDERİLMEK ÜZERE [KARARI VEREN MAHKEME]'YE",
        },
      ],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "kunye",
      title: "İSTİNAFA KONU KARAR",
      slots: [
        {
          // W14 (B-25 / W13-COPY L18): the app instruction and the raw rule id
          // ("hmk-istinaf") used to be printed here, inside the body of a
          // document filed at court. They now live in the tebligTarihi field help.
          kind: "hukum",
          text: "İstinaf incelemesi talep edilen karar: {karar}. Karar tarafımıza {tebligTarihi} tarihinde tebliğ edilmiştir; iki haftalık istinaf süresi (HMK m.345) bu tarihten hesaplanır.",
          bilgi: ["karar", "tebligTarihi"],
        },
      ],
    },
    {
      // HMK m.342/2-d sayılan zorunlu unsur.
      id: "karar-ozeti",
      title: "KARARIN ÖZETİ",
      slots: [{ kind: "hukum", text: "{kararOzeti}", bilgi: ["kararOzeti"] }],
    },
    {
      id: "konu",
      title: "KONU",
      slots: [
        {
          kind: "konu",
          text:
            "Süresi içinde istinaf kanun yoluna başvurumuz ile aşağıda arz edilen" +
            " sebeplerle kararın kaldırılması/düzeltilerek yeniden hüküm kurulması" +
            " istemidir (HMK m.353).",
        },
      ],
    },
    {
      id: "sebepler",
      title: "İSTİNAF SEBEPLERİ",
      slots: [
        { kind: "olaylar" },
        { kind: "hukukiDegerlendirme", zorunlu: true },
        { kind: "hukukiSebepler", zorunlu: true },
      ],
    },
    { id: "deliller", title: "DELİLLER", slots: [{ kind: "deliller" }] },
    sonucSection(),
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 4. Temyiz dilekçesi
// ---------------------------------------------------------------------------

const TEMYIZ_DILEKCESI: DraftTemplate = {
  id: "temyiz-dilekcesi",
  kind: "dilekce",
  domain: "ozel-hukuk",
  title: "Temyiz Dilekçesi",
  description:
    "Bölge adliye mahkemesi kararına karşı temyiz taslağı (HMK m.361 vd.; süre kararın" +
    " tebliğinden itibaren iki hafta, dilekçe içeriği HMK m.364): temyiz edilen kararın" +
    " künyesi, ilk derece kararı, temyiz sebepleri (HMK m.371 bozma sebepleri" +
    " çerçevesinde doğrulanmış kanıta bağlı değerlendirme), ilamın tebliğ tarihi" +
    " (m.364/2-d), KARARIN ÖZETİ (m.364/2-e), duruşma istemi ve" +
    " bozma/onama istemi. Temyiz edilemeyen kararlar (HMK m.362) için kullanılmaz.",
  requiredFields: ["taraflar", "olaylar", "talepler", "ekBilgiler.karar", "ekBilgiler.tebligTarihi"],
  fields: [
    ...courtFields(),
    partyField("Taraflar (ad ve rol: Temyiz Eden / Karşı Taraf)", PARTY_HELP_DILEKCE),
    ...vekilFields(),
    ek("karar", "Temyiz edilen BAM kararı (Daire, E. .../..., K. .../..., T. ...)", {
      required: true,
      placeholder: "İstanbul BAM 12. Hukuk Dairesi, E. 2025/100, K. 2026/40, T. 15.03.2026",
      help: "HMK m.364/2-c: temyiz edilen kararın hangi bölge adliye mahkemesi hukuk dairesinden verilmiş olduğu, tarihi ve sayısı.",
    }),
    ek("ilkDereceKarar", "İlk derece kararı (Mahkeme, E./K., T.)", {
      placeholder: "İstanbul 3. Asliye Hukuk Mahkemesi, E. 2024/10, K. 2025/4, T. 01.02.2025",
      help:
        "HMK m.364/2-ç: Yargıtayın bozması üzerine verilen yeni karar veya direnme kararı" +
        " temyiz ediliyorsa bu kararın mahkemesi, tarihi ve sayısı da dilekçede bulunur.",
    }),
    ek("tebligTarihi", "BAM kararının tebliğ tarihi", {
      required: true,
      kind: "date",
      help:
        "HMK m.364/2-d: ilamın temyiz edene tebliğ edildiği tarih dilekçede bulunmalıdır." +
        " Süre hesabını Süreler ekranındaki 'Temyiz başvuru süresi (HMK m.361)' kuralıyla doğrulayın.",
    }),
    ek("kararOzeti", "Kararın özeti", {
      required: true,
      multiline: true,
      help:
        "HMK m.364/2-e: temyiz dilekçesinde kararın özeti bulunmalıdır — bölge adliye" +
        " mahkemesinin ne yönde hüküm kurduğunu birkaç cümleyle yazın.",
    }),
    ek("durusma", "Duruşma istemi (HMK m.369)", {
      kind: "select",
      // W14 (C16): the selected value is also written into the document body,
      // so the options are full sentences, not bare enum-looking words.
      options: ["Duruşma talep edilmemektedir", "Duruşma yapılması talep edilmektedir"],
      help: "Duruşma yalnızca HMK m.369'daki parasal sınırı aşan işlerde istenebilir.",
    }),
    olaylarField("Temyiz sebepleri — olgular (her satır bir sebep)"),
    olayAnlatisiField(),
    kapsamField(),
    konuField(),
    taleplerField(),
    delillerField(),
  ],
  sections: [
    {
      id: "baslik",
      title: "",
      slots: [
        {
          kind: "baslik",
          text:
            "YARGITAY İLGİLİ HUKUK DAİRESİ BAŞKANLIĞI'NA GÖNDERİLMEK ÜZERE" +
            " [KARARI VEREN BÖLGE ADLİYE MAHKEMESİ HUKUK DAİRESİ]'NE",
        },
      ],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "kunye",
      title: "TEMYİZ EDİLEN KARAR",
      slots: [
        {
          // W14 (B-25 / W13-COPY L18): app instruction + raw rule id removed
          // from the filed document body; they live in the field help now.
          kind: "hukum",
          text: "Temyiz edilen bölge adliye mahkemesi kararı: {karar}. İlk derece kararı: {ilkDereceKarar}. Karar tarafımıza {tebligTarihi} tarihinde tebliğ edilmiştir; iki haftalık temyiz süresi (HMK m.361/1) bu tarihten hesaplanır.",
          bilgi: ["karar", "ilkDereceKarar", "tebligTarihi"],
        },
        {
          kind: "hukum",
          text: "{durusma} (HMK m.369).",
          bilgi: ["durusma"],
        },
      ],
    },
    {
      // HMK m.364/2-e sayılan zorunlu unsur.
      id: "karar-ozeti",
      title: "KARARIN ÖZETİ",
      slots: [{ kind: "hukum", text: "{kararOzeti}", bilgi: ["kararOzeti"] }],
    },
    {
      id: "konu",
      title: "KONU",
      slots: [
        {
          kind: "konu",
          text:
            "Süresi içinde temyiz kanun yoluna başvurumuz ile aşağıda arz edilen" +
            " sebeplerle kararın BOZULMASI istemidir (HMK m.371).",
        },
      ],
    },
    {
      id: "sebepler",
      title: "TEMYİZ SEBEPLERİ",
      slots: [
        { kind: "olaylar" },
        { kind: "hukukiDegerlendirme", zorunlu: true },
        { kind: "hukukiSebepler", zorunlu: true },
      ],
    },
    { id: "deliller", title: "DELİLLER", slots: [{ kind: "deliller" }] },
    sonucSection(),
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 5. İhtarname
// ---------------------------------------------------------------------------

const IHTARNAME: DraftTemplate = {
  id: "ihtarname",
  kind: "dilekce",
  domain: "ozel-hukuk",
  title: "İhtarname",
  description:
    "Noter aracılığıyla gönderilecek ihtarname taslağı: keşideci ve muhatap, konu," +
    " olaylar, ihtar edilen hususlar (her satır bir talep) ve süre (TBK m.117 — borçlu" +
    " ihtarla temerrüde düşer; süre verilmesi TBK m.123 vd. için gereklidir), yasal" +
    " yollara başvuru bildirimi ve notere hitap. Hukukî değerlendirme isteğe bağlıdır;" +
    " verilirse yalnızca doğrulanmış kanıtlardan kurulur.",
  requiredFields: ["taraflar", "olaylar", "talepler"],
  fields: [
    field("matter.tarih", "İhtarname tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "Düzenleme yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    partyField(
      "Taraflar (ad ve rol: İhtar Eden / Muhatap)",
      "Her satır 'Rol : Ad'. Adres bilgisi tebligat için taraf kaydına eklenmelidir.",
    ),
    ...vekilFields(),
    olaylarField("Olaylar (her satır bir olgu)"),
    olayAnlatisiField(),
    kapsamField(),
    konuField(),
    ek("sure", "Verilen süre (gün)", {
      placeholder: "7",
      help: "İhtarnamenin tebliğinden itibaren ifa için tanınan süre; boşsa 'doldurun' olarak bırakılır.",
    }),
    taleplerField("İhtar edilen hususlar (her satır bir talep)"),
    ek("noter", "Noterlik", { placeholder: "İstanbul 5. Noterliği" }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "İHTARNAME" }] },
    {
      id: "noter",
      title: "",
      slots: [{ kind: "hukum", text: "Sayın {noter}", bilgi: ["noter"] }],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "konu",
      title: "KONU",
      slots: [
        {
          kind: "konu",
          text: "Aşağıda açıklanan hususların ihtarı ile belirtilen sürede ifasının talebidir.",
        },
      ],
    },
    {
      id: "aciklamalar",
      title: "AÇIKLAMALAR",
      slots: [{ kind: "olaylar" }, { kind: "hukukiDegerlendirme", zorunlu: false }],
    },
    {
      id: "hukuki-sebepler",
      title: "HUKUKÎ SEBEPLER",
      slots: [{ kind: "hukukiSebepler", zorunlu: false }],
    },
    {
      id: "ihtar",
      title: "İHTAR EDİLEN HUSUSLAR",
      slots: [
        { kind: "talepler" },
        {
          kind: "hukum",
          text:
            "İşbu ihtarnamenin tarafınıza tebliğinden itibaren {sure} gün içinde yukarıda" +
            " sayılan hususların yerine getirilmesini; aksi hâlde TBK m.117 uyarınca" +
            " temerrüde düşmüş sayılacağınızı, doğacak her türlü zarar, faiz, yargılama" +
            " gideri ve vekâlet ücretinin tarafınıza ait olacağını ve hakkınızda yasal" +
            " yollara başvurulacağını ihtaren bildiririz.",
          bilgi: ["sure"],
        },
      ],
    },
    {
      id: "notere-talep",
      title: "",
      slots: [
        {
          kind: "hukum",
          text:
            "Sayın Noter; üç nüshadan ibaret işbu ihtarnamenin bir nüshasının muhataba" +
            " 7201 sayılı Tebligat Kanunu hükümlerine göre tebliğini, bir nüshasının" +
            " dairenizde saklanmasını, tebliğ şerhli bir nüshasının tarafımıza verilmesini" +
            " saygıyla talep ederiz.",
        },
      ],
    },
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 6. İcra takibine itiraz dilekçesi (İİK m.62)
// ---------------------------------------------------------------------------

const ICRA_ITIRAZ: DraftTemplate = {
  id: "icra-itiraz-dilekcesi",
  kind: "dilekce",
  domain: "icra",
  title: "İcra Takibine İtiraz Dilekçesi (İİK m.62)",
  description:
    "Genel haciz yoluyla ilamsız takipte ödeme emrine itiraz taslağı (İİK m.62 —" +
    " ödeme emrinin tebliğinden itibaren YEDİ gün içinde icra dairesine): takip" +
    " dosyası, taraflar, itirazlar (borca, faize, yetkiye — İİK m.50; imzaya itiraz" +
    " İİK m.62/5 uyarınca AYRICA ve AÇIKÇA; kısmî itirazda miktar İİK m.62/4 uyarınca" +
    " açıkça), takibin durdurulması istemi (İİK m.66). Kambiyo senetlerine özgü" +
    " takipte itiraz BEŞ gün içinde İCRA MAHKEMESİNE yapılır (İİK m.168-169) — bu" +
    " şablon o yol için kullanılmaz.",
  requiredFields: ["taraflar", "talepler", "ekBilgiler.itirazlar"],
  fields: [
    field("matter.mahkeme", "İcra müdürlüğü", {
      placeholder: "İstanbul Anadolu 5. İcra Müdürlüğü",
      group: FIELD_GROUPS.mahkeme,
    }),
    field("matter.baslik", "Başlık satırı (tam metin)", {
      placeholder: "İSTANBUL ANADOLU 5. İCRA MÜDÜRLÜĞÜ'NE",
      group: FIELD_GROUPS.mahkeme,
    }),
    field("matter.esasNo", "Takip dosya numarası", {
      placeholder: "2026/1234 E.",
      group: FIELD_GROUPS.mahkeme,
    }),
    field("matter.tarih", "Dilekçe tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "Düzenleme yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    partyField(
      "Taraflar (ad ve rol: İtiraz Eden Borçlu / Alacaklı)",
      "Her satır 'Rol : Ad'. Borçlunun T.C. kimlik no ve adresi taraf kaydına eklenmelidir.",
    ),
    ...vekilFields(),
    ek("tebligTarihi", "Ödeme emrinin tebliğ tarihi", {
      kind: "date",
      help: "İİK m.62/1: yedi günlük itiraz süresi tebliğden başlar; süre kesindir.",
    }),
    ek("itirazlar", "İtirazlar (her satır bir itiraz)", {
      required: true,
      multiline: true,
      kind: "list",
      help:
        "Örn. 'Borca itiraz ediyoruz', 'Faize itiraz ediyoruz', 'Yetkiye itiraz ediyoruz (İİK m.50)'." +
        " İmzaya itiraz AYRICA ve AÇIKÇA yazılmalıdır (İİK m.62/5).",
    }),
    olaylarField("Açıklamalar (her satır bir olgu)"),
    olayAnlatisiField(),
    kapsamField(),
    taleplerField(),
    delillerField(),
  ],
  sections: [
    {
      id: "baslik",
      title: "",
      slots: [{ kind: "baslik", text: "[TAKİBİN YÜRÜTÜLDÜĞÜ] İCRA MÜDÜRLÜĞÜ'NE" }],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "konu",
      title: "KONU",
      slots: [
        {
          kind: "konu",
          text:
            "Ödeme emrine karşı İİK m.62 uyarınca süresi içinde itirazlarımızın sunulması" +
            " ve takibin durdurulması (İİK m.66) istemidir.",
        },
      ],
    },
    {
      id: "sure",
      title: "SÜRE",
      slots: [
        {
          kind: "hukum",
          text:
            "Ödeme emri tarafımıza {tebligTarihi} tarihinde tebliğ edilmiş olup işbu" +
            " itiraz İİK m.62/1'deki yedi günlük süre içinde yapılmaktadır.",
          bilgi: ["tebligTarihi"],
        },
      ],
    },
    {
      id: "itirazlar",
      title: "İTİRAZLARIMIZ",
      slots: [
        {
          kind: "liste",
          bilgiKey: "itirazlar",
          emptyText: "[İtirazlar — doldurun]",
        },
        {
          kind: "hukum",
          text:
            "Kısmî itiraz hâlinde itiraz edilen miktar açıkça yukarıda belirtilmiştir" +
            " (İİK m.62/4). Senet altındaki imzaya itirazımız varsa bu husus ayrıca ve" +
            " açıkça yukarıda bildirilmiştir (İİK m.62/5).",
        },
      ],
    },
    {
      id: "aciklamalar",
      title: "AÇIKLAMALAR",
      slots: [{ kind: "olaylar" }, { kind: "hukukiDegerlendirme", zorunlu: false }],
    },
    {
      id: "hukuki-sebepler",
      title: "HUKUKÎ SEBEPLER",
      slots: [
        {
          kind: "hukum",
          text: "2004 sayılı İcra ve İflas Kanunu m.50, m.60, m.62, m.66 ve ilgili mevzuat.",
        },
        { kind: "hukukiSebepler", zorunlu: false },
      ],
    },
    { id: "deliller", title: "DELİLLER", slots: [{ kind: "deliller" }] },
    sonucSection(),
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 7. Arabuluculuk başvurusu
// ---------------------------------------------------------------------------

const ARABULUCULUK_BASVURUSU: DraftTemplate = {
  id: "arabuluculuk-basvurusu",
  kind: "dilekce",
  domain: "ozel-hukuk",
  title: "Arabuluculuk Başvuru Formu (Dava Şartı)",
  description:
    "Adliye arabuluculuk bürosuna dava şartı arabuluculuk başvurusu taslağı (6325 sayılı" +
    " HUAK m.18/A): başvurucu ve karşı taraf (iletişim bilgileriyle), uyuşmazlık türü" +
    " (işçi-işveren — 7036 sayılı K. m.3; ticari — TTK m.5/A; tüketici — TKHK m.73/A;" +
    " kira ve ortaklığın giderilmesi vb. — HUAK m.18/B), uyuşmazlık konusu, olaylar ve" +
    " talep. Başvuru, büroya başvuru tarihinden son tutanağa kadar zamanaşımı ve hak" +
    " düşürücü süreleri durdurur (HUAK m.18/A-15).",
  requiredFields: ["taraflar", "olaylar", "talepler"],
  fields: [
    field("matter.mahkeme", "Arabuluculuk bürosu", {
      placeholder: "İstanbul Anadolu Adliyesi Arabuluculuk Bürosu",
      group: FIELD_GROUPS.mahkeme,
    }),
    field("matter.tarih", "Başvuru tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "Düzenleme yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    partyField(
      "Taraflar (ad ve rol: Başvurucu / Karşı Taraf)",
      "Her satır 'Rol : Ad'. Karşı tarafın adresi ve varsa telefon/e-posta bilgisi taraf kaydına eklenmelidir (HUAK m.18/A-4).",
    ),
    ...vekilFields(),
    ek("uyusmazlikTuru", "Uyuşmazlık türü", {
      kind: "select",
      options: [
        "işçi-işveren (7036 sayılı K. m.3)",
        "ticari (TTK m.5/A)",
        "tüketici (TKHK m.73/A)",
        "kira / ortaklığın giderilmesi / komşuluk (HUAK m.18/B)",
        "diğer (ihtiyari — HUAK m.13)",
      ],
      help: "Dava şartı olan uyuşmazlık türü; seçime göre yetkili büro ve süreler değişir.",
    }),
    olaylarField("Uyuşmazlığın özeti (her satır bir olgu)"),
    olayAnlatisiField(),
    kapsamField(),
    konuField(),
    taleplerField("Talep (her satır bir talep)"),
  ],
  sections: [
    {
      id: "baslik",
      title: "",
      slots: [{ kind: "baslik", text: "[ADLİYE] ARABULUCULUK BÜROSU'NA" }],
    },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "tur",
      title: "UYUŞMAZLIK TÜRÜ",
      slots: [
        {
          kind: "hukum",
          text: "Uyuşmazlık türü: {uyusmazlikTuru}. Başvuru, 6325 sayılı Hukuk Uyuşmazlıklarında Arabuluculuk Kanunu m.18/A uyarınca dava şartı arabuluculuk kapsamında yapılmaktadır.",
          bilgi: ["uyusmazlikTuru"],
        },
      ],
    },
    {
      id: "konu",
      title: "UYUŞMAZLIK KONUSU",
      slots: [
        {
          kind: "konu",
          text: "Aşağıda özetlenen uyuşmazlığın arabuluculuk yoluyla çözümü için başvurudur.",
        },
      ],
    },
    {
      id: "aciklamalar",
      title: "UYUŞMAZLIĞIN ÖZETİ",
      slots: [{ kind: "olaylar" }, { kind: "hukukiDegerlendirme", zorunlu: false }],
    },
    {
      id: "hukuki-sebepler",
      title: "HUKUKÎ SEBEPLER",
      slots: [{ kind: "hukukiSebepler", zorunlu: false }],
    },
    {
      id: "talep",
      title: "TALEP",
      slots: [
        { kind: "talepler" },
        {
          kind: "hukum",
          text:
            "Karşı tarafa HUAK m.18/A uyarınca davet yapılmasını, arabulucu" +
            " görevlendirilmesini ve görüşmelerin yürütülmesini talep ederiz. Anlaşma" +
            " sağlanamazsa son tutanağın tarafımıza verilmesini rica ederiz.",
        },
      ],
    },
    imzaSection(),
  ],
};

// ---------------------------------------------------------------------------
// 8. Hizmet sözleşmesi
// ---------------------------------------------------------------------------

const HIZMET_SOZLESMESI: DraftTemplate = {
  id: "hizmet-sozlesmesi",
  kind: "sozlesme",
  domain: "ozel-hukuk",
  title: "Hizmet Sözleşmesi",
  description:
    "Bağımsız hizmet sağlayıcıdan hizmet alımına ilişkin sözleşme taslağı (TBK m.502 vd." +
    " vekâlet veya m.470 vd. eser, işin niteliğine göre). UYARI: bağımlılık ilişkisi" +
    " doğuran bir düzen, adı ne olursa olsun TBK m.393 / 4857 sayılı Kanun m.8 anlamında" +
    " iş sözleşmesi sayılabilir — talimat, çalışma saati ve münhasırlık hükümlerini buna" +
    " göre yazın. İçerik: taraflar, konu-kapsam, bedel-ödeme, KDV ve fatura," +
    " süre-fesih ve ihbar süresi, cezai şart (TBK m.179 vd.), fikri mülkiyet, gizlilik" +
    " ve süresi, kişisel verilerin korunması (KVKK m.10 aydınlatma), mücbir sebep" +
    " (TBK m.136 vd. ifa imkânsızlığı ve genel ilkeler), uygulanacak hukuk-yetki ve" +
    " imzalar. Sözleşme hükümleri tarafların" +
    " iradesidir; kanıt verilirse ayrıca bilgi amaçlı hukukî dayanak notları eklenir.",
  requiredFields: ["taraflar", "ekBilgiler.hizmetKonusu", "ekBilgiler.bedel"],
  fields: [
    contractPartyField("Hizmet Veren / Hizmet Alan"),
    field("matter.tarih", "Sözleşme tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "İmza yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    ek("hizmetKonusu", "Hizmetin konusu", {
      required: true,
      placeholder: "aylık bakım ve destek hizmeti",
    }),
    ek("bedel", "Hizmet bedeli", { required: true, placeholder: "aylık 40.000 TL" }),
    ek("kdv", "KDV ve fatura düzeni", {
      placeholder: "bedele KDV dahil değildir; fatura her ayın ilk 5 günü içinde düzenlenir",
    }),
    ek("odemePlani", "Ödeme planı", { placeholder: "aylık eşit taksitler" }),
    ek("sure", "Sözleşme süresi", { placeholder: "12 ay" }),
    ek("ihbarSuresi", "Olağan fesih ihbar süresi", { placeholder: "30 gün" }),
    ek("cezaiSart", "Cezai şart", {
      placeholder: "gecikilen her gün için bedelin %0,5'i (toplam bedelin %10'unu aşamaz)",
      help: "TBK m.179-182: ceza koşulu; aşırı ceza hâkim tarafından indirilebilir (TBK m.182/3).",
    }),
    ek("fikriMulkiyet", "Fikri mülkiyet düzeni", {
      placeholder:
        "hizmet çıktılarının işleme, çoğaltma, yayma, temsil ve umuma iletim hakları" +
        " bedelin ödenmesiyle Hizmet Alan'a devredilir",
      // W14 (B-25 / W13-COPY L15): FSEK m.52 requires the transferred rights to
      // be listed one by one; a clause that does not list them is void.
      help:
        "FSEK m.52: mali haklara dair sözleşmelerin yazılı olması ve konuları olan hakların" +
        " AYRI AYRI GÖSTERİLMESİ şarttır. Burada saymadığınız mali hak devredilmemiş sayılır.",
    }),
    ek("gizlilikSuresi", "Gizlilik yükümlülüğünün süresi", {
      placeholder: "sözleşme sona erdikten sonra 3 yıl",
    }),
    ek("yetkiliMahkeme", "Yetkili mahkeme (şehir)", { placeholder: "İstanbul (Çağlayan)" }),
    ek("ozelSartlar", "Özel şartlar (her satır bir madde)", { multiline: true, kind: "list" }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "HİZMET SÖZLEŞMESİ" }] },
    {
      id: "taraflar",
      title: "TARAFLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "İşbu Hizmet Sözleşmesi ('Sözleşme'), aşağıda bilgileri yer alan taraflar" +
            " arasında, karşılıklı hak ve yükümlülükleri düzenlemek üzere" +
            " akdedilmiştir.",
        },
        { kind: "taraflar" },
      ],
    },
    {
      id: "konu-kapsam",
      title: "SÖZLEŞMENİN KONUSU VE KAPSAMI",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşmenin konusu: {hizmetKonusu}. Hizmet Veren, hizmeti işin gereğine" +
            " ve dürüstlük kuralına uygun biçimde, özenle ve zamanında ifa etmeyi;" +
            " Hizmet Alan, kararlaştırılan bedeli ödemeyi ve ifa için gerekli" +
            " bilgi ve erişimi sağlamayı kabul ve taahhüt eder.",
          bilgi: ["hizmetKonusu"],
        },
      ],
    },
    {
      id: "bedel",
      title: "BEDEL, KDV VE ÖDEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Hizmet bedeli {bedel} olarak kararlaştırılmıştır. KDV ve fatura düzeni:" +
            " {kdv}. Ödeme, {odemePlani} çerçevesinde, faturanın tebliğini izleyen 15" +
            " gün içinde Hizmet Veren'in yazılı olarak bildireceği banka hesabına" +
            " yapılır. Süresinde ödenmeyen tutarlara, taraflarca aksi kararlaştırılmadıkça" +
            " 3095 sayılı Kanun çerçevesinde temerrüt faizi işletilir.",
          bilgi: ["bedel", "kdv", "odemePlani"],
        },
      ],
    },
    {
      id: "sure-fesih",
      title: "SÜRE, FESİH VE İHBAR",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşme, imza tarihinde yürürlüğe girer ve {sure} süreyle geçerlidir." +
            " Taraflardan her biri, {ihbarSuresi} önceden yazılı bildirimde bulunmak" +
            " kaydıyla Sözleşmeyi olağan yolla feshedebilir. Diğer tarafın Sözleşmeye" +
            " esaslı aykırılığı hâlinde, aykırılığın giderilmesi için yazılı olarak" +
            " verilen makul süre sonuçsuz kaldığında Sözleşme haklı nedenle ve yazılı" +
            " bildirimle derhâl feshedilebilir. Fesih, fesih tarihine kadar doğmuş hak" +
            " ve borçları ortadan kaldırmaz.",
          bilgi: ["sure", "ihbarSuresi"],
        },
      ],
    },
    {
      id: "cezai-sart",
      title: "CEZAİ ŞART",
      slots: [
        {
          kind: "hukum",
          text:
            "Hizmet Veren'in ifada gecikmesi hâlinde cezai şart: {cezaiSart} (TBK m.179" +
            " vd.). Cezai şartın ödenmesi, aşan zararın tazminini talep hakkını ortadan" +
            " kaldırmaz (TBK m.180/2).",
          bilgi: ["cezaiSart"],
        },
      ],
    },
    {
      id: "fikri-mulkiyet",
      title: "FİKRİ MÜLKİYET",
      slots: [
        {
          kind: "hukum",
          text:
            "Hizmet kapsamında üretilen eser ve çıktılara ilişkin düzen: {fikriMulkiyet}." +
            " 5846 sayılı FSEK m.52 uyarınca mali haklara ilişkin sözleşmelerin YAZILI" +
            " OLMASI ve devredilen hakların AYRI AYRI GÖSTERİLMESİ şarttır; aşağıda" +
            " sayılmayan mali hak devredilmemiş sayılır. Devredilen mali haklar: işleme" +
            " (FSEK m.21), çoğaltma (m.22), yayma (m.23), temsil (m.24) ve işaret, ses" +
            " ve/veya görüntü nakline yarayan araçlarla umuma iletim (m.25) haklarıdır." +
            " Manevi haklar eser sahibinde kalır. Hizmet Veren'in önceden mevcut araç ve" +
            " kütüphaneleri üzerindeki hakları saklıdır.",
          bilgi: ["fikriMulkiyet"],
        },
      ],
    },
    {
      id: "gizlilik",
      title: "GİZLİLİK VE KİŞİSEL VERİLER",
      slots: [
        {
          kind: "hukum",
          text:
            "Taraflar, Sözleşmenin müzakeresi ve ifası sırasında öğrendikleri ticari" +
            " sır ve gizli bilgileri, diğer tarafın yazılı izni olmaksızın üçüncü" +
            " kişilere açıklamamayı kabul eder. Gizlilik yükümlülüğü {gizlilikSuresi}" +
            " süreyle yürürlükte kalır.",
          bilgi: ["gizlilikSuresi"],
        },
        {
          kind: "hukum",
          text:
            "Taraflar, Sözleşmenin ifası kapsamında işledikleri kişisel verileri 6698" +
            " sayılı Kişisel Verilerin Korunması Kanunu'na uygun olarak, yalnızca" +
            " Sözleşmenin ifası amacıyla işlemeyi; ilgili kişilere KVKK m.10 uyarınca" +
            " aydınlatma yapılmasını ve veri güvenliği tedbirlerinin (KVKK m.12)" +
            " alınmasını sağlamayı taahhüt eder.",
        },
      ],
    },
    {
      id: "mucbir-sebep",
      title: "MÜCBİR SEBEP",
      slots: [
        {
          kind: "hukum",
          text:
            "Tarafların kontrolü dışında gerçekleşen ve öngörülemeyen doğal afet, salgın," +
            " savaş, genel grev, resmî makam kararı gibi mücbir sebep hâllerinde etkilenen" +
            " tarafın yükümlülükleri, sebebin sürdüğü süre boyunca askıya alınır (TBK" +
            " m.136 vd. ifa imkânsızlığı hükümleri ve mücbir sebebe ilişkin genel ilkeler)." +
            " Etkilenen taraf durumu derhâl yazılı olarak bildirir; mücbir sebep 60 günü" +
            " aşarsa taraflardan her biri Sözleşmeyi tazminatsız feshedebilir.",
        },
      ],
    },
    {
      id: "ozel-sartlar",
      title: "ÖZEL ŞARTLAR",
      slots: [
        {
          kind: "liste",
          bilgiKey: "ozelSartlar",
          emptyText: "Taraflarca kararlaştırılmış ayrıca bir özel şart yoktur.",
        },
      ],
    },
    {
      id: "hukuk-yetki",
      title: "UYGULANACAK HUKUK VE YETKİLİ MAHKEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşmeden doğan veya Sözleşme ile bağlantılı uyuşmazlıklarda Türk" +
            " hukuku uygulanır; {yetkiliMahkeme} mahkemeleri ve icra daireleri" +
            " yetkilidir. Ticari uyuşmazlıklarda dava açılmadan önce arabulucuya" +
            " başvurulması dava şartıdır (TTK m.5/A).",
          bilgi: ["yetkiliMahkeme"],
        },
      ],
    },
    imzaSection("imzalar"),
    dayanakNotlariSection(),
  ],
};

// ---------------------------------------------------------------------------
// 9. Kira sözleşmesi
// ---------------------------------------------------------------------------

const KIRA_SOZLESMESI: DraftTemplate = {
  id: "kira-sozlesmesi",
  kind: "sozlesme",
  domain: "ozel-hukuk",
  title: "Kira Sözleşmesi (Konut/İşyeri)",
  description:
    "Konut veya çatılı işyeri kira sözleşmesi taslağı (TBK m.339 vd.): taraflar ve" +
    " kefil (TBK m.583 — kefalet yazılı; azami tutar ve tarih kefilin el yazısıyla)," +
    " mecur ve kullanım amacı, teslim tarihi, süre, kira bedeli ve ödeme, kira artışı" +
    " (TBK m.344 — üst sınır, TÜFE on iki aylık ortalamalara göre DEĞİŞİM ORANIDIR;" +
    " beşinci yıl ve sonrası için m.344/3 hâkim tarafından belirleme), aidat ve yan" +
    " giderler (TBK m.341), depozito (TBK m.342 — en çok üç aylık kira; vadeli hesap)," +
    " tarafların yükümlülükleri, tahliye ve tahliye taahhüdü (TBK m.352/1 — ayrı" +
    " belge, teslimden sonra, yazılı; uyulmazsa bir ay içinde icra veya dava)," +
    " özel şartlar.",
  requiredFields: ["taraflar", "ekBilgiler.mecur", "ekBilgiler.kiraBedeli"],
  fields: [
    contractPartyField("Kiraya Veren / Kiracı"),
    field("matter.tarih", "Sözleşme tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "İmza yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    ek("kefil", "Kefil (ad ve azami sorumluluk tutarı)", {
      placeholder: "Hasan Çelik — azami 360.000 TL",
      help: "TBK m.583: kefalet yazılı şekle tabidir; azami tutar ve kefalet tarihi kefilin el yazısıyla yazılmalıdır.",
    }),
    ek("mecur", "Kiralanan (mecur) adresi/niteliği", {
      required: true,
      placeholder: "İstanbul, ... Mah. ... Sk. No: 1 D: 2 adresli konut",
    }),
    ek("kullanimAmaci", "Kullanım amacı", { placeholder: "konut" }),
    ek("teslimTarihi", "Teslim tarihi", { kind: "date" }),
    ek("kiraBedeli", "Aylık kira bedeli", { required: true, placeholder: "30.000 TL" }),
    ek("odemeGunu", "Ödeme günü (ayın kaçıncı günü)", {
      placeholder: "5",
      // W14 (B-25 / W13-COPY L25): the tax-circular reference and the note to
      // the drafter used to sit inside the signed contract text.
      help:
        "Banka veya PTT aracılığıyla ödeme yükümlülüğü bir vergi usulü yükümlülüğüdür" +
        " (GVK Genel Tebliği Seri No 268, Seri No 323 ile değişik); tebliğ numarasını" +
        " güncel metinden doğrulayın.",
    }),
    ek("artisOrani", "Kira artış oranı", {
      placeholder: "TÜFE on iki aylık ortalamalara göre değişim oranı (TBK m.344/1 üst sınırı)",
      help:
        "Konut ve çatılı işyeri kiralarında artış, bir önceki kira yılının TÜFE on iki" +
        " aylık ortalamalara göre DEĞİŞİM ORANINI aşamaz (TBK m.344/1) — ortalamanın" +
        " kendisini değil, ortalamalara göre değişim oranını yazın.",
    }),
    ek("aidat", "Aidat ve yan giderler", {
      placeholder: "site aidatı kiracıya aittir; DASK ve konut sigortası kiraya verene aittir",
    }),
    ek("sure", "Kira süresi", { placeholder: "1 yıl" }),
    ek("depozito", "Depozito", {
      placeholder: "iki aylık kira tutarı",
      help: "TBK m.342: güvence en çok üç aylık kira bedelini aşamaz ve vadeli tasarruf hesabına yatırılır.",
    }),
    ek("tahliyeTaahhudu", "Tahliye taahhüdü (varsa tarihi)", {
      placeholder: "kiracı, teslimden sonra ayrı belge ile GG.AA.YYYY tarihli tahliye taahhüdü vermiştir",
      help:
        "TBK m.352/1: tahliye taahhüdü ancak kiralananın tesliminden SONRA ve yazılı olarak" +
        " verilirse geçerlidir; ayrı belge olmalıdır. Taahhüde uyulmazsa kiraya veren" +
        " taahhüt edilen tarihten başlayarak BİR AY içinde icraya başvurmalı veya dava" +
        " açmalıdır; süre hak düşürücüdür.",
    }),
    ek("ozelSartlar", "Özel şartlar (her satır bir madde)", { multiline: true, kind: "list" }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "KİRA SÖZLEŞMESİ" }] },
    {
      id: "taraflar",
      title: "TARAFLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "İşbu Kira Sözleşmesi ('Sözleşme'), aşağıda bilgileri yer alan kiraya" +
            " veren ile kiracı arasında akdedilmiştir.",
        },
        { kind: "taraflar" },
        {
          kind: "hukum",
          text:
            "Kefil: {kefil}. Kefil, kiracının Sözleşmeden doğan kira ve yan gider" +
            " borçlarından TBK m.583 uyarınca el yazısıyla belirttiği azami tutarla ve" +
            " kefalet tarihiyle sınırlı olarak müteselsil kefildir. Kefaletin uzayan" +
            " kira dönemlerini de kapsayıp kapsamadığı ve azami süresi kefalet" +
            " beyanında ayrıca yazılır (gerçek kişi kefaleti TBK m.598/3 uyarınca on" +
            " yılın geçmesiyle kendiliğinden sona erer).",
          bilgi: ["kefil"],
        },
      ],
    },
    {
      id: "mecur",
      title: "MECUR (KİRALANAN) VE TESLİM",
      slots: [
        {
          kind: "hukum",
          text:
            "Kiralanan: {mecur}. Kullanım amacı: {kullanimAmaci}. Mecur, {teslimTarihi}" +
            " tarihinde mevcut durumu taraflarca birlikte tespit edilerek, kullanım" +
            " amacına uygun ve elverişli hâlde kiracıya teslim edilir (TBK m.301).",
          bilgi: ["mecur", "kullanimAmaci", "teslimTarihi"],
        },
      ],
    },
    {
      id: "sure",
      title: "KİRA SÜRESİ",
      slots: [
        {
          kind: "hukum",
          text:
            "Kira süresi {sure} olup teslim tarihinde başlar. Kiracı, sürenin bitiminden" +
            " EN AZ ON BEŞ GÜN ÖNCE bildirimde bulunmadıkça Sözleşme aynı koşullarla bir" +
            " yıl için uzatılmış sayılır. Kiraya veren, sözleşme süresinin bitimine" +
            " dayanarak sözleşmeyi sona erdiremez; ancak ON YILLIK UZAMA SÜRESİ SONUNDA," +
            " bu süreyi izleyen her uzama yılının bitiminden en az üç ay önce bildirimde" +
            " bulunmak koşuluyla, herhangi bir sebep göstermeksizin sözleşmeye son" +
            " verebilir (TBK m.347/1).",
          bilgi: ["sure"],
        },
      ],
    },
    {
      id: "bedel",
      title: "KİRA BEDELİ, ARTIŞ VE ÖDEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Aylık kira bedeli {kiraBedeli} olup her ayın {odemeGunu}. gününe kadar" +
            " kiraya verenin yazılı olarak bildireceği banka hesabına ödenir; kira bedeli" +
            " tutarına bakılmaksızın banka veya PTT aracılığıyla ödenir, elden ödeme" +
            " yapılmaz. Yenilenen kira dönemlerinde artış oranı: {artisOrani}. Konut ve" +
            " çatılı işyeri kiralarında yenilenen dönem kira bedeline ilişkin anlaşma," +
            " bir önceki kira yılında tüketici fiyat endeksindeki ON İKİ AYLIK" +
            " ORTALAMALARA GÖRE DEĞİŞİM ORANINI geçmemek koşuluyla geçerlidir" +
            " (TBK m.344/1).",
          bilgi: ["kiraBedeli", "odemeGunu", "artisOrani"],
        },
        {
          // W14 (B-25 / W13-COPY L10): the template's default term is one year
          // and renews under TBK m.347, so the fifth year is unavoidable and
          // m.344/3 was never mentioned.
          kind: "hukum",
          text:
            "Beş yıldan uzun süreli veya beş yıldan sonra yenilenen kira sözleşmelerinde" +
            " ve bundan sonraki her beş yılın sonunda, yeni kira yılında uygulanacak kira" +
            " bedeli; tüketici fiyat endeksindeki on iki aylık ortalamalara göre değişim" +
            " oranı, kiralananın durumu ve emsal kira bedelleri göz önünde tutularak HÂKİM" +
            " tarafından hakkaniyete uygun biçimde belirlenir (TBK m.344/3).",
        },
      ],
    },
    {
      id: "aidat",
      title: "AİDAT VE YAN GİDERLER",
      slots: [
        {
          kind: "hukum",
          text:
            "Aidat ve yan giderler: {aidat}. TBK m.341 uyarınca kiracı, kullanıma bağlı" +
            " olağan giderleri (elektrik, su, doğalgaz, ısınma, temizlik ve bakım aidatı)" +
            " öder; mecurun ayıplarından ve esaslı onarımlardan doğan giderler kiraya" +
            " verene aittir.",
          bilgi: ["aidat"],
        },
      ],
    },
    {
      id: "depozito",
      title: "DEPOZİTO",
      slots: [
        {
          kind: "hukum",
          text:
            "Kiracı, {depozito} tutarında güvence bedelini TBK m.342 uyarınca kiraya" +
            " verenin onayı olmaksızın çekilmemek üzere vadeli tasarruf hesabına" +
            " yatırır. Depozito, mecurun Sözleşmeye uygun biçimde tahliye ve teslimi" +
            " ile kira ve yan giderlere ilişkin borç bulunmadığının tespiti üzerine" +
            " kiracıya iade edilir.",
          bilgi: ["depozito"],
        },
      ],
    },
    {
      id: "yukumlulukler",
      title: "TARAFLARIN YÜKÜMLÜLÜKLERİ",
      slots: [
        {
          kind: "hukum",
          text:
            "Kiraya veren, mecuru kararlaştırılan tarihte kullanım amacına" +
            " elverişli hâlde teslim etmek ve Sözleşme süresince bu hâlde" +
            " bulundurmakla; mecurun ayıplarından doğan esaslı onarımları" +
            " üstlenmekle yükümlüdür (TBK m.301, m.305 vd.).",
        },
        {
          kind: "hukum",
          text:
            "Kiracı, mecuru özenle ve tahsis amacına uygun kullanmakla, olağan" +
            " bakım ve temizlik giderlerini karşılamakla ve komşuluk hukukuna" +
            " uymakla yükümlüdür (TBK m.316); kiraya verenin yazılı izni olmaksızın" +
            " mecuru üçüncü kişilere devredemez ve alt kiraya veremez (TBK m.322).",
        },
      ],
    },
    {
      id: "tahliye",
      title: "TAHLİYE VE TAHLİYE TAAHHÜDÜ",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşme sona erdiğinde kiracı, mecuru teslim aldığı hâliyle (olağan" +
            " kullanımdan doğan yıpranma hariç) tahliye ederek anahtarlarıyla" +
            " birlikte teslim eder (TBK m.334). Tarafların tahliyeye ilişkin" +
            " kanundan doğan hakları saklıdır (TBK m.350 vd.).",
        },
        {
          kind: "hukum",
          text:
            "Tahliye taahhüdü: {tahliyeTaahhudu}. TBK m.352/1 uyarınca tahliye taahhüdü" +
            " ancak kiralananın tesliminden SONRA, yazılı ve ayrı bir belgeyle verilirse" +
            " geçerlidir; Sözleşme ile aynı tarihli taahhüt geçersiz sayılabilir." +
            " Taahhüde uyulmaması hâlinde kiraya veren, TAAHHÜT EDİLEN TARİHTEN BAŞLAYARAK" +
            " BİR AY İÇİNDE icraya başvurmak veya dava açmak suretiyle kira sözleşmesini" +
            " sona erdirebilir (TBK m.352/1).",
          bilgi: ["tahliyeTaahhudu"],
        },
      ],
    },
    {
      id: "ozel-sartlar",
      title: "ÖZEL ŞARTLAR",
      slots: [
        {
          kind: "liste",
          bilgiKey: "ozelSartlar",
          emptyText: "Taraflarca kararlaştırılmış ayrıca bir özel şart yoktur.",
        },
      ],
    },
    imzaSection("imzalar"),
    dayanakNotlariSection(),
  ],
};

// ---------------------------------------------------------------------------
// 10. Tahliye taahhütnamesi (TBK m.352/1)
// ---------------------------------------------------------------------------

const TAHLIYE_TAAHHUTNAMESI: DraftTemplate = {
  id: "tahliye-taahhutnamesi",
  kind: "sozlesme",
  domain: "ozel-hukuk",
  title: "Tahliye Taahhütnamesi (TBK m.352/1)",
  description:
    "Kiracının kiralananı belirli bir tarihte boşaltacağına ilişkin yazılı tahliye" +
    " taahhüdü taslağı (TBK m.352/1): taraflar, mecur, kira sözleşmesi ve teslim tarihi," +
    " tahliye tarihi ve kayıtsız şartsız tahliye beyanı; taahhüde uyulmazsa kiraya veren" +
    " TAHLİYE TARİHİNDEN BAŞLAYARAK BİR AY İÇİNDE icraya başvurmak veya dava açmak" +
    " suretiyle sözleşmeyi sona erdirebilir (TBK m.352/1; icra yolu için İİK m.272 vd.)." +
    " Taahhüt, kiralananın tesliminden SONRA ve YAZILI olarak verilmelidir; el yazısı" +
    " kanunda aranan bir geçerlilik şartı değildir. Aynı tarihli taahhütler Yargıtay" +
    " uygulamasında geçersiz sayılmaktadır; avukat teslim ve düzenleme tarihlerini" +
    " kontrol etmelidir.",
  requiredFields: ["taraflar", "ekBilgiler.mecur", "ekBilgiler.tahliyeTarihi"],
  fields: [
    contractPartyField("Kiracı / Kiraya Veren"),
    field("matter.tarih", "Düzenleme tarihi", {
      kind: "date",
      help: "Teslim tarihinden SONRAKİ bir tarih olmalıdır (TBK m.352/1).",
      group: FIELD_GROUPS.belge,
    }),
    field("matter.ekBilgiler.yer", "Düzenleme yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    ek("mecur", "Kiralanan (mecur) adresi", {
      required: true,
      placeholder: "İstanbul, ... Mah. ... Sk. No: 1 D: 2",
    }),
    ek("kiraSozlesmesiTarihi", "Kira sözleşmesinin tarihi", { kind: "date" }),
    ek("teslimTarihi", "Kiralananın teslim tarihi", {
      kind: "date",
      help: "Taahhüt bu tarihten sonra verilmiş olmalıdır (TBK m.352/1).",
    }),
    ek("tahliyeTarihi", "Tahliye tarihi", {
      required: true,
      kind: "date",
      // W14 (B-25 / W13-COPY L6): the one-month hak düşürücü süre was missing
      // from the whole template. It is the first reason tahliye-taahhüdü
      // files are lost.
      help:
        "TBK m.352/1: taahhüde uyulmazsa kiraya veren BU TARİHTEN BAŞLAYARAK BİR AY İÇİNDE" +
        " icra takibi başlatmalı veya dava açmalıdır; süre hak düşürücüdür. Süreyi Süreler" +
        " ekranındaki 'Tahliye taahhüdüne dayalı icra/dava süresi (TBK m.352/1)' kuralıyla" +
        " hesaplayın.",
    }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "TAHLİYE TAAHHÜTNAMESİ" }] },
    { id: "taraflar", title: "TARAFLAR", slots: [{ kind: "taraflar" }] },
    {
      id: "taahhut",
      title: "TAAHHÜT",
      slots: [
        {
          kind: "hukum",
          text:
            "Kiracı sıfatıyla, {kiraSozlesmesiTarihi} tarihli kira sözleşmesi uyarınca" +
            " kiralayıp {teslimTarihi} tarihinde teslim aldığım {mecur} adresindeki" +
            " kiralananı, {tahliyeTarihi} tarihinde hiçbir ihtar ve ihbara gerek" +
            " kalmaksızın, kayıtsız ve şartsız olarak tahliye ederek anahtarlarıyla" +
            " birlikte kiraya verene teslim edeceğimi kabul, beyan ve taahhüt ederim.",
          bilgi: ["kiraSozlesmesiTarihi", "teslimTarihi", "mecur", "tahliyeTarihi"],
        },
        {
          kind: "hukum",
          text:
            "Taahhüt ettiğim tarihte kiralananı tahliye etmediğim takdirde, kiraya verenin" +
            " 6098 sayılı TBK m.352/1 uyarınca TAAHHÜT EDİLEN TAHLİYE TARİHİNDEN BAŞLAYARAK" +
            " BİR AY İÇİNDE icraya başvurmak (2004 sayılı İİK m.272 vd.) veya dava açmak" +
            " suretiyle kira sözleşmesini sona erdirebileceğini; tahliye tarihinden sonraki" +
            " kullanım için doğacak zararlardan sorumlu olacağımı bilerek ve isteyerek" +
            " imzaladım.",
        },
        {
          kind: "hukum",
          text:
            "İşbu taahhütname, kiralananın tarafıma tesliminden SONRA, YAZILI olarak," +
            " serbest irademle ve tek nüsha olarak düzenlenmiştir; kiralananla ilgili" +
            " başka bir tahliye taahhüdü bulunmamaktadır.",
        },
      ],
    },
    imzaSection("imzalar"),
    dayanakNotlariSection(),
  ],
};

// ---------------------------------------------------------------------------
// 11. İş sözleşmesi (4857 sayılı İş Kanunu)
// ---------------------------------------------------------------------------

const IS_SOZLESMESI: DraftTemplate = {
  id: "is-sozlesmesi",
  kind: "sozlesme",
  domain: "ozel-hukuk",
  title: "Belirsiz Süreli İş Sözleşmesi",
  description:
    "4857 sayılı İş Kanunu'na tabi belirsiz süreli iş sözleşmesi taslağı (İş K. m.8 —" +
    " yazılı sözleşme): işveren ve işçi, görev ve işyeri, deneme süresi (İş K. m.15 —" +
    " en çok iki ay), çalışma süresi (İş K. m.63 — haftada 45 saat), ücret ve ödeme" +
    " (İş K. m.32 — en geç ayda bir, banka), fazla çalışma (İş K. m.41 — %50 zamlı;" +
    " işçinin onayı; serbest zaman 1 saat 30 dakika, 6 ay içinde; yılda en çok 270" +
    " saat), yıllık ücretli izin (İş K. m.53), fesih ve ihbar süreleri" +
    " (İş K. m.17), gizlilik ve rekabet yasağı (TBK m.444–447 sınırları), kişisel" +
    " veriler (KVKK m.10), özel şartlar, yetkili mahkeme (7036 sayılı K. m.6) ve dava" +
    " şartı arabuluculuk (7036 sayılı K. m.3).",
  requiredFields: ["taraflar", "ekBilgiler.gorev", "ekBilgiler.ucret"],
  fields: [
    contractPartyField("İşveren / İşçi"),
    field("matter.tarih", "Sözleşme tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "İmza yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    ek("gorev", "Görev / pozisyon", { required: true, placeholder: "yazılım geliştirme uzmanı" }),
    ek("isyeri", "İşyeri adresi", { placeholder: "İstanbul, ... Mah. ... Cad. No: 10" }),
    ek("baslangicTarihi", "İşe başlama tarihi", { kind: "date" }),
    ek("denemeSuresi", "Deneme süresi", {
      placeholder: "iki ay",
      help: "İş K. m.15: en çok iki ay; toplu iş sözleşmesiyle dört aya kadar uzatılabilir.",
    }),
    ek("ucret", "Aylık brüt ücret", { required: true, placeholder: "60.000 TL brüt" }),
    ek("odemeGunu", "Ücret ödeme günü", { placeholder: "her ayın 5'i" }),
    ek("calismaSuresi", "Haftalık çalışma düzeni", {
      placeholder: "haftada 45 saat; Pazartesi–Cuma 09:00–18:00",
      help: "İş K. m.63: haftalık çalışma süresi en çok 45 saattir.",
    }),
    ek("yanHaklar", "Yan haklar", { placeholder: "yemek kartı, yol ücreti, özel sağlık sigortası" }),
    ek("rekabetYasagi", "Rekabet yasağı (süre / yer / iş türü)", {
      placeholder: "fesihten sonra 1 yıl, İstanbul ili, aynı sektörde",
      help: "TBK m.445: süre iki yılı aşamaz; yer ve iş türü bakımından sınırlı olmalıdır.",
    }),
    ek("ozelSartlar", "Özel şartlar (her satır bir madde)", { multiline: true, kind: "list" }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "BELİRSİZ SÜRELİ İŞ SÖZLEŞMESİ" }] },
    {
      id: "taraflar",
      title: "TARAFLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "İşbu belirsiz süreli iş sözleşmesi ('Sözleşme'), 4857 sayılı İş Kanunu m.8" +
            " uyarınca aşağıda bilgileri yer alan işveren ile işçi arasında yazılı olarak" +
            " akdedilmiştir.",
        },
        { kind: "taraflar" },
      ],
    },
    {
      id: "gorev",
      title: "GÖREV, İŞYERİ VE BAŞLANGIÇ",
      slots: [
        {
          kind: "hukum",
          text:
            "İşçi, {gorev} görevini {isyeri} adresindeki işyerinde ifa eder ve" +
            " {baslangicTarihi} tarihinde işe başlar. İşveren, işin niteliği" +
            " değişmemek kaydıyla işçiyi aynı işyerinde benzer görevlerde" +
            " çalıştırabilir; esaslı değişiklikler İş K. m.22 uyarınca işçinin yazılı" +
            " kabulüne bağlıdır.",
          bilgi: ["gorev", "isyeri", "baslangicTarihi"],
        },
      ],
    },
    {
      id: "deneme",
      title: "DENEME SÜRESİ",
      slots: [
        {
          kind: "hukum",
          text:
            "Deneme süresi {denemeSuresi} olarak kararlaştırılmıştır (İş K. m.15 — en" +
            " çok iki ay). Deneme süresi içinde taraflar sözleşmeyi bildirim süresine" +
            " gerek olmaksızın ve tazminatsız feshedebilir; işçinin çalıştığı günler" +
            " için ücret ve diğer hakları saklıdır.",
          bilgi: ["denemeSuresi"],
        },
      ],
    },
    {
      id: "calisma",
      title: "ÇALIŞMA SÜRESİ VE FAZLA ÇALIŞMA",
      slots: [
        {
          kind: "hukum",
          text:
            "Çalışma düzeni: {calismaSuresi}. Haftalık çalışma süresi İş K. m.63 uyarınca" +
            " en çok 45 saattir. Fazla çalışma için İŞÇİNİN ONAYI alınır (İş K. m.41;" +
            " onayın yazılı alınması Fazla Çalışma ve Fazla Sürelerle Çalışma Yönetmeliği" +
            " m.9 gereğidir). Her fazla çalışma saati için ücret, normal saat ücretinin" +
            " %50 yükseltilmesiyle ödenir. İşçi dilerse zamlı ücret yerine, fazla" +
            " çalıştığı her saat karşılığında BİR SAAT OTUZ DAKİKA serbest zaman" +
            " kullanabilir ve bu zamanı ALTI AY içinde, çalışma süreleri içinde ve" +
            " ücretinden kesinti olmadan kullanır. Fazla çalışma süresinin toplamı bir" +
            " yılda İKİ YÜZ YETMİŞ SAATİ aşamaz.",
          bilgi: ["calismaSuresi"],
        },
      ],
    },
    {
      id: "ucret",
      title: "ÜCRET VE YAN HAKLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "Aylık ücret {ucret} olup {odemeGunu} tarihinde, İş K. m.32 uyarınca en geç" +
            " ayda bir ve işçinin banka hesabına ödenir. Yan haklar: {yanHaklar}. Ücret," +
            " asgari ücretin altında kararlaştırılamaz; ücret alacaklarında zamanaşımı beş" +
            " yıldır (İş K. m.32/son).",
          bilgi: ["ucret", "odemeGunu", "yanHaklar"],
        },
      ],
    },
    {
      id: "izin",
      title: "YILLIK ÜCRETLİ İZİN",
      slots: [
        {
          kind: "hukum",
          text:
            "İşçi, işyerinde en az bir yıl çalışmış olmak kaydıyla İş K. m.53'te" +
            " öngörülen sürelerde (bir yıldan beş yıla kadar — beş yıl dahil — 14," +
            " beş yıldan fazla on beş yıldan az 20, on beş yıl — dahil — ve daha fazla" +
            " için 26 gün) yıllık ücretli izne hak kazanır; izin hakkından vazgeçilemez.",
        },
      ],
    },
    {
      id: "fesih",
      title: "FESİH VE İHBAR SÜRELERİ",
      slots: [
        {
          kind: "hukum",
          text:
            "Taraflardan her biri, İş K. m.17'deki bildirim sürelerine (altı aya kadar" +
            " iki hafta; altı ay–bir buçuk yıl dört hafta; bir buçuk–üç yıl altı hafta;" +
            " üç yıldan fazla sekiz hafta) uyarak Sözleşmeyi feshedebilir. Bildirim" +
            " şartına uymayan taraf, süreye ilişkin ücret tutarında ihbar tazminatı öder." +
            " İş K. m.24 ve m.25'teki haklı nedenle derhâl fesih hakları ile iş güvencesi" +
            " hükümleri (İş K. m.18-21) saklıdır.",
        },
      ],
    },
    {
      id: "gizlilik",
      title: "GİZLİLİK, REKABET YASAĞI VE KİŞİSEL VERİLER",
      slots: [
        {
          kind: "hukum",
          text:
            "İşçi, iş ilişkisi sırasında öğrendiği ticari sırları ve gizli bilgileri iş" +
            " ilişkisi sona erdikten sonra da saklamakla yükümlüdür (TBK m.396/4)." +
            " Rekabet yasağı: {rekabetYasagi}; yasak TBK m.444-447 uyarınca yer, süre" +
            " (en çok iki yıl) ve iş türü bakımından sınırlıdır ve işçinin ekonomik" +
            " geleceğini hakkaniyete aykırı biçimde tehlikeye düşüremez.",
          bilgi: ["rekabetYasagi"],
        },
        {
          kind: "hukum",
          text:
            "İşveren, işçinin kişisel verilerini 6698 sayılı KVKK'ya uygun olarak ve" +
            " yalnızca iş ilişkisinin gerektirdiği ölçüde işler; işçiye KVKK m.10" +
            " uyarınca aydınlatma metni ayrıca tebliğ edilmiştir.",
        },
      ],
    },
    {
      id: "ozel-sartlar",
      title: "ÖZEL ŞARTLAR",
      slots: [
        {
          kind: "liste",
          bilgiKey: "ozelSartlar",
          emptyText: "Taraflarca kararlaştırılmış ayrıca bir özel şart yoktur.",
        },
      ],
    },
    {
      id: "hukuk-yetki",
      title: "UYUŞMAZLIKLARIN ÇÖZÜMÜ",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşmeden doğan uyuşmazlıklarda 7036 sayılı İş Mahkemeleri Kanunu m.3" +
            " uyarınca dava açılmadan önce arabulucuya başvurulması dava şartıdır;" +
            " yetkili mahkeme aynı Kanun m.6 uyarınca davalının yerleşim yeri veya işin" +
            " yapıldığı yer iş mahkemesidir.",
        },
      ],
    },
    imzaSection("imzalar"),
    dayanakNotlariSection(),
  ],
};

// ---------------------------------------------------------------------------
// 12. Satış sözleşmesi (taşınır; TBK m.207 vd.)
// ---------------------------------------------------------------------------

const SATIS_SOZLESMESI: DraftTemplate = {
  id: "satis-sozlesmesi",
  kind: "sozlesme",
  domain: "ozel-hukuk",
  title: "Satış Sözleşmesi (Taşınır)",
  description:
    "Taşınır satış sözleşmesi taslağı (TBK m.207 vd.): taraflar, satılan mal, bedel ve" +
    " ödeme, teslim yeri-tarihi ile yarar ve hasarın geçişi (TBK m.208), ayıptan" +
    " sorumluluk ve gözden geçirme-bildirim yükümü (TBK m.219-231, m.223; tacirler" +
    " arasında TTK m.23 süreleri), mülkiyeti saklı tutma kaydı (TMK m.764 — noter" +
    " sicili), temerrüt (TBK m.117 vd.), cezai şart (TBK m.179 vd.), uyuşmazlık ve" +
    " imzalar. Taşınmaz satışı resmî şekle tabidir (TMK m.706) — bu şablon taşınmaz" +
    " için kullanılmaz.",
  requiredFields: ["taraflar", "ekBilgiler.mal", "ekBilgiler.bedel"],
  fields: [
    contractPartyField("Satıcı / Alıcı"),
    field("matter.tarih", "Sözleşme tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "İmza yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    ek("mal", "Satılan mal (nitelik, adet, seri no)", {
      required: true,
      placeholder: "1 adet CNC torna tezgâhı, seri no ...",
    }),
    ek("bedel", "Satış bedeli", { required: true, placeholder: "1.200.000 TL + KDV" }),
    ek("odemeSekli", "Ödeme şekli", { placeholder: "%30 peşin, bakiye teslimde banka havalesi" }),
    ek("teslimTarihi", "Teslim tarihi", { kind: "date" }),
    ek("teslimYeri", "Teslim yeri", { placeholder: "alıcının ... adresindeki işyeri" }),
    ek("garanti", "Garanti süresi", { placeholder: "teslimden itibaren 2 yıl" }),
    ek("cezaiSart", "Cezai şart (teslimde gecikme)", {
      placeholder: "gecikilen her gün için bedelin %0,2'si",
    }),
    ek("mulkiyetiSakliTutma", "Mülkiyeti saklı tutma kaydı", {
      kind: "select",
      // W14 (C16): the chosen value is written into the signed contract, so the
      // options are readable clauses, not bare "yok"/"var".
      options: ["Yok", "Var — TMK m.764 uyarınca noter özel siciline tescil edilecek"],
      help:
        "TMK m.764: mülkiyeti saklı tutma kaydı ancak resmî şekilde yapılacak sözleşmenin" +
        " DEVRALANIN YERLEŞİM YERİ noterliğinde özel siciline kaydedilmesiyle geçerli olur.",
    }),
    ek("yetkiliMahkeme", "Yetkili mahkeme (şehir)", { placeholder: "İstanbul" }),
    ek("ozelSartlar", "Özel şartlar (her satır bir madde)", { multiline: true, kind: "list" }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "SATIŞ SÖZLEŞMESİ" }] },
    {
      id: "taraflar",
      title: "TARAFLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "İşbu Satış Sözleşmesi ('Sözleşme'), 6098 sayılı TBK m.207 vd. uyarınca" +
            " aşağıda bilgileri yer alan satıcı ile alıcı arasında akdedilmiştir.",
        },
        { kind: "taraflar" },
      ],
    },
    {
      id: "konu",
      title: "SÖZLEŞMENİN KONUSU",
      slots: [
        {
          kind: "hukum",
          text:
            "Satılan: {mal}. Satıcı, satılanın mülkiyetini ve zilyetliğini alıcıya" +
            " devretmeyi; alıcı, bedeli ödemeyi borçlanır (TBK m.207/1).",
          bilgi: ["mal"],
        },
      ],
    },
    {
      id: "bedel",
      title: "BEDEL VE ÖDEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Satış bedeli {bedel} olarak kararlaştırılmıştır. Ödeme şekli: {odemeSekli}." +
            " Ödeme günü bu Sözleşmede birlikte belirlenmiş ise, bedelin süresinde" +
            " ödenmemesi hâlinde alıcı ihtara gerek olmaksızın BU GÜNÜN GEÇMESİYLE" +
            " temerrüde düşer (TBK m.117/2). Ödeme günü belirlenmemişse temerrüt, TBK" +
            " m.117/1 uyarınca satıcının İHTARIYLA doğar. Temerrüt hâlinde 3095 sayılı" +
            " Kanun uyarınca temerrüt faizi işler.",
          bilgi: ["bedel", "odemeSekli"],
        },
      ],
    },
    {
      id: "teslim",
      title: "TESLİM, YARAR VE HASAR",
      slots: [
        {
          kind: "hukum",
          text:
            "Satılan, {teslimTarihi} tarihinde {teslimYeri} adresinde teslim edilir." +
            " Yarar ve hasar, taşınırlarda zilyetliğin devri anında alıcıya geçer (TBK" +
            " m.208/1). Teslimde gecikme hâlinde cezai şart: {cezaiSart} (TBK m.179 vd.);" +
            " alıcının aşan zararını talep hakkı saklıdır (TBK m.180/2).",
          bilgi: ["teslimTarihi", "teslimYeri", "cezaiSart"],
        },
      ],
    },
    {
      id: "ayip",
      title: "AYIPTAN SORUMLULUK VE GARANTİ",
      slots: [
        {
          kind: "hukum",
          text:
            "Satıcı, satılanın bildirilen niteliklere sahip olmamasından ve kullanım" +
            " değerini azaltan ayıplardan TBK m.219 vd. uyarınca sorumludur. Alıcı," +
            " satılanı teslim aldıktan sonra işlerin olağan akışına göre imkân bulur" +
            " bulmaz gözden geçirmek ve ayıbı uygun süre içinde satıcıya bildirmekle" +
            " yükümlüdür (TBK m.223); her iki taraf tacir ise TTK m.23/1-c'deki iki ve" +
            " sekiz günlük süreler uygulanır. Garanti: {garanti}. Alıcının TBK m.227'deki" +
            " seçimlik hakları saklıdır.",
          bilgi: ["garanti"],
        },
      ],
    },
    {
      id: "mulkiyet",
      title: "MÜLKİYETİN GEÇİŞİ",
      slots: [
        {
          kind: "hukum",
          text:
            // W14 (B-25 / W13-COPY L28): a signed contract must not carry the
            // drafter's "if there is a clause … otherwise …" scaffolding; the
            // selected option below states the single applicable rule.
            "Mülkiyeti saklı tutma kaydı: {mulkiyetiSakliTutma}. Kaydın bulunmadığı" +
            " hâlde mülkiyet, satılanın teslimiyle alıcıya geçer. Kaydın bulunduğu" +
            " hâlde bedelin tamamı ödeninceye kadar mülkiyet satıcıda kalır; bu kayıt," +
            " TMK m.764 uyarınca resmî şekilde yapılacak sözleşmenin alıcının yerleşim" +
            " yeri noterliğinde özel siciline kaydedilmedikçe hüküm doğurmaz.",
          bilgi: ["mulkiyetiSakliTutma"],
        },
      ],
    },
    {
      id: "ozel-sartlar",
      title: "ÖZEL ŞARTLAR",
      slots: [
        {
          kind: "liste",
          bilgiKey: "ozelSartlar",
          emptyText: "Taraflarca kararlaştırılmış ayrıca bir özel şart yoktur.",
        },
      ],
    },
    {
      id: "hukuk-yetki",
      title: "UYGULANACAK HUKUK VE YETKİLİ MAHKEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşmeden doğan uyuşmazlıklarda Türk hukuku uygulanır; {yetkiliMahkeme}" +
            " mahkemeleri ve icra daireleri yetkilidir. Her iki tarafın tacir olduğu" +
            " uyuşmazlıklarda dava şartı arabuluculuk (TTK m.5/A) uygulanır.",
          bilgi: ["yetkiliMahkeme"],
        },
      ],
    },
    imzaSection("imzalar"),
    dayanakNotlariSection(),
  ],
};

// ---------------------------------------------------------------------------
// 13. Avukatlık (vekâlet) ücret sözleşmesi (Avukatlık K. m.163-164)
// ---------------------------------------------------------------------------

const VEKALET_UCRET_SOZLESMESI: DraftTemplate = {
  id: "vekalet-ucret-sozlesmesi",
  kind: "sozlesme",
  domain: "ozel-hukuk",
  title: "Avukatlık Ücret Sözleşmesi",
  description:
    "Avukat ile iş sahibi arasında avukatlık ücret sözleşmesi taslağı (1136 sayılı" +
    " Avukatlık Kanunu m.163-164): taraflar, üstlenilen iş (m.163 — belli bir işi" +
    " kapsar), ücret ve ödeme (m.164/4 — hiçbir ücret AAÜT'nin altında kararlaştırılamaz;" +
    " m.164/2 — ücret dava veya hükmolunacak şeyin belli bir YÜZDESİ olarak" +
    " kararlaştırılmışsa bu oran %25'i aşamaz; m.163/2 — tavanı aşan sözleşme tavan" +
    " miktarında geçerlidir), masraf ve avans (m.173), karşı tarafa yükletilen vekâlet" +
    " ücretinin avukata ait olması ve iş sahibinin borcu nedeniyle takas/mahsup" +
    " edilememesi (m.164/son), azil ve istifa (m.174 — haksız azilde ücretin tamamı)," +
    " işin takibi (m.171) ve uyuşmazlık.",
  requiredFields: ["taraflar", "ekBilgiler.isKonusu", "ekBilgiler.ucret"],
  fields: [
    contractPartyField("Avukat / İş Sahibi"),
    field("matter.tarih", "Sözleşme tarihi", { kind: "date", group: FIELD_GROUPS.belge }),
    field("matter.ekBilgiler.yer", "İmza yeri", { placeholder: "İstanbul", group: FIELD_GROUPS.belge }),
    ek("isKonusu", "Üstlenilen iş (dava/dosya)", {
      required: true,
      placeholder: "İstanbul 3. Asliye Hukuk Mahkemesi'nde açılacak alacak davası ve icra takibi",
      help: "Av.K. m.163/1: sözleşme belli bir hukukî yardımı ve meblağı yahut değeri kapsar.",
    }),
    ek("ucret", "Ücret", {
      required: true,
      placeholder: "150.000 TL + KDV (dava değerinin %10'u)",
      // W14 (B-25 / W13-COPY L13): %25 is the ceiling of the PROPORTIONAL fee
      // only (m.164/2); a lump-sum fee is not capped by it.
      help:
        "Av.K. m.164/4: hiçbir ücret Avukatlık Asgari Ücret Tarifesi'nin altında" +
        " kararlaştırılamaz. Av.K. m.164/2: ücret, dava veya hükmolunacak şeyin değeri" +
        " yahut paranın BELLİ BİR YÜZDESİ olarak kararlaştırılmışsa bu oran %25'i aşamaz;" +
        " maktu ücret bu sınıra tabi değildir.",
    }),
    ek("odemePlani", "Ödeme planı", {
      placeholder: "%50 sözleşme imzasında, %50 dava dilekçesinin sunulmasında",
    }),
    ek("masrafAvansi", "Masraf avansı", { placeholder: "20.000 TL; harç ve giderler iş sahibine aittir" }),
    ek("kapsamDisi", "Kapsam dışı işler", {
      placeholder: "kanun yolu (istinaf/temyiz) aşamaları ayrı ücrete tabidir",
    }),
    ek("yetkiliMahkeme", "Yetkili mahkeme (şehir)", { placeholder: "İstanbul" }),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "AVUKATLIK ÜCRET SÖZLEŞMESİ" }] },
    {
      id: "taraflar",
      title: "TARAFLAR",
      slots: [
        {
          kind: "hukum",
          text:
            "İşbu Avukatlık Ücret Sözleşmesi ('Sözleşme'), 1136 sayılı Avukatlık Kanunu" +
            " m.163 uyarınca aşağıda bilgileri yer alan avukat ile iş sahibi arasında" +
            " yazılı olarak akdedilmiştir.",
        },
        { kind: "taraflar" },
      ],
    },
    {
      id: "is",
      title: "ÜSTLENİLEN İŞ",
      slots: [
        {
          kind: "hukum",
          text:
            "Avukat, iş sahibi adına şu hukukî yardımı üstlenmiştir: {isKonusu}. Kapsam" +
            " dışı işler: {kapsamDisi}. Avukat, üzerine aldığı işi Avukatlık K. m.171" +
            " uyarınca kanun hükümlerine göre ve yazılı sözleşme şartlarına uygun olarak" +
            " sonuna kadar takip eder; iş sahibi, işin takibi için gerekli belge ve" +
            " bilgileri zamanında sağlar.",
          bilgi: ["isKonusu", "kapsamDisi"],
        },
      ],
    },
    {
      id: "ucret",
      title: "ÜCRET VE ÖDEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Avukatlık ücreti {ucret} olarak kararlaştırılmıştır ve {odemePlani}" +
            " çerçevesinde ödenir. Ücret, Avukatlık K. m.164/4 uyarınca Avukatlık Asgari" +
            " Ücret Tarifesi'nin altında kararlaştırılamaz. Ücret, dava veya hükmolunacak" +
            " şeyin değeri yahut paranın BELLİ BİR YÜZDESİ olarak kararlaştırılmışsa bu" +
            " oran yüzde yirmi beşi aşamaz (m.164/2); bu fıkraya göre yapılan sözleşmeler," +
            " dava konusu para dışındaki mal ve haklardan bir kısmının aynen avukata ait" +
            " olacağı hükmünü taşıyamaz (m.164/3). Ücret tavanını aşan sözleşme, tavan" +
            " miktarında geçerlidir (m.163/2). Ücret alacağı, ücretin muaccel olduğu" +
            " tarihten itibaren yasal faize tabidir.",
          bilgi: ["ucret", "odemePlani"],
        },
        {
          // W14 (B-25 / W13-COPY L14): what the statute forbids is set-off for
          // the CLIENT'S debt; whether the sum is credited against the agreed
          // fee is a contractual choice, not a rule of law.
          kind: "hukum",
          text:
            "Dava sonunda kararla tarifeye dayanılarak karşı tarafa yüklenecek vekâlet" +
            " ücreti Avukatlık K. m.164/son uyarınca avukata aittir ve İŞ SAHİBİNİN BORCU" +
            " NEDENİYLE takas ve mahsup edilemez, haczedilemez. Bu tutarın kararlaştırılan" +
            " ücretten mahsup edilip edilmeyeceğini taraflar burada ayrıca kararlaştırır:" +
            " ☐ mahsup edilmez ☐ mahsup edilir. Avukatın hapis hakkı (m.166) saklıdır.",
        },
      ],
    },
    {
      id: "masraf",
      title: "MASRAF VE AVANS",
      slots: [
        {
          kind: "hukum",
          text:
            "Harç, tebligat, bilirkişi, keşif ve sair yargılama giderleri iş sahibine" +
            " aittir. İş sahibi, Avukatlık K. m.173/2 uyarınca {masrafAvansi} tutarında" +
            " masraf avansını sözleşme imzasında öder; avans yetmediğinde avukatın yazılı" +
            " talebi üzerine tamamlar. Avans süresinde ödenmezse avukat, işi takipten" +
            " kaçınabilir ve bundan doğan sonuçlardan sorumlu olmaz.",
          bilgi: ["masrafAvansi"],
        },
      ],
    },
    {
      id: "azil",
      title: "AZİL VE İSTİFA",
      slots: [
        {
          kind: "hukum",
          text:
            "İş sahibi avukatı her zaman azledebilir; ancak haksız azil hâlinde Avukatlık" +
            " K. m.174/2 uyarınca kararlaştırılan ücretin tamamı muaccel olur. Avukatın" +
            " haklı bir sebep olmaksızın işi takipten vazgeçmesi (istifa) hâlinde ücret" +
            " talep edilemez ve alınan ücret geri verilir (m.174/1). Avukat, istifa" +
            " hâlinde m.41 uyarınca on beş gün süreyle işi takibe devam eder.",
        },
      ],
    },
    {
      id: "hukuk-yetki",
      title: "UYGULANACAK HUKUK VE YETKİLİ MAHKEME",
      slots: [
        {
          kind: "hukum",
          text:
            "Sözleşmeden doğan uyuşmazlıklarda 1136 sayılı Avukatlık Kanunu ve genel" +
            " hükümler uygulanır; {yetkiliMahkeme} mahkemeleri ve icra daireleri" +
            " yetkilidir. Ücret uyuşmazlıklarında dava şartı arabuluculuk kapsamına" +
            " girip girmediği (TTK m.5/A, HUAK m.18/B) avukatça ayrıca değerlendirilir.",
          bilgi: ["yetkiliMahkeme"],
        },
      ],
    },
    imzaSection("imzalar"),
    dayanakNotlariSection(),
  ],
};

/** Registry, id-keyed. Order is the presentation order of /v1/draft-templates. */
// ---------------------------------------------------------------------------
// 14. Hukukî mütalaa (müvekkile yazılı görüş) — W16 şerit E
// ---------------------------------------------------------------------------

/**
 * The written opinion a solo lawyer gives a client — the document a
 * competitor sells as "uzun cevap" and the one a lawyer actually charges
 * for. Four things make it different from every other template here:
 *
 *  1. It has no court and no request. Its SONUÇ VE ÖNERİ section states an
 *     opinion, so the dilekçe lead-in ("Yukarıda arz ve izah olunan
 *     nedenlerle;") and the petition closing are DROPPED — that is what the
 *     slot's `giris: ""` / `kapanis` are for.
 *  2. Its ALEYHE section is `zorunlu`. A mütalaa that shows only the
 *     favourable side is the one document in this product that can cost a
 *     client a case, so the section may not be omitted and may not be left
 *     empty: with no contrary source among the draft's own sources the
 *     composer writes `ALEYHE_KAYNAK_YOK_TEXT` — "bulunamadı" is written,
 *     and it is written as "bulunmaması yok demek değildir".
 *     It reuses the canonical `karsi-ictihat` section id ON PURPOSE: that id
 *     is the one bulut yapay zekâ may never write into
 *     (`AI_LOCKED_SECTION_IDS`), the one `reviseDraft` refuses to drop by
 *     omission, and the one whose paragraphs keep the `karsiIctihat` role
 *     through every later save. A new id would have silently lost all three.
 *  3. Its legal slots are `zorunlu`. A mütalaa whose HUKUKÎ DEĞERLENDİRME
 *     silently disappeared for want of evidence would read as a complete
 *     opinion with nothing in it; here it says KAYNAKSIZ instead.
 *  4. `domain: "genel"` — a client's question can come from any field of
 *     law, so the relevance gate must not park a source for being "the wrong
 *     kind of law" in a document that has no kind.
 */
const HUKUKI_MUTALAA: DraftTemplate = {
  id: "hukuki-mutalaa",
  kind: "dilekce",
  domain: "genel",
  title: "Hukukî Mütalaa (Müvekkile Yazılı Görüş)",
  description:
    "Müvekkile verilecek yazılı hukukî görüş taslağı: sorulan soru, beyana dayalı olay" +
    " özeti, doğrulanmış kaynaklara bağlı hukukî değerlendirme, ZORUNLU aleyhe" +
    " değerlendirme bölümü (aleyhe kaynak yoksa 'bulunamadı; bulunmaması yok demek" +
    " değildir' yazar), sonuç ve öneri ile çekinceler. Mahkemeye verilen bir dilekçe" +
    " değildir; talep içermez, görüş bildirir. Olay özeti müvekkilin/avukatın" +
    " beyanıdır ve hiçbir zaman hukukî değerlendirmenin dayanağı olmaz.",
  requiredFields: ["taraflar", "olaylar", "ekBilgiler.soru", "talepler"],
  fields: [
    field("matter.tarih", "Mütalaa tarihi", {
      kind: "date",
      help: "Boş bırakılırsa bugünün tarihi GG.AA.YYYY olarak yazılır.",
      group: FIELD_GROUPS.belge,
    }),
    field("matter.ekBilgiler.yer", "Düzenleme yeri (imza satırı)", {
      placeholder: "İzmir",
      group: FIELD_GROUPS.belge,
    }),
    partyField(
      "İlgililer (ad ve rol: Mütalaa İsteyen / Karşı Taraf)",
      "Her satır 'Rol : Ad'. Mütalaa mahkemeye verilmez; taraf kaydı görüşün kime ve" +
        " hangi ilişki için verildiğini gösterir.",
    ),
    ...vekilFields(),
    ek("soru", "Sorulan hukukî soru / talep", {
      required: true,
      multiline: true,
      placeholder: "Kira sözleşmesi süresinden önce feshedilirse kalan kira bedelinden sorumlu muyum?",
      help: "Mütalaa bu soruya cevap verir; soru ne kadar dar yazılırsa görüş o kadar kesin olur.",
      group: FIELD_GROUPS.olaylar,
    }),
    olaylarField("Olay özeti (kronolojik; her satır bir olgu)"),
    olayAnlatisiField(),
    kapsamField(),
    taleplerField("Sonuç ve öneriler (her satır bir öneri)"),
  ],
  sections: [
    { id: "baslik", title: "", slots: [{ kind: "baslik", text: "HUKUKÎ MÜTALAA" }] },
    { id: "ilgililer", title: "İLGİLİLER", slots: [{ kind: "taraflar" }] },
    {
      id: "soru",
      title: "SORULAN SORU / TALEP",
      slots: [{ kind: "hukum", text: "{soru}", bilgi: ["soru"] }],
    },
    {
      id: "olay-ozeti",
      title: "OLAY ÖZETİ (BEYAN)",
      slots: [
        {
          kind: "hukum",
          text:
            "Aşağıdaki olaylar tarafımıza aktarıldığı biçimde özetlenmiştir; doğruluğu" +
            " araştırılmamıştır. Olayların değişmesi hâlinde bu mütalaanın sonucu da" +
            " değişebilir.",
        },
        { kind: "olaylar" },
      ],
    },
    {
      id: "hukuki-degerlendirme",
      title: "HUKUKÎ DEĞERLENDİRME",
      slots: [{ kind: "hukukiDegerlendirme", zorunlu: true }],
    },
    {
      id: "hukuki-sebepler",
      title: "DAYANAKLAR",
      slots: [{ kind: "hukukiSebepler", zorunlu: true }],
    },
    {
      id: KARSI_ICTIHAT_SECTION_ID,
      title: KARSI_ICTIHAT_SECTION_TITLE,
      slots: [{ kind: "karsiIctihat", zorunlu: true }],
    },
    {
      id: "sonuc",
      title: "SONUÇ VE ÖNERİ",
      slots: [
        {
          kind: "talepler",
          giris: "Yukarıdaki değerlendirmeye göre görüş ve önerimiz şudur:",
          kapanis: "",
        },
      ],
    },
    {
      id: "cekinceler",
      title: "ÇEKİNCELER",
      slots: [
        {
          kind: "hukum",
          text:
            "Bu mütalaa, yukarıda özetlenen olaylar ve bu belgeye bağlanan kaynaklar" +
            " çerçevesinde hazırlanmıştır. Bir mahkeme kararı değildir ve sonucun ne" +
            " olacağını taahhüt etmez. Kaynak taraması bu belgeye bağlanan kaynaklarla" +
            " sınırlıdır; taranmamış bir kaynağın burada yer almaması, öyle bir kaynağın" +
            " bulunmadığı anlamına gelmez. Yeni belge çıkması, olayların değişmesi ya da" +
            " mevzuatın değişmesi hâlinde görüşün yenilenmesi gerekir.",
        },
      ],
    },
    imzaSection(),
  ],
};

export const DRAFT_TEMPLATES: readonly DraftTemplate[] = [
  DAVA_DILEKCESI,
  CEVAP_DILEKCESI,
  ISTINAF_BASVURU,
  TEMYIZ_DILEKCESI,
  IHTARNAME,
  ICRA_ITIRAZ,
  ARABULUCULUK_BASVURUSU,
  HIZMET_SOZLESMESI,
  KIRA_SOZLESMESI,
  TAHLIYE_TAAHHUTNAMESI,
  IS_SOZLESMESI,
  SATIS_SOZLESMESI,
  VEKALET_UCRET_SOZLESMESI,
  HUKUKI_MUTALAA,
];

export function getTemplate(id: string): DraftTemplate | undefined {
  return DRAFT_TEMPLATES.find((t) => t.id === id);
}

export interface FieldIssue {
  path: string;
  /** Human Turkish label of the field (contract C; additive). */
  label?: string;
  message: string;
}

/** Fallback labels for request paths no template field covers. */
const GENERIC_PATH_LABELS: Readonly<Record<string, string>> = Object.freeze({
  kind: "Belge türü",
  template: "Şablon",
  matter: "Dosya bilgileri",
  "matter.baslik": "Başlık",
  "matter.mahkeme": "Mahkeme / merci",
  "matter.esasNo": "Dosya / esas numarası",
  "matter.davaDegeri": "Dava değeri",
  "matter.arabuluculuk": "Arabuluculuk",
  "matter.vekil": "Vekil",
  "matter.matterId": "Dosya numarası",
  "matter.tarih": "Belge tarihi",
  "matter.taraflar": "Taraflar",
  "matter.olaylar": "Olaylar",
  "matter.talepler": "Talepler",
  "matter.ekBilgiler": "Ek bilgiler",
  instructions: "Talimat",
  evidence: "Kanıt seçimi",
  "evidence.runId": "Araştırma no",
  "evidence.fileIds": "Seçili dosyalar",
  sections: "Bölümler",
  evidenceUse: "Kanıt kullanımı",
  note: "Düzenleme notu",
});

/**
 * Human Turkish label for a request path (contract C). Template fields win;
 * then the generic table, longest matching prefix first (so
 * "matter.taraflar.0.ad" still reads "Taraflar"); the raw path is the last
 * resort — an unlabeled error beats a swallowed one.
 */
export function labelForPath(path: string, templateId?: string): string {
  const template = templateId === undefined ? undefined : getTemplate(templateId);
  const parts = path.split(".");
  for (let end = parts.length; end > 0; end -= 1) {
    const prefix = parts.slice(0, end).join(".");
    const fromTemplate = template?.fields.find((f) => f.path === prefix)?.label;
    if (fromTemplate !== undefined) return fromTemplate;
    const generic = GENERIC_PATH_LABELS[prefix];
    if (generic !== undefined) return generic;
  }
  return path;
}

/** True when the resolved value counts as "provided" for a required field. */
function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

/**
 * Enforce a template's `requiredFields` against a matter object. Dot paths
 * resolve inside `matter`; each missing/empty field yields one issue with the
 * full `matter.`-prefixed path so API callers see exactly what to fix.
 */
export function validateRequiredFields(
  template: DraftTemplate,
  matter: Record<string, unknown>,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const path of template.requiredFields) {
    let value: unknown = matter;
    for (const part of path.split(".")) {
      if (value === null || typeof value !== "object") {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[part];
    }
    if (!present(value)) {
      const fullPath = `matter.${path}`;
      issues.push({
        path: fullPath,
        label: labelForPath(fullPath, template.id),
        message: `'${template.title}' şablonu için bu alan zorunludur — lütfen doldurun.`,
      });
    }
  }
  return issues;
}
