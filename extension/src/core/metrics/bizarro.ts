// extension/src/core/metrics/bizarro.ts

import type { TagEvent } from "../model";
import type { BridgeResult } from "./bridges";

export type BizarroResult = {
  tag: string;
  score: number;
  coBridge: number;   // co-occurrence with bridge-set
  df: number;         // doc freq in window
};

function parseDayLocal(day: string): number {
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
 * Counterpoint (UI label):
 *
 * Internal name remains "Bizarro" for code stability.
 *
 * Mechanic:
 * - choose bridge tags (top M)
 * - look at events that contain any bridge tag BUT contain none of the seed tags
 * - count candidate tags in those events
 * - score by: (coBridge / bridgeHits) * log1p(total / df)
 *
 * Interpretation (Free tier):
 * Structured contrast near the bridge layer within the active window.
 */
export function computeBizarro(opts: {
  events: TagEvent[];
  seedTags: string[];
  bridges: BridgeResult[]; // from computeBridges
  days: number;            // e.g. 60
  topK: number;            // e.g. 10
  bridgeTopM?: number;     // e.g. 6
  minCo?: number;          // e.g. 2
}): BizarroResult[] {
  const { events, seedTags, bridges, days, topK } = opts;
  const bridgeTopM = opts.bridgeTopM ?? 6;
  const minCo = opts.minCo ?? 2;

  const nowMs = Date.now();
  const seed = new Set(normalizeTags(seedTags));
  if (seed.size === 0) return [];

  const bridgeSet = new Set(normalizeTags(bridges.slice(0, bridgeTopM).map(b => b.tag)));
  // Bridges must be complementary to seeds.
  for (const s of seed) bridgeSet.delete(s);

  if (bridgeSet.size === 0) return [];

  const recent = events.filter(e => {
    const dayRaw = (e as any).day;
    const tsMs = (e as any).tsMs;

    const day = (typeof dayRaw === "string" && dayRaw.length > 0 && isValidDayKey(dayRaw))
      ? dayRaw
      : (Number.isFinite(tsMs) ? dayKeyFromTsMsLocal(tsMs) : "");

    return day.length > 0 && withinLastDays(day, days, nowMs);
  });
  const total = recent.length;
  if (total === 0) return [];

  // df across all recent (candidate-only)
  const df = new Map<string, number>();
  for (const e of recent) {
    const tags = new Set(normalizeTags((e as any).tags));
    for (const t of tags) {
      if (seed.has(t)) continue;
      if (bridgeSet.has(t)) continue;
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  // events that hit bridge-set but avoid seed-set
  let bridgeHits = 0;
  const coBridge = new Map<string, number>();

  for (const e of recent) {
    const tags = new Set(normalizeTags((e as any).tags));
    if (tags.size === 0) continue;

    // seed overlap?
    let hitSeed = false;
    for (const s of seed) {
      if (tags.has(s)) { hitSeed = true; break; }
    }
    if (hitSeed) continue;

    // bridge overlap?
    let hitBridge = false;
    for (const b of bridgeSet) {
      if (tags.has(b)) { hitBridge = true; break; }
    }
    if (!hitBridge) continue;

    bridgeHits += 1;

    // candidates: exclude seed + exclude bridge tags themselves
    for (const t of tags) {
      if (seed.has(t)) continue;
      if (bridgeSet.has(t)) continue;
      coBridge.set(t, (coBridge.get(t) ?? 0) + 1);
    }
  }

  if (bridgeHits === 0) return [];

  const out: BizarroResult[] = [];
  for (const [tag, c] of coBridge.entries()) {
    if (c < minCo) continue;
    const d = df.get(tag) ?? 1;

    const relevance = c / bridgeHits;
    const rarityBoost = Math.log1p(total / d);
    const score = relevance * rarityBoost;

    out.push({ tag, score, coBridge: c, df: d });
  }

  out.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  return out.slice(0, topK);
}