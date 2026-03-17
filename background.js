// Default settings applied on first install
const DEFAULT_SETTINGS = {
  shortcuts: {
    map: { key: "m", alt: true, shift: false, ctrl: false },
    reset: { key: "r", alt: true, shift: false, ctrl: false },
    toggle: { key: "h", alt: true, shift: false, ctrl: false },
  },
  sites: [
    "*://*.youtube.com/*",
    "https://tv.volleyballworld.com/*",
  ],
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
  await registerContentScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.sites) {
    registerContentScripts();
  }
});

async function registerContentScripts() {
  // Remove all previously registered dynamic scripts
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map((s) => s.id),
      });
    }
  } catch (e) {
    console.warn("Could not unregister scripts:", e);
  }

  const { sites } = await chrome.storage.sync.get({ sites: DEFAULT_SETTINGS.sites });

  if (!sites || sites.length === 0) return;

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: "grid-overlay",
        matches: sites,
        js: [
          "perspective-transform.js",
          "node_modules/onnxruntime-web/dist/ort.all.min.js",
          "auto-detect.js",
          "grid.js",
          "content.js",
        ],
        runAt: "document_idle",
        allFrames: false,
      },
    ]);
  } catch (e) {
    console.warn("Could not register content scripts:", e);
  }
}


