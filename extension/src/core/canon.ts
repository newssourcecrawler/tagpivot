// extension/src/core/canon.ts

// Conservative canonicalization: remove obvious tracking noise,
// keep meaningful query params by default (safe for v1).
const DROP_QUERY_PREFIXES = [
  "utm_",
];

const DROP_QUERY_KEYS = new Set([
  "gclid", "fbclid", "msclkid",
  "ref", "ref_src",
  "igshid",
  "mc_cid", "mc_eid",
  "mkt_tok",
  "trk", "trkCampaign",
  "spm", "scm",
]);

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);

    // Normalize scheme + host
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();

    // Remove hash fragment (almost always client-only)
    u.hash = "";

    // Normalize path (avoid trailing slash noise)
    if (u.pathname !== "/") {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }

    // Filter query params
    const kept = new URLSearchParams();
    for (const [k, v] of u.searchParams.entries()) {
      const key = k.toLowerCase();
      if (DROP_QUERY_KEYS.has(key)) continue;
      if (DROP_QUERY_PREFIXES.some(p => key.startsWith(p))) continue;
      if (!v) continue;
      kept.append(key, v);
    }
    // Sort query params for stability
    const sorted = new URLSearchParams();
    [...kept.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => sorted.append(k, v));
    u.search = sorted.toString() ? `?${sorted.toString()}` : "";

    return u.toString();
  } catch {
    // If URL parsing fails, fallback to raw
    return raw;
  }
}

export function canonicalDomain(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase();
  } catch {
    return location.hostname.toLowerCase();
  }
}