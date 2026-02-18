import { openOverlay } from "./overlay/ui";
import { appendEvent, buildPageEvent } from "../core/storage";
import { getProbeSnapshot, startProbe } from "./probe";
import { extractTagsGeneric } from "../core/tags/extract_generic";
import { isDisqualifiedDocument, isDisqualifiedUrl } from "../core/disqualify";

startProbe();

// Central function: toggle UI + write one event (instrument: only on open)
async function toggleOverlayAndRecord() {
  openOverlay();

  const title = (document.title || "").trim();
  // Disqualify gate: do not log or compute on blocked pages
  const du = await isDisqualifiedUrl(location.href);
  if (!du.ok) {
    openOverlay({ disqualified: du.reason }); // optional UI hint (next step)
    return;
  }
  const dd = isDisqualifiedDocument(document);
  if (!dd.ok) {
    openOverlay({ disqualified: dd.reason }); // optional UI hint (next step)
    return;
  }
  const tags = extractTagsGeneric(18);

  const probe = getProbeSnapshot();
  const evt = await buildPageEvent({ tags, probe });

  try {
    await appendEvent(evt);
  } catch (err) {
    console.warn("nsc_tagpivot appendEvent failed:", err);
  }
}

// Reliable path: MV3 command → SW → message → content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "NSC_TP_TOGGLE_OVERLAY") {
    void toggleOverlayAndRecord();
  }
});

// Optional fallback: keydown (best-effort)
// NOTE: This can be eaten by Chrome/page shortcuts.
document.addEventListener(
  "keydown",
  (e) => {
    const t = e.target as HTMLElement | null;
    const isTyping =
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        (t as any).isContentEditable);
    if (isTyping) return;

    const isCtrlShiftF =
      (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f";
    if (!isCtrlShiftF) return;

    e.preventDefault();
    e.stopPropagation();
    void toggleOverlayAndRecord();
  },
  { capture: true }
);
