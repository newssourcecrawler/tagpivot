// extension/src/core/metrics/temperature.ts

import type { WindowAgg } from "./window";

export function tvDistance(now: WindowAgg, prev: WindowAgg): number {
  const a = now.tagProb;
  const b = prev.tagProb;

  const keys = new Set<string>();
  for (const k of Object.keys(a)) keys.add(k);
  for (const k of Object.keys(b)) keys.add(k);

  let sum = 0;
  for (const k of keys) {
    const pa = a[k] ?? 0;
    const pb = b[k] ?? 0;
    sum += Math.abs(pa - pb);
  }
  const tv = 0.5 * sum;

  // numeric safety
  if (!Number.isFinite(tv)) return 0;
  return Math.max(0, Math.min(1, tv));
}

export type TempState = "Settled" | "Active" | "Changing" | "Calibrating";

export function tempStateFromZ(zAbs: number): TempState {
  if (zAbs < 0.5) return "Settled";
  if (zAbs < 1.0) return "Active";
  if (zAbs < 2.0) return "Changing";
  return "Calibrating";
}