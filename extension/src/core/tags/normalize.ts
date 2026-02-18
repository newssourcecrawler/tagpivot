// extension/src/core/tags/normalize.ts

import { STOPWORDS } from "./stoplist";

export function tokenize(s: string): string[] {
  // Use Unicode-aware splitting so tags work on non-English pages too.
  // Deterministic: no locale-specific casing.
  const raw = (s || "").toLowerCase();

  // Split on any run of non letters/numbers.
  // Requires ES2018+ (Unicode property escapes).
  return raw
    .split(/[^\p{L}\p{N}]+/gu)
    .filter(Boolean);
}

export function normalizeTokens(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const t of tokens) {
    // Script-aware minimum length:
    // Latin tokens must be >= 3 chars; non-Latin (CJK, Arabic, etc.) can be >= 2.
    const isLatin = /\p{Script=Latin}/u.test(t);
    if (isLatin) {
      if (t.length < 3) continue;
    } else {
      if (t.length < 2) continue;
    }
    if (t.length > 28) continue;
    // Drop tokens that are only numbers (Unicode-aware).
    if (/^\p{N}+$/u.test(t)) continue;
    if (STOPWORDS.has(t)) continue;

    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function topN(tokens: string[], n: number): string[] {
  // simple frequency
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([t]) => t);
}