// extension/src/core/disqualify.ts

let _denySetP: Promise<Set<string>> | null = null;

async function loadDenySet(): Promise<Set<string>> {
  if (_denySetP) return _denySetP;
  _denySetP = (async () => {
    // Packaged extension asset (no external network)
    const assetUrl = chrome.runtime.getURL("core/deny/deny_domains.generated.txt");
    const txt = await fetch(assetUrl).then((r) => r.text());
    const set = new Set<string>();
    for (const line of txt.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      set.add(s);
    }
    return set;
  })();
  return _denySetP;
}

export type DisqReason =
  | "deny_domain";

const DENY_DOMAIN_SUFFIX = [
  ".porn",
  ".sex",
  ".adult",
];

// conservative: obvious adult/gambling markers
const DENY_DOMAIN_SUBSTRINGS = [
  "porn",
  "xxx",
  "casino",
  "betting",
];

// Page-level signals (lightweight)

export async function isDisqualifiedUrl(url: string): Promise<{ ok: false; reason: DisqReason } | { ok: true }> {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const hostNoWww = host.startsWith("www.") ? host.slice(4) : host;

    const DENY_DOMAINS = await loadDenySet();

    // 1) Generated denylist (exact + subdomain)
    // Exact
    if (DENY_DOMAINS.has(hostNoWww)) return { ok: false, reason: "deny_domain" };

    // Subdomain: www/m/ww3/foo.example.com matches example.com
    // Walk suffixes: a.b.c -> b.c -> c
    const parts = hostNoWww.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      const suf = parts.slice(i).join(".");
      if (DENY_DOMAINS.has(suf)) return { ok: false, reason: "deny_domain" };
    }

    // 2) TLD suffix deny
    for (const suf of DENY_DOMAIN_SUFFIX) {
      if (hostNoWww.endsWith(suf)) return { ok: false, reason: "deny_domain" };
    }

    // 3) Conservative substring deny (registrable-ish host only)
    for (const sub of DENY_DOMAIN_SUBSTRINGS) {
      if (hostNoWww.includes(sub)) return { ok: false, reason: "deny_domain" };
    }

    return { ok: true };
  } catch {
    // avoid false positives if parsing fails
    return { ok: true };
  }
}

export function isDisqualifiedDocument(_doc: Document): { ok: false; reason: DisqReason } | { ok: true } {
  // Hostname-only policy: do not disqualify based on page content/meta.
  return { ok: true };
}