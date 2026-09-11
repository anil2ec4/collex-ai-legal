/**
 * SSRF fetch-policy edge cases. Every rejection asserts a SPECIFIC reason
 * code, so a future refactor that starts rejecting for the wrong reason (or
 * accidentally widens a class) is caught.
 *
 * Checks run in a fixed order — scheme, userinfo, port, then host — which is
 * why `http://127.0.0.1:6379/` reports NON_HTTPS_SCHEME rather than a host
 * reason. Each host-class case therefore also appears in its https form.
 */

import { describe, expect, it } from "vitest";

import {
  ALLOWED_SOURCE_HOSTS,
  KNOWN_SOURCE_FAMILIES,
  UrlPolicyError,
  assertSafeFetchUrl,
  checkFetchUrl,
  isAllowedSourceHost,
  resolveSourceUrl,
  type UrlRejectionReason,
} from "../../src/security/urlPolicy.js";

type Case = readonly [url: string, reason: UrlRejectionReason];

const REJECT_CASES: readonly (readonly [group: string, cases: readonly Case[]])[] = [
  [
    "non-https schemes",
    [
      ["http://mevzuat.gov.tr/x", "NON_HTTPS_SCHEME"],
      ["http://127.0.0.1:6379/", "NON_HTTPS_SCHEME"],
      ["file:///etc/passwd", "NON_HTTPS_SCHEME"],
      ["ftp://mevzuat.gov.tr/x", "NON_HTTPS_SCHEME"],
      ["gopher://mevzuat.gov.tr:70/x", "NON_HTTPS_SCHEME"],
      ["data:text/html,<script>alert(1)</script>", "NON_HTTPS_SCHEME"],
      ["javascript:alert(1)", "NON_HTTPS_SCHEME"],
      ["vbscript:msgbox(1)", "NON_HTTPS_SCHEME"],
    ],
  ],
  [
    "unparseable / malformed",
    [
      ["", "UNPARSEABLE_URL"],
      ["not a url", "UNPARSEABLE_URL"],
      ["//attacker.example/x", "UNPARSEABLE_URL"],
      ["/relative/path", "UNPARSEABLE_URL"],
      ["https://999.1.1.1/", "UNPARSEABLE_URL"],
      ["https://mevzuat.gov.tr/\tx", "UNPARSEABLE_URL"],
      ["https://mevzuat.gov.tr/\nx", "UNPARSEABLE_URL"],
      ["https://mevzuat.gov.tr/\rx", "UNPARSEABLE_URL"],
      ["https://mevzuat.gov.tr/ x", "UNPARSEABLE_URL"],
      ["https://mevzuat.gov.tr/\u0000x", "UNPARSEABLE_URL"],
    ],
  ],
  [
    "userinfo tricks",
    [
      ["https://mevzuat.gov.tr@attacker.example/", "HAS_USERINFO"],
      ["https://user:pass@attacker.example/", "HAS_USERINFO"],
      // Even an allowlisted final host is refused when credentials are present.
      ["https://user:pass@mevzuat.gov.tr/", "HAS_USERINFO"],
      ["https://mevzuat.gov.tr%40attacker.example@attacker.example/", "HAS_USERINFO"],
    ],
  ],
  [
    "non-default ports",
    [
      ["https://mevzuat.gov.tr:8443/x", "NON_DEFAULT_PORT"],
      ["https://mevzuat.gov.tr:80/x", "NON_DEFAULT_PORT"],
      ["https://[::1]:5432/", "NON_DEFAULT_PORT"],
    ],
  ],
  [
    "IPv4 literals — dotted, decimal, octal, hex, short form",
    [
      ["https://127.0.0.1/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://127.255.255.254/", "LOOPBACK_OR_LOCAL_HOST"],
      // 2130706433 == 0x7f000001 == 0177.0.0.1 == 127.1 == 127.0.0.1. The
      // WHATWG parser normalizes all of them before we classify.
      ["https://2130706433/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://0x7f000001/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://0177.0.0.1/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://127.1/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://0/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://0.0.0.0/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://1.2.3.4/", "IP_LITERAL_HOST"],
      ["https://8.8.8.8/", "IP_LITERAL_HOST"],
      // Hex/octal forms of a private address land on the private reason.
      ["https://0xc0.0xa8.0x00.0x01/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://192.168.000.001/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://3232235777/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
    ],
  ],
  [
    "IPv6 literals",
    [
      ["https://[::1]/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://[0:0:0:0:0:0:0:1]/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://[::]/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://[fe80::1]/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://[fd00::1]/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://[fc00::1]/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://[2001:4860:4860::8888]/", "IP_LITERAL_HOST"],
      // IPv4-mapped loopback: still an IP literal, still refused.
      ["https://[::ffff:127.0.0.1]/", "IP_LITERAL_HOST"],
    ],
  ],
  [
    "RFC1918, CGNAT and link-local",
    [
      ["https://10.0.0.5/internal", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://172.16.0.1/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://172.31.255.255/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://192.168.1.1/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://100.64.0.1/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
      ["https://169.254.1.1/", "PRIVATE_OR_LINK_LOCAL_ADDRESS"],
    ],
  ],
  [
    "cloud metadata endpoints",
    [
      ["https://169.254.169.254/latest/meta-data/", "METADATA_ENDPOINT"],
      ["https://169.254.169.254/latest/meta-data/iam/", "METADATA_ENDPOINT"],
      ["https://metadata.google.internal/computeMetadata/v1/", "METADATA_ENDPOINT"],
      ["https://metadata.goog/", "METADATA_ENDPOINT"],
      ["https://metadata/", "METADATA_ENDPOINT"],
    ],
  ],
  [
    "localhost and local-only suffixes",
    [
      ["https://localhost/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://LOCALHOST/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://api.localhost/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://redis.internal/", "LOOPBACK_OR_LOCAL_HOST"],
      ["https://printer.local/", "LOOPBACK_OR_LOCAL_HOST"],
    ],
  ],
  [
    "DNS-rebinding-shaped names (never resolved, always refused)",
    [
      ["https://127.0.0.1.nip.io/", "IP_LITERAL_HOST"],
      ["https://10.0.0.1.xip.io/", "IP_LITERAL_HOST"],
      ["https://169.254.169.254.nip.io/", "IP_LITERAL_HOST"],
      ["https://a.127.0.0.1.sslip.io/", "IP_LITERAL_HOST"],
    ],
  ],
  [
    "non-ASCII / punycode / homograph hosts",
    [
      ["https://türkiye.gov.tr/", "NON_ASCII_OR_PUNYCODE_HOST"],
      ["https://xn--trkiye-3ya.gov.tr/", "NON_ASCII_OR_PUNYCODE_HOST"],
      // Cyrillic 'а' in place of ASCII 'a' — a homograph of an allowlisted host.
      ["https://аnayasa.gov.tr/", "NON_ASCII_OR_PUNYCODE_HOST"],
      ["https://mevzuаt.gov.tr/", "NON_ASCII_OR_PUNYCODE_HOST"],
    ],
  ],
  [
    "hosts outside the exact-match allowlist",
    [
      ["https://attacker.example/", "HOST_NOT_IN_ALLOWLIST"],
      // Suffix tricks: the allowlist is exact-match, never suffix-match.
      ["https://mevzuat.gov.tr.attacker.example/", "HOST_NOT_IN_ALLOWLIST"],
      ["https://evil-mevzuat.gov.tr/", "HOST_NOT_IN_ALLOWLIST"],
      ["https://sub.mevzuat.gov.tr/", "HOST_NOT_IN_ALLOWLIST"],
      ["https://gov.tr/", "HOST_NOT_IN_ALLOWLIST"],
      // Trailing-dot FQDN form: an empty label, not an encoding problem.
      ["https://mevzuat.gov.tr./", "HOST_NOT_IN_ALLOWLIST"],
    ],
  ],
];

describe("checkFetchUrl rejections", () => {
  for (const [group, cases] of REJECT_CASES) {
    describe(group, () => {
      for (const [url, reason] of cases) {
        it(`rejects ${JSON.stringify(url)} as ${reason}`, () => {
          const result = checkFetchUrl(url);
          expect(result.ok, `${url} was accepted`).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe(reason);
          }
        });
      }
    });
  }
});

describe("checkFetchUrl acceptances", () => {
  const accepted = [
    "https://mevzuat.gov.tr/mevzuat?MevzuatNo=6098",
    "https://www.mevzuat.gov.tr/x",
    "https://mevzuat.gov.tr:443/x",
    "HTTPS://MEVZUAT.GOV.TR/x",
    "https://karararama.yargitay.gov.tr/getDokuman?id=1",
  ];
  for (const url of accepted) {
    it(`accepts ${url}`, () => {
      const result = checkFetchUrl(url);
      expect(result.ok, `${url} rejected: ${result.ok ? "" : result.reason}`).toBe(true);
    });
  }

  it("accepts every allowlisted host at its bare root", () => {
    for (const host of ALLOWED_SOURCE_HOSTS) {
      const result = checkFetchUrl(`https://${host}/`);
      expect(result.ok, `${host} rejected: ${result.ok ? "" : result.reason}`).toBe(true);
    }
  });
});

describe("assertSafeFetchUrl", () => {
  it("throws UrlPolicyError carrying the reason code", () => {
    expect(() => assertSafeFetchUrl("https://169.254.169.254/")).toThrowError(UrlPolicyError);
    try {
      assertSafeFetchUrl("https://169.254.169.254/");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UrlPolicyError);
      expect((error as UrlPolicyError).reason).toBe("METADATA_ENDPOINT");
      expect((error as UrlPolicyError).name).toBe("UrlPolicyError");
    }
  });

  it("returns the parsed URL when the target is allowed", () => {
    expect(assertSafeFetchUrl("https://mevzuat.gov.tr/x").hostname).toBe("mevzuat.gov.tr");
  });

  it("bounds the echoed input in an UNPARSEABLE_URL detail", () => {
    const huge = `zz:${"a".repeat(4000)}`;
    const result = checkFetchUrl(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // `zz:` parses, so this lands on scheme; the truncation path is the
      // genuinely unparseable one.
      expect(result.reason).toBe("NON_HTTPS_SCHEME");
    }
    const unparseable = checkFetchUrl(`ht!tp//${"b".repeat(4000)}`);
    expect(unparseable.ok).toBe(false);
    if (!unparseable.ok) {
      expect(unparseable.reason).toBe("UNPARSEABLE_URL");
      expect(unparseable.detail.length).toBeLessThanOrEqual(128);
    }
  });
});

describe("isAllowedSourceHost", () => {
  it("is exact and case-insensitive, never suffix-based", () => {
    expect(isAllowedSourceHost("mevzuat.gov.tr")).toBe(true);
    expect(isAllowedSourceHost("MEVZUAT.GOV.TR")).toBe(true);
    expect(isAllowedSourceHost("a.mevzuat.gov.tr")).toBe(false);
    expect(isAllowedSourceHost("mevzuat.gov.tr.evil.example")).toBe(false);
    expect(isAllowedSourceHost("")).toBe(false);
  });

  it("exposes a frozen allowlist", () => {
    expect(Object.isFrozen(ALLOWED_SOURCE_HOSTS)).toBe(true);
  });
});

describe("resolveSourceUrl — the only constructor of outbound URLs", () => {
  it("expands a server-side template for every known family onto an allowed host", () => {
    expect(KNOWN_SOURCE_FAMILIES.length).toBeGreaterThan(10);
    for (const family of KNOWN_SOURCE_FAMILIES) {
      const url = resolveSourceUrl(family, "abc-123");
      const parsed = assertSafeFetchUrl(url);
      expect(isAllowedSourceHost(parsed.hostname)).toBe(true);
    }
  });

  it("normalizes the family name", () => {
    expect(resolveSourceUrl("  YARGITAY ", "1")).toBe(
      "https://karararama.yargitay.gov.tr/getDokuman?id=1",
    );
  });

  it("refuses an unknown family instead of guessing", () => {
    expect(() => resolveSourceUrl("attacker", "1")).toThrowError(/UNKNOWN_SOURCE_FAMILY/);
  });

  it("refuses external ids that could escape the template", () => {
    const hostile = [
      "../../etc/passwd",
      "..",
      ".",
      "a/../../b",
      "a b",
      "a?b=c",
      "a#frag",
      "a&b=c",
      "https://attacker.example/",
      "",
      "a".repeat(513),
      " ",
      "-leading-dash-is-fine-but-this-is-not:",
    ];
    for (const id of hostile) {
      expect(() => resolveSourceUrl("yargitay", id), `accepted ${JSON.stringify(id)}`).toThrowError(
        UrlPolicyError,
      );
    }
  });

  it("accepts ordinary provider ids including slash-separated segments", () => {
    expect(resolveSourceUrl("anayasa_norm", "2023/107")).toBe(
      "https://normkararlarbilgibankasi.anayasa.gov.tr/ND/2023/107",
    );
    expect(resolveSourceUrl("mevzuat", "6098")).toBe(
      "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098",
    );
  });

  it("never returns a URL that its own fetch policy would reject", () => {
    for (const family of KNOWN_SOURCE_FAMILIES) {
      expect(checkFetchUrl(resolveSourceUrl(family, "x1")).ok).toBe(true);
    }
  });
});
