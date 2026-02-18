import { normalizeTokens, tokenize, topN } from "./normalize";

function meta(name: string): string {
  const el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  return el?.content?.trim() ?? "";
}

function prop(property: string): string {
  const el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  return el?.content?.trim() ?? "";
}

function headingsText(): string {
  const els = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3"));
  const parts = els
    .slice(0, 12)
    .map(e => (e.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    // Bound per-heading contribution (avoid huge sticky headers / TOCs)
    .map(s => s.slice(0, 140));

  // Deterministic de-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.join(" ");
}

function visibleTextSkim(maxChars = 1400, maxNodes = 600): string {
  // Bounded skim: walk a limited number of text nodes, ignore obvious chrome.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let s = "";
  let node: Node | null;
  let seen = 0;

  while ((node = walker.nextNode())) {
    if (++seen > maxNodes) break;

    const parent = (node as Text).parentElement;
    if (!parent) continue;

    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;

    // Skip common non-content containers.
    const cls = (parent.className || "").toString().toLowerCase();
    const id = (parent.id || "").toString().toLowerCase();
    const role = (parent.getAttribute("role") || "").toString().toLowerCase();

    if (role.includes("navigation")) continue;
    if (cls.includes("nav") || cls.includes("footer") || cls.includes("header")) continue;
    if (id.includes("nav") || id.includes("footer") || id.includes("header")) continue;

    const text = (node as Text).data.replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Avoid ultra-short noise fragments.
    if (text.length < 3) continue;

    s += text + " ";
    if (s.length >= maxChars) break;
  }

  return s.slice(0, maxChars);
}

export function extractTagsGeneric(maxTags = 18): string[] {
  const title = (document.title || "").trim();

  const ogTitle = prop("og:title");
  const ogDesc = prop("og:description");

  const desc = meta("description");
  const kwRaw = meta("keywords");
  const kw = kwRaw.length > 0 && kwRaw.length <= 280 ? kwRaw : "";

  const heads = headingsText();

  // combine sources (ordered). Start with structured sources.
  const baseRaw = [ogTitle, title, heads, kw, ogDesc, desc]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2048);

  let toks = tokenize(baseRaw);
  let norm = normalizeTokens(toks);

  // If structured sources are too sparse, add a bounded skim of visible text.
  // Deterministic: fixed caps; no randomness.
  if (norm.length < Math.max(24, maxTags * 3)) {
    const skim = visibleTextSkim();
    const raw = (baseRaw + " " + skim).slice(0, 4096);
    toks = tokenize(raw);
    norm = normalizeTokens(toks);
  }

  return topN(norm, maxTags);
}