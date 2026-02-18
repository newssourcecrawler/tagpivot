// extension/src/core/storage.ts

import { DailyAgg, STORAGE_KEYS, StoreMeta, TagEvent, STORE_VERSION, DEFAULT_RETENTION_DAYS } from "./model";
import { canonicalUrl } from "./canon";
import { sha256Hex } from "./hash";

/**
 * Minimal wrapper around chrome.storage.local.
 * - No DB
 * - No background jobs
 * - Append-only events + daily aggregates
 */

const DEDUPE_WINDOW_MS = 30_000;
const MAX_EVENTS = 20_000; // hard cap to prevent unbounded growth

type StoreShape = {
  [STORAGE_KEYS.EVENTS]?: TagEvent[];
  [STORAGE_KEYS.DAILY]?: Record<string, DailyAgg>; // keyed by day
  [STORAGE_KEYS.META]?: StoreMeta;
};

function todayLocalYYYYMMDD(tsMs: number = Date.now()): string {
  const d = new Date(tsMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function incFreq(map: Record<string, number>, k: string, by: number = 1) {
  map[k] = (map[k] ?? 0) + by;
}

function uniqCount(obj: Record<string, number>): number {
  return Object.keys(obj).length;
}

function normalizeTags(tags: string[]): string[] {
  // Free policy: content-derived only; keep deterministic.
  const cleaned = (tags ?? [])
    .map(t => String(t).trim())
    .filter(t => t.length > 0);
  // De-dupe within a single event, then sort for determinism.
  return Array.from(new Set(cleaned)).sort();
}

function buildDailyFromEvents(events: TagEvent[]): Record<string, DailyAgg> {
  const daily: Record<string, DailyAgg> = {};
  for (const e of events) {
    const dayKey = e.day || todayLocalYYYYMMDD(e.tsMs);
    const existing = daily[dayKey];
    const agg: DailyAgg = existing ?? {
      day: dayKey,
      eventCount: 0,
      uniqueTags: 0,
      tagFreq: {}
    };

    agg.eventCount += 1;
    for (const t of e.tags) {
      incFreq(agg.tagFreq, t, 1);
    }
    agg.uniqueTags = uniqCount(agg.tagFreq);
    daily[dayKey] = agg;
  }
  return daily;
}

function shouldDedupe(last: TagEvent | undefined, next: TagEvent): boolean {
  if (!last) return false;
  if (last.urlH !== next.urlH) return false;
  return (next.tsMs - last.tsMs) >= 0 && (next.tsMs - last.tsMs) <= DEDUPE_WINDOW_MS;
}

async function getLocal<T extends keyof StoreShape>(keys: T[]): Promise<Pick<StoreShape, T>> {
  return (await chrome.storage.local.get(keys)) as Pick<StoreShape, T>;
}

async function setLocal(patch: Partial<StoreShape>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function ensureMeta(): Promise<StoreMeta> {
  const got = await getLocal([STORAGE_KEYS.META]);
  const meta = got[STORAGE_KEYS.META];

  // Hard reset on version mismatch (Free policy: no migrations)
  if (meta && meta.version !== STORE_VERSION) {
    await chrome.storage.local.remove([
      STORAGE_KEYS.EVENTS,
      STORAGE_KEYS.DAILY,
      STORAGE_KEYS.META
    ]);
  }

  // Re-check after potential reset
  const got2 = await getLocal([STORAGE_KEYS.META]);
  const meta2 = got2[STORAGE_KEYS.META];
  if (meta2 && meta2.version === STORE_VERSION) return meta2;

  const fresh: StoreMeta = {
    version: STORE_VERSION,
    createdAtMs: Date.now(),
    lastWriteAtMs: Date.now()
  };

  await setLocal({ [STORAGE_KEYS.META]: fresh });
  return fresh;
}

export async function appendEvent(evt: TagEvent): Promise<void> {
  await ensureMeta();

  const got = await getLocal([STORAGE_KEYS.EVENTS, STORAGE_KEYS.DAILY, STORAGE_KEYS.META]);

  const events = got[STORAGE_KEYS.EVENTS] ?? [];

  const last = events.length ? events[events.length - 1] : undefined;

  // Defensive: normalize and de-dupe tags within the event (deterministic order).
  const normalizedTags = normalizeTags(evt.tags);
  if (normalizedTags.length === 0) return;
  evt = { ...evt, tags: normalizedTags };

  if (shouldDedupe(last, evt)) {
    // Still touch meta lastWrite? I'd say no — keep it pure.
    return;
  }

  events.push(evt);

  // Enforce retention window (drop events older than DEFAULT_RETENTION_DAYS)
  const cutoffMs = Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retained = events.filter(e => e.tsMs >= cutoffMs);

  // Enforce hard event cap (drop oldest first)
  if (retained.length > MAX_EVENTS) {
    retained.splice(0, retained.length - MAX_EVENTS);
  }

  // Replace events array with retained set
  events.length = 0;
  events.push(...retained);

  // Rebuild daily aggregates from the retained event log to avoid drift.
  const dailyMap = buildDailyFromEvents(events);

  // Clean up old daily aggregates beyond retention window (defensive; should already match events).
  const dayCutoffMs = Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(dailyMap)) {
    const [y, m, d] = k.split("-").map(Number);
    const dayMs = new Date(y, m - 1, d).getTime();
    if (dayMs < dayCutoffMs) delete dailyMap[k];
  }

  const meta: StoreMeta = got[STORAGE_KEYS.META] ?? {
    version: STORE_VERSION,
    createdAtMs: Date.now(),
    lastWriteAtMs: Date.now()
  };
  meta.lastWriteAtMs = Date.now();

  await setLocal({
    [STORAGE_KEYS.EVENTS]: events,
    [STORAGE_KEYS.DAILY]: dailyMap,
    [STORAGE_KEYS.META]: meta
  });
}

export async function loadEvents(): Promise<TagEvent[]> {
  const got = await getLocal([STORAGE_KEYS.EVENTS]);
  return got[STORAGE_KEYS.EVENTS] ?? [];
}

export async function loadDailyAggs(): Promise<Record<string, DailyAgg>> {
  const got = await getLocal([STORAGE_KEYS.DAILY]);
  return got[STORAGE_KEYS.DAILY] ?? {};
}

export async function purgeAll(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.EVENTS, STORAGE_KEYS.DAILY, STORAGE_KEYS.META]);
}

/**
 * Export helpers (not CSV yet): get a sorted list of days available.
 */
export async function listDays(): Promise<string[]> {
  const daily = await loadDailyAggs();
  return Object.keys(daily).sort();
}

/**
 * Convenience: build a TagEvent for the current page.
 * urlH is a placeholder (canonical URL hashing comes later).
 */
export async function buildPageEvent(opts: {
  tags: string[];
  probe?: { scrollCt: number; clickCt: number; energy: number };
}): Promise<TagEvent> {
  const tsMs = Date.now();

  const canon = canonicalUrl(location.href);
  const urlH = await sha256Hex(canon);

  return {
    day: todayLocalYYYYMMDD(tsMs),
    tsMs,
    dom: location.hostname,
    urlH: `sha256:${urlH}`,
    tags: opts.tags,
    probe: opts.probe
  };
}