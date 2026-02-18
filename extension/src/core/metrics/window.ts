// extension/src/core/metrics/window.ts

import type { DailyAgg } from "../model";

export type WindowAgg = {
  tagProb: Record<string, number>; // normalized probabilities
  totalCount: number;              // total tag count in window
  uniqueTags: number;              // unique tags in window
  dayFrom: string;
  dayTo: string;
};

function parseDayLocal(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function fmtDayLocal(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayLocalYYYYMMDD(): string {
  return fmtDayLocal(Date.now());
}

export function shiftEndDay(endDay: string, daysBack: number): string {
  const endMs = parseDayLocal(endDay);
  const shifted = endMs - daysBack * 24 * 60 * 60 * 1000;
  return fmtDayLocal(shifted);
}

export function buildWindowAgg(opts: {
  daily: Record<string, DailyAgg>;
  endDay: string;     // inclusive end day (YYYY-MM-DD)
  windowDays: number; // e.g. 8
}): WindowAgg {
  const { daily, endDay, windowDays } = opts;

  const endMs = parseDayLocal(endDay);
  const startMs = endMs - (windowDays - 1) * 24 * 60 * 60 * 1000;

  const freq: Record<string, number> = {};
  let total = 0;

  for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
    const day = fmtDayLocal(t);
    const agg = daily[day];
    if (!agg) continue;

    for (const [tag, c] of Object.entries(agg.tagFreq || {})) {
      freq[tag] = (freq[tag] ?? 0) + c;
      total += c;
    }
  }

  const prob: Record<string, number> = {};
  if (total > 0) {
    for (const [tag, c] of Object.entries(freq)) {
      prob[tag] = c / total;
    }
  }

  return {
    tagProb: prob,
    totalCount: total,
    uniqueTags: Object.keys(freq).length,
    dayFrom: fmtDayLocal(startMs),
    dayTo: fmtDayLocal(endMs)
  };
}

export function chooseWindowDays(opts: {
  daily: Record<string, DailyAgg>;
  endDay: string;
  candidates?: number[];  // default [8,13,21,30,60]
  minTotal?: number;      // default 20
  minUnique?: number;     // default 15
}): { windowDays: number; now: WindowAgg; prev: WindowAgg } | null {
  const candidates = opts.candidates ?? [8, 13, 21, 30, 60];
  const minTotal = opts.minTotal ?? 20;
  const minUnique = opts.minUnique ?? 15;

  for (const w of candidates) {
    const now = buildWindowAgg({ daily: opts.daily, endDay: opts.endDay, windowDays: w });
    const prevEnd = shiftEndDay(opts.endDay, w);
    const prev = buildWindowAgg({ daily: opts.daily, endDay: prevEnd, windowDays: w });

    const okNow = now.totalCount >= minTotal && now.uniqueTags >= minUnique;
    const okPrev = prev.totalCount >= minTotal && prev.uniqueTags >= minUnique;

    if (okNow && okPrev) return { windowDays: w, now, prev };
  }

  return null;
}