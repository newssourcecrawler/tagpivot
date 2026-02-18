// extension/src/core/metrics/rolling_stats.ts

const KEY = "nsc_tp_temp_series_v1";
const MAX = 60;

export type TempSample = { day: string; temp: number };

export async function loadTempSeries(): Promise<TempSample[]> {
  const got = await chrome.storage.local.get([KEY]);
  return (got[KEY] as TempSample[] | undefined) ?? [];
}

export async function appendTempSample(sample: TempSample): Promise<TempSample[]> {
  const series = await loadTempSeries();

  // Dedup by day (keep last for that day)
  const filtered = series.filter(s => s.day !== sample.day);
  filtered.push(sample);

  // Keep last MAX by day order
  filtered.sort((a, b) => a.day.localeCompare(b.day));
  const trimmed = filtered.slice(Math.max(0, filtered.length - MAX));

  await chrome.storage.local.set({ [KEY]: trimmed });
  return trimmed;
}

export function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };

  const mean = values.reduce((s, x) => s + x, 0) / values.length;

  let v = 0;
  for (const x of values) v += (x - mean) * (x - mean);
  v /= values.length;

  const std = Math.sqrt(v);
  return { mean, std: std > 1e-6 ? std : 1 };
}

export function zScore(x: number, mean: number, std: number): number {
  return (x - mean) / (std || 1);
}

export function sparkline(values: number[]): string {
  const chars = ["▁","▂","▃","▄","▅","▆","▇","█"];
  if (values.length === 0) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  if (span < 1e-9) {
    // all same -> flat line
    return "▁".repeat(values.length);
  }

  return values.map(v => {
    const t = (v - min) / span;           // 0..1
    const idx = Math.max(0, Math.min(7, Math.round(t * 7)));
    return chars[idx];
  }).join("");
}