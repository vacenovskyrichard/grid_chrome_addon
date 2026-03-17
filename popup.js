const DEFAULT_SHORTCUTS = {
  map:    { key: "m", alt: true,  shift: false, ctrl: false },
  reset:  { key: "r", alt: true,  shift: false, ctrl: false },
  toggle: { key: "h", alt: true,  shift: false, ctrl: false },
};

const DEFAULT_SITES = [
  "*://*.youtube.com/*",
  "https://tv.volleyballworld.com/*",
];

let shortcuts = {};
let sites = [];
let recordingAction = null;

// ── Deep-merge shortcuts ──────────────────────────────────────────────────────

function mergeShortcuts(stored) {
  const merged = {};
  for (const action of ["map", "reset", "toggle"]) {
    const def = DEFAULT_SHORTCUTS[action];
    const src = (stored && stored[action]) || {};
    merged[action] = {
      key:   typeof src.key   === "string"  ? src.key   : def.key,
      alt:   typeof src.alt   === "boolean" ? src.alt   : def.alt,
      shift: typeof src.shift === "boolean" ? src.shift : def.shift,
      ctrl:  typeof src.ctrl  === "boolean" ? src.ctrl  : def.ctrl,
    };
  }
  return merged;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bindingToLabel(b) {
  const parts = [];
  if (b.ctrl)  parts.push("Ctrl");
  if (b.alt)   parts.push("Alt");
  if (b.shift) parts.push("Shift");
  parts.push(b.key.toUpperCase());
  return parts;
}

function renderKbd(containerId, binding) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  bindingToLabel(binding).forEach((part) => {
    const k = document.createElement("kbd");
    k.textContent = part;
    el.appendChild(k);
  });
}

function flashSaved() {
  const el = document.getElementById("saveNotice");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}

// ── Grid toggle ───────────────────────────────────────────────────────────────
// Grid visibility is per-tab and lives only in the content script's memory.
// The popup queries the active tab for current state, then sends a message to
// change it. If the tab has no content script (non-matched page), we degrade
// gracefully — the toggle just shows "N/A" and does nothing.

const gridToggle = document.getElementById("gridToggle");
const toggleLabel = document.getElementById("toggleLabel");

function setToggleUI(visible, available) {
  gridToggle.checked = visible;
  gridToggle.disabled = !available;
  if (!available) {
    toggleLabel.textContent = "N/A";
    toggleLabel.className = "toggle-label";
  } else {
    toggleLabel.textContent = visible ? "ON" : "OFF";
    toggleLabel.className = "toggle-label" + (visible ? " on" : "");
  }
}

function sendToTab(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) { if (callback) callback(null); return; }
    chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
      // Suppress "receiving end does not exist" — it just means the content
      // script isn't running on this tab (e.g. non-matched page).
      if (chrome.runtime.lastError) { if (callback) callback(null); return; }
      if (callback) callback(response);
    });
  });
}

// Query the tab's current state when the popup opens
sendToTab({ type: "getGridVisible" }, (response) => {
  if (response === null) {
    setToggleUI(false, false); // content script not on this tab
  } else {
    setToggleUI(response.gridVisible, true);
  }
});

gridToggle.addEventListener("change", () => {
  const visible = gridToggle.checked;
  setToggleUI(visible, true);
  sendToTab({ type: "setGridVisible", value: visible }, (response) => {
    if (response === null) {
      // Tab didn't respond — revert the toggle visually
      setToggleUI(!visible, false);
    }
  });
});

// ── Shortcut display ──────────────────────────────────────────────────────────

function renderAllShortcuts() {
  renderKbd("kbd-map",    shortcuts.map);
  renderKbd("kbd-reset",  shortcuts.reset);
  renderKbd("kbd-toggle", shortcuts.toggle);
}

// ── Shortcut recording ────────────────────────────────────────────────────────

document.querySelectorAll(".btn-edit").forEach((btn) => {
  btn.addEventListener("click", () => startRecording(btn.dataset.action));
});

function startRecording(action) {
  if (recordingAction) stopRecording(false);
  recordingAction = action;
  const row = document.getElementById("row-" + action);
  row.classList.add("recording");
  const kbdEl = document.getElementById("kbd-" + action);
  kbdEl.innerHTML = '<span class="recording-hint">Press new keys\u2026</span>';
}

function stopRecording(save) {
  if (!recordingAction) return;
  const row = document.getElementById("row-" + recordingAction);
  row.classList.remove("recording");
  recordingAction = null;
  if (save) {
    chrome.storage.sync.set({ shortcuts });
    flashSaved();
  }
  renderAllShortcuts();
}

document.addEventListener("keydown", (e) => {
  if (!recordingAction) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") { stopRecording(false); return; }
  if (["Shift", "Alt", "Control", "Meta"].includes(e.key)) return;
  shortcuts[recordingAction] = {
    key:   e.key.toLowerCase(),
    alt:   e.altKey,
    shift: e.shiftKey,
    ctrl:  e.ctrlKey,
  };
  stopRecording(true);
}, true);

// ── Sites list ────────────────────────────────────────────────────────────────

function renderSites() {
  const list = document.getElementById("siteList");
  list.innerHTML = "";
  sites.forEach(function(site, i) {
    const item = document.createElement("div");
    item.className = "site-item";
    const span = document.createElement("span");
    span.textContent = site;
    span.title = site;
    const btn = document.createElement("button");
    btn.className = "btn-remove";
    btn.title = "Remove";
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9.5 3.5l-6 6M3.5 3.5l6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    btn.addEventListener("click", function() {
      sites.splice(i, 1);
      chrome.storage.sync.set({ sites: sites });
      renderSites();
      flashSaved();
    });
    item.appendChild(span);
    item.appendChild(btn);
    list.appendChild(item);
  });
}

document.getElementById("addSiteBtn").addEventListener("click", addSite);
document.getElementById("siteInput").addEventListener("keydown", function(e) {
  if (e.key === "Enter") addSite();
});

function addSite() {
  const input = document.getElementById("siteInput");
  const val = input.value.trim();
  if (!val) return;
  if (!sites.includes(val)) {
    sites.push(val);
    chrome.storage.sync.set({ sites: sites });
    renderSites();
    flashSaved();
  }
  input.value = "";
}

// ── Load from storage & initialise ───────────────────────────────────────────

chrome.storage.sync.get(
  { shortcuts: DEFAULT_SHORTCUTS, sites: DEFAULT_SITES },
  function(data) {
    shortcuts = mergeShortcuts(data.shortcuts);
    sites     = Array.isArray(data.sites) ? data.sites : DEFAULT_SITES.slice();
    renderAllShortcuts();
    renderSites();
  }
);
