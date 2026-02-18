// extension/src/content/probe.ts

type ProbeSnapshot = { scrollCt: number; clickCt: number; energy: number };

let scrollCt = 0;
let clickCt = 0;
let started = false;

export function startProbe() {
  if (started) return;
  started = true;

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("click", onClick, { passive: true, capture: true });

  // reset on soft navigations (SPA)
  const reset = () => resetProbe();
  window.addEventListener("popstate", reset);
  window.addEventListener("hashchange", reset);
}

export function resetProbe() {
  scrollCt = 0;
  clickCt = 0;
}

export function getProbeSnapshot(): ProbeSnapshot {
  const energy = computeEnergy(scrollCt, clickCt);
  return { scrollCt, clickCt, energy };
}

function onScroll() {
  scrollCt += 1;
}

function onClick() {
  clickCt += 1;
}

// bounded 0..1, log-compressed so it doesn’t explode
function computeEnergy(s: number, c: number): number {
  const sNorm = Math.log1p(Math.min(s, 200)) / Math.log1p(200);
  const cNorm = Math.log1p(Math.min(c, 80)) / Math.log1p(80);
  const e = 0.65 * sNorm + 0.35 * cNorm;
  return clamp01(e);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}