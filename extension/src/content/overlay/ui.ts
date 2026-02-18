import { loadDailyAggs, loadEvents, purgeAll } from "../../core/storage";
import { extractTagsGeneric } from "../../core/tags/extract_generic";
import { computeBridges } from "../../core/metrics/bridges";
import { computeBizarro } from "../../core/metrics/bizarro";

import { tvDistance, tempStateFromZ } from "../../core/metrics/temperature";
import { appendTempSample, meanStd, sparkline, zScore } from "../../core/metrics/rolling_stats";
import { chooseWindowDays, todayLocalYYYYMMDD } from "../../core/metrics/window";

import { computePolarization, polStateFromZ } from "../../core/metrics/polarization";
import { appendPolSample } from "../../core/metrics/rolling_stats_pol";


const ROOT_ID = "nsc-tp-root";

// Best-effort CPU bounds (Free): polarization is approximate, not exhaustive.
const POL_MIN_EVENTS = 80;
const POL_MAX_EVENTS = 2500;

function downsampleDeterministic<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  // Deterministic stride sample.
  const step = Math.ceil(arr.length / cap);
  const out: T[] = [];
  for (let i = 0; i < arr.length && out.length < cap; i += step) out.push(arr[i]);
  return out;
}

function dayKeyFromTsMsLocal(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isValidDayKey(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

function ensureStyleLoaded() {
  const href = chrome.runtime.getURL("ui.css");
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function t(key: string, fallback: string): string {
  const s = chrome.i18n?.getMessage?.(key);
  return s || fallback;
}

function isRtlLanguage(lang: string | undefined | null): boolean {
  const l = (lang || "").toLowerCase();
  // Keep this small and deterministic.
  return l.startsWith("ar") || l.startsWith("fa") || l.startsWith("he") || l.startsWith("ur");
}

export function openOverlay(opts?: { disqualified?: string }) {
  ensureStyleLoaded();

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    const prevHandler = (existing as any).__tp_onKeyDown as ((e: KeyboardEvent) => void) | undefined;
    if (prevHandler) document.removeEventListener("keydown", prevHandler, true);
    existing.remove();
    return;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  // RTL opt-in (Arabic etc.). CSS uses #nsc-tp-root[dir="rtl"].
  const uiLang = chrome.i18n?.getUILanguage?.();
  if (isRtlLanguage(uiLang)) {
    root.setAttribute("dir", "rtl");
    if (uiLang) root.setAttribute("lang", uiLang);
  }

  root.innerHTML = `
    <div id="nsc-tp-card" role="dialog" aria-label="NSC TagPivot">
      <div id="nsc-tp-head">
        <div id="nsc-tp-title">Ctrl+F++ (v0)</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="nsc-tp-history" title="Show last 10">${t("history","History")}</button>
          <button id="nsc-tp-purge" title="Purge local data">${t("purge","Purge")}</button>
          <button id="nsc-tp-close" title="Close">×</button>
        </div>
      </div>
      <div id="nsc-tp-body">
        <div id="nsc-tp-row">
          <input id="nsc-tp-input" placeholder="${t("find_placeholder","Find on page (v0)…")}" />
          <button id="nsc-tp-btn">Find</button>
        </div>
        <div id="nsc-tp-hint">
          ${t("hotkey_hint","Hotkey: Ctrl+Shift+F to toggle. (True Ctrl+F intercept later.)")}
        </div>

        <div id="nsc-tp-disq" style="margin-top:8px; font-size:12px; color:rgba(255,255,255,0.55); display:none;"></div>
        
        <div id="nsc-tp-history-box" style="display:none; margin-top:12px;"></div>

        <div id="nsc-tp-tags"></div>

        <div class="nsc-tp-section-title">Field State</div>
        <div id="nsc-tp-field" style="margin-top:8px; font-size:12px; color:rgba(255,255,255,0.85);">…</div>

        <div class="nsc-tp-section-title">Polarization</div>
        <div id="nsc-tp-pol" style="margin-top:8px; font-size:12px; color:rgba(255,255,255,0.85);">…</div>

        <div id="nsc-tp-poles" style="margin-top:10px; display:none;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div style="font-size:12px; color:rgba(255,255,255,0.75);">Poles</div>
            <button id="nsc-tp-counterview" title="Open a counter-view search" style="padding:6px 8px;">${t("counterview","CounterView")}</button>
          </div>

          <div style="margin-top:8px; font-size:12px; color:rgba(255,255,255,0.70);">Active</div>
          <div id="nsc-tp-pole-a" class="nsc-tp-section-row"></div>

          <div style="margin-top:10px; font-size:12px; color:rgba(255,255,255,0.70);">Counter</div>
          <div id="nsc-tp-pole-b" class="nsc-tp-section-row"></div>
        </div>

        <div class="nsc-tp-section-title">${t("bridges","Bridges")}</div>
        <div id="nsc-tp-bridges" class="nsc-tp-section-row"></div>

        <div class="nsc-tp-section-title">${t("counterpoint","Counterpoint")}</div>
        <div id="nsc-tp-bizarro" class="nsc-tp-section-row"></div>

      </div>
    </div>
  `;

  document.documentElement.appendChild(root);

  // Universal ESC close (console-style). Use capture and clean up on close.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  (root as any).__tp_onKeyDown = onKeyDown;
  document.addEventListener("keydown", onKeyDown, true);

  function close() {
    document.removeEventListener("keydown", onKeyDown, true);
    root.remove();
  }

  // Lazy memoized events load: avoids repeated storage reads within one overlay open.
  let eventsP: Promise<any[]> | null = null;
  const getEvents = () => (eventsP ??= loadEvents());

  const disqEl = root.querySelector<HTMLDivElement>("#nsc-tp-disq");
  if (opts?.disqualified && disqEl) {
    disqEl.style.display = "block";
    disqEl.textContent = `Disqualified (${opts.disqualified}).`;
  }

  // Wire buttons
  const closeBtn = root.querySelector<HTMLButtonElement>("#nsc-tp-close");
  closeBtn?.addEventListener("click", () => close());

  const historyBtn = root.querySelector<HTMLButtonElement>("#nsc-tp-history");
  const purgeBtn = root.querySelector<HTMLButtonElement>("#nsc-tp-purge");
  const historyBox = root.querySelector<HTMLDivElement>("#nsc-tp-history-box");
  // History is always present (UI-only). Load once on open.
  if (historyBox) {
    historyBox.style.display = "block";
    historyBox.innerHTML = `<div style="font-size:12px; color:rgba(255,255,255,0.75);">${t("loading","Loading…")}</div>`;
    (async () => {
      try {
        const events = await getEvents();
        const last = (events || []).slice(-10).reverse();
        historyBox.innerHTML = renderHistory(last as any);
      } catch (err) {
        console.warn("history load failed:", err);
        historyBox.innerHTML = `<div style="font-size:12px; color:rgba(255,255,255,0.55);">${t("history_unavailable","History unavailable.")}</div>`;
      }
    })();
  }

  historyBtn?.addEventListener("click", async () => {
    if (!historyBox) return;
    historyBox.style.display = (historyBox.style.display === "none") ? "block" : "none";
  });

  purgeBtn?.addEventListener("click", async () => {
    const ok = confirm(t("purge_confirm","Purge local TagPivot data? This cannot be undone."));
    if (!ok) return;

    await purgeAll();
    if (historyBox) {
      historyBox.style.display = "block";
      historyBox.innerHTML = `<div style="font-size:12px; color:rgba(255,255,255,0.75);">Purged.</div>`;
    }
  });

  const tagsEl = root.querySelector<HTMLDivElement>("#nsc-tp-tags");
  const seedTags = extractTagsGeneric(18);
  wireTagSearch(tagsEl);

  // Lazy memoized bridges: computed from events+seedTags once per overlay open.
  let bridgesCache: ReturnType<typeof computeBridges> | null = null;
  const getBridges = (events: any[]) => (bridgesCache ??= computeBridges({
    events,
    seedTags,
    days: 60,
    topK: 10,
    minCo: 2
  }));

  // Shared window selection (used by Field State + Polarization)
  const endDay = todayLocalYYYYMMDD();
  const windowCandidates = [8, 13, 21, 30, 60] as const;
  const windowMinTotal = 20;
  const windowMinUnique = 15;

  const dailyAggsP = loadDailyAggs();
  const chosenWindowP = dailyAggsP.then((daily) =>
    chooseWindowDays({
      daily,
      endDay,
      candidates: Array.from(windowCandidates),
      minTotal: windowMinTotal,
      minUnique: windowMinUnique,
    })
  );

  if (tagsEl) {
    tagsEl.innerHTML = seedTags.map(t =>
      `<button type="button" class="nsc-tp-tag" data-q="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    ).join("");
  }

  // Find wiring
  const input = root.querySelector<HTMLInputElement>("#nsc-tp-input");
  const btn = root.querySelector<HTMLButtonElement>("#nsc-tp-btn");

  const doFind = () => {
    const q = (input?.value || "").trim();
    if (!q) return;
    window.find(q, false, false, true, false, false, false);
  };

  btn?.addEventListener("click", doFind);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doFind();
    if (e.key === "Escape") close();
  });

  input?.focus();

  const fieldEl = root.querySelector<HTMLDivElement>("#nsc-tp-field");

  (async () => {
    try {
      const chosen = await chosenWindowP;

      if (!chosen) {
        if (fieldEl) {
          fieldEl.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${t("not_enough_data","Not enough local data yet.")}</span>`;
        }
        return;
      }

      const { windowDays, now, prev } = chosen;
      const temp = tvDistance(now, prev);

      const series = await appendTempSample({ day: endDay, temp });
      const values = series.map(s => s.temp);
      const last8 = values.slice(Math.max(0, values.length - 8));
      const spark = sparkline(last8);
      const { mean, std } = meanStd(values);
      const z = zScore(temp, mean, std);
      const state = tempStateFromZ(Math.abs(z));

      if (fieldEl) {
        fieldEl.innerHTML =
            `<b>${state}</b> ` +
            `<span style="color:rgba(255,255,255,0.70)">` +
            ` ${spark ? `<span title="last temps">${spark}</span> ` : ""}` +
            `temp=${temp.toFixed(3)} z=${z.toFixed(2)} w=${windowDays}d ` +
            `(${now.dayFrom}→${now.dayTo} vs ${prev.dayFrom}→${prev.dayTo})` +
            `</span>`;
      }
    } catch (err) {
      console.warn("temperature failed:", err);
      if (fieldEl) {
        fieldEl.innerHTML = `<span style="color:rgba(255,255,255,0.55)">Field state unavailable.</span>`;
      }
    }
  })();

  const polEl = root.querySelector<HTMLDivElement>("#nsc-tp-pol");

  (async () => {
    try {
      const chosen = await chosenWindowP;

      if (!chosen) {
        if (polEl) polEl.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${t("not_enough_data","Not enough local data yet.")}</span>`;
        return;
      }

      const { windowDays, now } = chosen;

      const eventsAll = await getEvents();
      const winEventsAll = eventsAll.length
        ? eventsAll.filter((e) => {
            const dayRaw = (e as any).day;
            const tsMs = (e as any).tsMs;
            const day = isValidDayKey(dayRaw)
              ? dayRaw
              : (Number.isFinite(tsMs) ? dayKeyFromTsMsLocal(tsMs) : "");
            return day.length > 0 && day >= now.dayFrom && day <= now.dayTo;
          })
        : [];

      if (winEventsAll.length < POL_MIN_EVENTS) {
        if (polEl) polEl.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${t("not_enough_structure_yet","Not enough structure yet.")}</span>`;
        const polesWrap = root.querySelector<HTMLDivElement>("#nsc-tp-poles");
        const counterBtn = root.querySelector<HTMLButtonElement>("#nsc-tp-counterview");
        if (polesWrap) polesWrap.style.display = "none";
        if (counterBtn) {
          counterBtn.disabled = true;
          counterBtn.style.display = "none";
        }
        return;
      }

      // Best-effort: bound CPU by downsampling deterministically.
      const winEvents = downsampleDeterministic(winEventsAll, POL_MAX_EVENTS);

      const out = computePolarization(winEvents, 8);
      const polesWrap = root.querySelector<HTMLDivElement>("#nsc-tp-poles");
      const poleAEl = root.querySelector<HTMLDivElement>("#nsc-tp-pole-a");
      const poleBEl = root.querySelector<HTMLDivElement>("#nsc-tp-pole-b");
      const counterBtn = root.querySelector<HTMLButtonElement>("#nsc-tp-counterview");
      wireTagSearch(polesWrap);
      
      if (!out) {
        if (polEl) polEl.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${t("not_enough_structure_yet","Not enough structure yet.")}</span>`;
        if (polesWrap) polesWrap.style.display = "none";
        if (counterBtn) {
            counterBtn.disabled = true;
            counterBtn.style.display = "none";
        }
        return;
      }

      // Render poles (compact)
      if (polesWrap && poleAEl && poleBEl) {
        const a = out.activePole.slice(0, 6);
        const b = out.counterPole.slice(0, 6);

        const btn = (t: string) =>
          `<button type="button" class="nsc-tp-tag" data-q="${escapeHtml(t)}" title="Search">${escapeHtml(t)}</button>`;

        poleAEl.innerHTML = a.length ? a.map(btn).join("") : `<span style="color:rgba(255,255,255,0.55); font-size:12px;">—</span>`;
        poleBEl.innerHTML = b.length ? b.map(btn).join("") : `<span style="color:rgba(255,255,255,0.55); font-size:12px;">—</span>`;

        polesWrap.style.display = "block";

        // CounterView: open a search built from 2–3 counter-pole tags (+ optional soft bridge)
        if (counterBtn) {
          counterBtn.disabled = false;
          counterBtn.style.display = "inline-block";

          // pick 2–3 counter tags (skip anything already in seedTags)
          const seedSet = new Set(seedTags.map(normKey));
          const counterTags = out.counterPole.filter(t => !seedSet.has(normKey(t))).slice(0, 3);

          // optional soft overlap: take the top bridge tag (computed from local history)
          const topBridge = getBridges(eventsAll)[0]?.tag;

          const parts = [...counterTags];
          if (topBridge && !seedSet.has(normKey(topBridge)) && !parts.map(normKey).includes(normKey(topBridge))) parts.push(topBridge);

          const q = parts.join(" ");

          // ensure we don't stack listeners on repeated opens
          counterBtn.onclick = () => {
              if (!q) return;
              window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
          };

          // tooltip shows exact query
          counterBtn.title = q ? `CounterView: ${q}` : "Open a counter-view search";
        }
      }
      if (!(polesWrap && poleAEl && poleBEl)) {
        if (counterBtn) {
          counterBtn.disabled = true;
          counterBtn.style.display = "none";
        }
      }

      const pol = out.pol;

      const series = await appendPolSample({ day: endDay, pol });
      const values = series.map(s => s.pol);
      const { mean, std } = meanStd(values);
      const z = zScore(pol, mean, std);
      const state = polStateFromZ(Math.abs(z));

      const last8 = values.slice(Math.max(0, values.length - 8));
      const sp = sparkline(last8);

      // Visual emphasis without colors
      if (counterBtn) {
        counterBtn.classList.remove("nsc-tp-cv-peaks", "nsc-tp-cv-flat");
        if (state === "Peaks") counterBtn.classList.add("nsc-tp-cv-peaks");
        if (state === "Flat") counterBtn.classList.add("nsc-tp-cv-flat");
      }

      if (polEl) {
        polEl.innerHTML =
          `<b>${state}</b> ` +
          `<span style="color:rgba(255,255,255,0.70)">` +
          `${sp ? `<span title="last pol">${sp}</span> ` : ""}` +
          `pol=${pol.toFixed(3)} z=${z.toFixed(2)} w=${windowDays}d` +
          `</span>`;
      }

      // Optional (still Free): show pole heads as tooltip only
      polEl?.setAttribute(
        "title",
        `active: ${out.activePole.slice(0, 6).join(", ")}\n` +
        `counter: ${out.counterPole.slice(0, 6).join(", ")}`
      );

    } catch (err) {
      console.warn("polarization failed:", err);
      if (polEl) polEl.innerHTML = `<span style="color:rgba(255,255,255,0.55)">Polarization unavailable.</span>`;
    }
  })();
    
    // Bridges: computed from local history (last 60d)
  const bridgesEl = root.querySelector<HTMLDivElement>("#nsc-tp-bridges");
  const bizarroEl = root.querySelector<HTMLDivElement>("#nsc-tp-bizarro");

  // Click-to-search (user initiated): delegate to avoid stacking listeners.
  wireTagSearch(bridgesEl);
  wireTagSearch(bizarroEl);

  (async () => {
    try {
      const events = await getEvents();
      
      if (!events || events.length === 0) {
        if (bridgesEl) bridgesEl.innerHTML = `<span style="font-size:12px; color:rgba(255,255,255,0.55);">${t("no_local_events_yet","No local events yet.")}</span>`;
        if (bizarroEl) bizarroEl.innerHTML = `<span style="font-size:12px; color:rgba(255,255,255,0.55);">${t("no_local_events_yet","No local events yet.")}</span>`;
        return;
      }

      const bridges = getBridges(events);

      if (bridgesEl) {
        bridgesEl.innerHTML = bridges.length
          ? bridges.map(b =>
            `<button type="button" class="nsc-tp-tag" data-q="${escapeHtml(b.tag)}" title="co=${b.co} df=${b.df} score=${b.score.toFixed(3)}">${escapeHtml(b.tag)}</button>`
            ).join("")
          : `<span style="font-size:12px; color:rgba(255,255,255,0.55);">No bridges yet.</span>`;
      }

      const bizarro = computeBizarro({
        events,
        seedTags,
        bridges,
        days: 60,
        topK: 10,
        bridgeTopM: 6,
        minCo: 2
      });

      if (bizarroEl) {
        bizarroEl.innerHTML = bizarro.length
          ? bizarro.map(x =>
              `<button type="button" class="nsc-tp-tag" data-q="${escapeHtml(x.tag)}"
                 title="co=${x.coBridge} df=${x.df} score=${x.score.toFixed(3)}">${escapeHtml(x.tag)}</button>`
            ).join("")
          : `<span style="font-size:12px; color:rgba(255,255,255,0.55);">No counterpoint yet.</span>`;
      }

    } catch (err) {
      console.warn("bridges/bizarro failed:", err);
      if (bridgesEl) bridgesEl.innerHTML = `<span style="font-size:12px; color:rgba(255,255,255,0.55);">Bridges unavailable.</span>`;
      if (bizarroEl) bizarroEl.innerHTML = `<span style="font-size:12px; color:rgba(255,255,255,0.55);">Counterpoint unavailable.</span>`;
    }
  })();
}

function renderHistory(last: Array<{ day: string; dom: string; tags: string[] }>): string {
  if (last.length === 0) {
    return `<div style="font-size:12px; color:rgba(255,255,255,0.75);">No history yet.</div>`;
  }

  const rows = last.map((e) => {
    const tags = e.tags.slice(0, 8).map(t =>
      `<span class="nsc-tp-tag">${escapeHtml(t)}</span>`
    ).join("");
    return `
      <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:12px; color:rgba(255,255,255,0.75);">
          ${escapeHtml(e.day)} • ${escapeHtml(e.dom)}
        </div>
        <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">
          ${tags || `<span style="font-size:12px; color:rgba(255,255,255,0.55);">${t("history_no_tags","No tags")}</span>`}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="font-size:12px; color:rgba(255,255,255,0.75); margin-bottom:6px;">
      Last 10
    </div>
    <div style="max-height:240px; overflow:auto;">
      ${rows}
    </div>
  `;
}

function openSearch(q: string) {
  const s = (q || "").trim();
  if (!s) return;
  window.open(`https://www.google.com/search?q=${encodeURIComponent(s)}`, "_blank", "noopener,noreferrer");
}

function wireTagSearch(container: HTMLElement | null) {
  if (!container) return;

  // Idempotent: avoid stacking delegated listeners if this is called more than once.
  const anyEl = container as any;
  if (anyEl.__tp_tagsearch_wired) return;
  anyEl.__tp_tagsearch_wired = true;

  container.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    const btn = t?.closest?.("button.nsc-tp-tag") as HTMLButtonElement | null;
    if (!btn) return;
    const q = btn.getAttribute("data-q") || "";
    openSearch(q);
  });
}

function normKey(s: string): string {
  return (s || "").trim().normalize("NFKC").toLowerCase();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c] as string));
}