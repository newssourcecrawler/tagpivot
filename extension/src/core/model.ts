// extension/src/core/model.ts

export type TagEvent = {
  day: string;          // YYYY-MM-DD (local)
  tsMs: number;         // Date.now()
  dom: string;          // location.hostname
  urlH: string;         // placeholder for now (we'll add blake3 later)
  tags: string[];       // content-derived tags
  probe?: {
    scrollCt: number;
    clickCt: number;
    energy: number;     // derived, bounded 0..1
  };
};

export type DailyAgg = {
  day: string;
  eventCount: number;
  uniqueTags: number;
  tagFreq: Record<string, number>;
};

// Storage keys (chrome.storage.local)
export const STORAGE_KEYS = {
  EVENTS: "nsc_tp_events_v1",
  DAILY: "nsc_tp_daily_v1",
  META: "nsc_tp_meta_v1"
} as const;

export type StoreMeta = {
  version: 1;
  createdAtMs: number;
  lastWriteAtMs: number;
};

export const STORE_VERSION = 1;

// Rolling retention (days). We'll enforce later; for now store grows slowly.
export const DEFAULT_RETENTION_DAYS = 60;