// extension/src/core/metrics/polarization.ts

import type { TagEvent } from "../model";

export type PolState = "Flat" | "Split" | "Peaks";

export function polStateFromZ(zAbs: number): PolState {
  if (zAbs < 0.5) return "Flat";
  if (zAbs < 1.5) return "Split";
  return "Peaks";
}

type Graph = {
  df: Map<string, number>;                 // doc freq: events containing tag
  co: Map<string, Map<string, number>>;    // co-occurrence counts
};

function parseDayLocal(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function inRange(day: string, from: string, to: string): boolean {
  const t = parseDayLocal(day);
  return t >= parseDayLocal(from) && t <= parseDayLocal(to);
}

export function eventsInWindow(events: TagEvent[], dayFrom: string, dayTo: string): TagEvent[] {
  return events.filter(e => e.day && inRange(e.day, dayFrom, dayTo));
}

function addCo(graph: Graph, a: string, b: string) {
  if (a === b) return;
  let row = graph.co.get(a);
  if (!row) { row = new Map(); graph.co.set(a, row); }
  row.set(b, (row.get(b) ?? 0) + 1);
}

function getCo(graph: Graph, a: string, b: string): number {
  return graph.co.get(a)?.get(b) ?? 0;
}

function buildGraph(events: TagEvent[]): Graph {
  const df = new Map<string, number>();
  const co = new Map<string, Map<string, number>>();

  for (const e of events) {
    const tags = Array.from(new Set(e.tags || [])).filter(Boolean);
    if (tags.length < 2) {
      // still count df for singletons
      for (const t of tags) df.set(t, (df.get(t) ?? 0) + 1);
      continue;
    }

    for (const t of tags) df.set(t, (df.get(t) ?? 0) + 1);

    // pairwise co-occurrence (unordered, store both directions)
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i], b = tags[j];
        addCo({ df, co }, a, b);
        addCo({ df, co }, b, a);
      }
    }
  }

  return { df, co };
}

function highestDf(df: Map<string, number>): string | null {
  let best: string | null = null;
  let bestV = -1;
  for (const [t, v] of df.entries()) {
    if (v > bestV) { bestV = v; best = t; }
  }
  return best;
}

/**
 * Pick an "opposite" pole:
 * among reasonably frequent tags, choose the one that co-occurs least with center.
 * This is not "negative sentiment" — it's structural separation.
 */
function pickOpposite(graph: Graph, center: string): string | null {
  const centerDf = graph.df.get(center) ?? 0;
  if (centerDf <= 0) return null;

  let best: string | null = null;
  let bestScore = Infinity;

  for (const [t, d] of graph.df.entries()) {
    if (t === center) continue;
    // ignore ultra-rare tags (noise)
    if (d < 2) continue;

    const c = getCo(graph, center, t);
    // separation score: low co, but require some frequency
    // (co / d) is "how tied to center"; smaller is more separate
    const score = (c + 0.25) / (d + 0.25);

    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }

  return best;
}

function growCluster(graph: Graph, seed: string, ban: Set<string>, k: number): string[] {
  const scores: Array<{ t: string; s: number }> = [];

  for (const [t, d] of graph.df.entries()) {
    if (t === seed) continue;
    if (ban.has(t)) continue;
    if (d < 2) continue;

    const co = getCo(graph, seed, t);
    if (co <= 0) continue;

    // co normalized by tag freq (prevents "everything" tags from dominating)
    const s = co / (d + 0.5);
    scores.push({ t, s });
  }

  scores.sort((a, b) => b.s - a.s || a.t.localeCompare(b.t));

  return [seed, ...scores.slice(0, Math.max(0, k - 1)).map(x => x.t)];
}

function sumWithin(graph: Graph, cluster: string[]): number {
  let s = 0;
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      s += getCo(graph, cluster[i], cluster[j]);
    }
  }
  return s;
}

function sumCross(graph: Graph, a: string[], b: string[]): number {
  let s = 0;
  for (const x of a) for (const y of b) s += getCo(graph, x, y);
  return s;
}

export type PolarizationOut = {
  pol: number;                 // 0..1
  activePole: string[];
  counterPole: string[];
  debug?: { within: number; cross: number; events: number; tags: number };
};

export function computePolarization(events: TagEvent[], kPole = 8): PolarizationOut | null {
  if (events.length < 6) return null;

  const graph = buildGraph(events);
  if (graph.df.size < 8) return null;

  const center = highestDf(graph.df);
  if (!center) return null;

  const opposite = pickOpposite(graph, center);
  if (!opposite) return null;

  const banA = new Set<string>([opposite]);
  const banB = new Set<string>([center]);

  const poleA = growCluster(graph, center, banA, kPole);
  const poleB = growCluster(graph, opposite, banB, kPole);

  // Structural polarization scalar:
  // pol = within / (within + cross)
  const within = sumWithin(graph, poleA) + sumWithin(graph, poleB);
  const cross = sumCross(graph, poleA, poleB);

  const denom = within + cross + 1e-6;
  const pol = Math.max(0, Math.min(1, within / denom));

  return {
    pol,
    activePole: poleA,
    counterPole: poleB,
    debug: { within, cross, events: events.length, tags: graph.df.size }
  };
}