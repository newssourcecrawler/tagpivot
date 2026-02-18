// extension/src/core/metrics/rolling_stats_pol.ts

const KEY = "nsc_tp_pol_series_v1";
const MAX = 60;

export type PolSample = { day: string; pol: number };

export async function loadPolSeries(): Promise<PolSample[]> {
  const got = await chrome.storage.local.get([KEY]);
  return (got[KEY] as PolSample[] | undefined) ?? [];
}

export async function appendPolSample(sample: PolSample): Promise<PolSample[]> {
  const series = await loadPolSeries();

  const filtered = series.filter(s => s.day !== sample.day);
  filtered.push(sample);

  filtered.sort((a, b) => a.day.localeCompare(b.day));
  const trimmed = filtered.slice(Math.max(0, filtered.length - MAX));

  await chrome.storage.local.set({ [KEY]: trimmed });
  return trimmed;
}