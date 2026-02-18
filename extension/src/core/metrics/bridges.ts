// extension/src/core/metrics/bridges.ts

import type { TagEvent } from "../model";

export type BridgeResult = { tag: string; score: number; co: number; df: number };

function parseDayLocal(day: string): number {
  // day = YYYY-MM-DD -> local midnight
  const parts = String(day).split("-").map(Number);
  if (parts.length !== 3) return NaN;
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return new Date(y, (m - 1), d, 0, 0, 0, 0).getTime();
}

function isValidDayKey(day: string): boolean {
  const ms = parseDayLocal(day);
  return Number.isFinite(ms);
}

function withinLastDays(day: string, days: number, nowMs: number): boolean {
  const ms = parseDayLocal(day);
  if (!Number.isFinite(ms)) return false;
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  // Exclude future days (bad clocks / malformed data) to keep metrics stable.
  return ms >= cutoff && ms <= nowMs;
}

function dayKeyFromTsMsLocal(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function normalizeTags(tags: unknown): string[] {
  // Defensive: metrics must never crash and must stay deterministic.
  const arr = Array.isArray(tags) ? tags : [];
  const cleaned = arr
    .map(t => String(t).trim())
    .filter(t => t.length > 0)
    // Keep identity stable across sources (SEO/title vs hand-entered tags).
    .map(t => t.normalize("NFKC").toLowerCase());

  // Deterministic de-dupe + ordering.
  return Array.from(new Set(cleaned)).sort();
}

/**
 * Bridges: tags that co-occur with any seed tag in recent history,
 * scored by a simple "lift-ish" ratio:
 *
 * score = (co / seed_hits) * log1p(total / df)
 *
 * where:
 * - co = number of events containing both (seed-any) and candidate
 * - seed_hits = number of events containing any seed tag
 * - df = number of events containing candidate
 */
export function computeBridges(opts: {
  events: TagEvent[];
  seedTags: string[];
  days: number;     // e.g. 60
  topK: number;     // e.g. 10
  minCo?: number;   // e.g. 2
}): BridgeResult[] {
  const { events, seedTags, days, topK } = opts;
  const minCo = opts.minCo ?? 2;

  const nowMs = Date.now();
  const seed = new Set(normalizeTags(seedTags));

  // Filter events to last N days
  const recent = events.filter(e => {
    const dayRaw = (e as any).day;
    const tsMs = (e as any).tsMs;

    const day = (typeof dayRaw === "string" && dayRaw.length > 0 && isValidDayKey(dayRaw))
      ? dayRaw
      : (Number.isFinite(tsMs) ? dayKeyFromTsMsLocal(tsMs) : "");

    return day.length > 0 && withinLastDays(day, days, nowMs);
  });
  const total = recent.length;
  if (total === 0 || seed.size === 0) return [];

  const df = new Map<string, number>();     // candidate doc freq
  const co = new Map<string, number>();     // co-occur with seed-any
  let seedHits = 0;

  for (const e of recent) {
    const tags = new Set(normalizeTags((e as any).tags));
    if (tags.size === 0) continue;

    let hitSeed = false;
    for (const s of seed) {
      if (tags.has(s)) { hitSeed = true; break; }
    }
    if (hitSeed) seedHits += 1;

    // update df (candidates only)
    for (const t of tags) {
      if (seed.has(t)) continue;
      df.set(t, (df.get(t) ?? 0) + 1);
    }

    if (!hitSeed) continue;

    // update co for all tags in this event (except seed tags themselves)
    for (const t of tags) {
      if (seed.has(t)) continue;
      co.set(t, (co.get(t) ?? 0) + 1);
    }
  }

  if (seedHits === 0) return [];

  const out: BridgeResult[] = [];
  for (const [tag, c] of co.entries()) {
    if (c < minCo) continue;
    const d = df.get(tag) ?? 1;

    const relevance = c / seedHits;                 // how often with seeds
    const rarityBoost = Math.log1p(total / d);      // prefer not-too-common tags
    const score = relevance * rarityBoost;

    out.push({ tag, score, co: c, df: d });
  }

  out.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  return out.slice(0, topK);
}