// tools/gen_denylist.mjs
//
// NSC TagPivot — Denylist generator (build-time)
//
// Goal: derive a conservative domain denylist from EasyList/EasyPrivacy-style filter lists.
// We DO NOT ship an adblock engine; we only decide whether to LOG a page.
// Therefore we only extract a small, testable subset of rules:
//   - Network domain anchors:  ||example.com^
//   - Plain hostnames on their own line (rare, but some lists include)
//
// Licensing: EasyList/EasyPrivacy are dual-licensed (GPLv3+ OR CC BY-SA 3.0+).
// If you enable those sources, you must keep attribution/notice in your repo.
//
// Usage:
//   node tools/gen_denylist.mjs
//
// Output:
//   extension/src/core/deny/deny_domains.generated.txt

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { getDomain } from "tldts";

/**
 * Pin these to specific upstream commits/tags/releases for reproducible builds.
 * Keep the list small; avoid pulling dozens of sources.

*/

const SOURCES = [
  {
    name: "blp_porn_noip",
    url: "https://raw.githubusercontent.com/blocklistproject/Lists/b9b24117611a318f80a359caec454604f707dc57/porn.txt"
  },
  {
    name: "blp_gambling_noip",
    url: "https://raw.githubusercontent.com/blocklistproject/Lists/b9b24117611a318f80a359caec454604f707dc57/gambling.txt"
  }
];

const OUT_PATH = path.resolve("extension/src/core/deny/deny_domains.generated.txt");

// Conservative sanity filters
const MAX_DOMAINS = 350_000; // hard cap; adjust if needed

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, {
        headers: {
          "User-Agent": "nsc_tagpivot/denylist-gen",
          "Accept": "text/plain,*/*",
        },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // follow redirect once
          return resolve(fetchText(res.headers.location));
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        res.setEncoding("utf8");
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function isLikelyHostname(s) {
  // Very conservative: letters/digits/hyphen/dot, must contain at least one dot.
  if (!s || s.length > 253) return false;
  if (!s.includes(".")) return false;
  if (!/^[a-z0-9.-]+$/.test(s)) return false;
  if (s.startsWith(".") || s.endsWith(".")) return false;
  if (s.includes("..")) return false;
  return true;
}

function normalizeHost(host) {
  let h = host.trim().toLowerCase();
  if (h.startsWith("www.")) h = h.slice(4);
  // strip trailing dot
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function toBaseDomain(host) {
  // Convert hostnames to registrable base domain (eTLD+1), PSL-aware.
  // Example: a.b.amazon.co.uk -> amazon.co.uk
  // If parsing fails (rare), fall back to the normalized host.
  const d = getDomain(host, { allowPrivateDomains: false });
  return d ? d : host;
}

function extractDomainsFromList(text) {
  const out = new Set();
  const lines = text.split(/\r?\n/);

  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;

    // comments / metadata
    if (line.startsWith("!") || line.startsWith("[") || line.startsWith("#")) continue;

    // ignore exception rules
    if (line.startsWith("@@")) continue;

    // We only take the ABP-style network anchor subset: ||example.com^
    // Examples:
    //   ||example.com^
    //   ||example.co.uk^
    // We purposely ignore options like $script,$third-party etc.
    if (line.startsWith("||")) {
      // stop at ^ or / or $ or end
      const rest = line.slice(2);
      const stop = rest.search(/[\^\/$]/);
      const host = stop === -1 ? rest : rest.slice(0, stop);
      const h = normalizeHost(host);
      if (isLikelyHostname(h)) out.add(toBaseDomain(h));
      continue;
    }

    // Support simple hosts-file format: "0.0.0.0 example.com"
    const parts = line.split(/\s+/);
    if (parts.length === 2 && isLikelyHostname(parts[1])) {
      out.add(toBaseDomain(normalizeHost(parts[1])));
      continue;
    }

    // Some lists might contain a raw hostname line (rare). Accept only if it looks like a hostname.
    // Avoid taking cosmetic selectors or regex.
    if (isLikelyHostname(line)) {
      out.add(toBaseDomain(normalizeHost(line)));
      continue;
    }
  }

  return out;
}

function emitTxt(domains) {
  const sorted = [...domains].sort();
  if (sorted.length > MAX_DOMAINS) {
    throw new Error(
      `Refusing to emit ${sorted.length} domains (cap=${MAX_DOMAINS}). Reduce sources or tighten extraction.`
    );
  }

  return sorted.join("\n") + "\n";
}

async function main() {
  if (!SOURCES.length) {
    console.error("No SOURCES configured. Edit tools/gen_denylist.mjs and add pinned URLs.");
    process.exitCode = 2;
    return;
  }

  for (const src of SOURCES) {
    if (!src || typeof src.url !== "string" || typeof src.name !== "string") {
      console.error("Invalid SOURCES entry. Each source must have { name: string, url: string }.");
      process.exitCode = 2;
      return;
    }
    if (src.url.includes("<PIN>")) {
      console.error(
        `Unpinned URL detected for ${src.name}: ${src.url}\n` +
          "Replace <PIN> with a specific commit hash/tag/release for reproducible builds."
      );
      process.exitCode = 2;
      return;
    }
  }

  const all = new Set();

  for (const src of SOURCES) {
    console.log(`fetch: ${src.name}`);
    const text = await fetchText(src.url);
    const domains = extractDomainsFromList(text);
    console.log(`  + ${domains.size} domains`);
    for (const d of domains) all.add(d);
  }

  const txt = emitTxt(all);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, txt, "utf8");

  console.log(`wrote: ${OUT_PATH} (${all.size} domains)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});