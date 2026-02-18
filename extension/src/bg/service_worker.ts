chrome.runtime.onInstalled.addListener(() => {
  console.log("NSC TagPivot installed");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-overlay") return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "NSC_TP_TOGGLE_OVERLAY" });
});