const LEGACY_DEFAULT_SHORTCUTS = {
  map: { key: "m", alt: true, shift: false, ctrl: false, meta: false },
  reset: { key: "r", alt: true, shift: false, ctrl: false, meta: false },
  toggle: { key: "h", alt: true, shift: false, ctrl: false, meta: false },
};

const MAC_DEFAULT_SHORTCUTS = {
  map: { key: "m", alt: false, shift: true, ctrl: true, meta: false },
  reset: { key: "r", alt: false, shift: true, ctrl: true, meta: false },
  toggle: { key: "h", alt: false, shift: true, ctrl: true, meta: false },
};

// Default settings applied on first install
const DEFAULT_SETTINGS = {
  shortcuts: LEGACY_DEFAULT_SHORTCUTS,
  sites: [
    "*://*.youtube.com/*",
    "https://tv.volleyballworld.com/*",
    "file:///",
  ],
};

async function getDefaultShortcutsForPlatform() {
  const info = await chrome.runtime.getPlatformInfo();
  return info.os === "mac" ? MAC_DEFAULT_SHORTCUTS : LEGACY_DEFAULT_SHORTCUTS;
}

function mergeShortcuts(stored, defaults) {
  const merged = {};
  for (const action of ["map", "reset", "toggle"]) {
    const def = defaults[action];
    const src = (stored && stored[action]) || {};
    merged[action] = {
      key: typeof src.key === "string" ? src.key : def.key,
      alt: typeof src.alt === "boolean" ? src.alt : def.alt,
      shift: typeof src.shift === "boolean" ? src.shift : def.shift,
      ctrl: typeof src.ctrl === "boolean" ? src.ctrl : def.ctrl,
      meta: typeof src.meta === "boolean" ? src.meta : def.meta,
    };
  }
  return merged;
}

function shortcutSetsEqual(a, b) {
  for (const action of ["map", "reset", "toggle"]) {
    if (
      a[action].key !== b[action].key ||
      a[action].alt !== b[action].alt ||
      a[action].shift !== b[action].shift ||
      a[action].ctrl !== b[action].ctrl ||
      a[action].meta !== b[action].meta
    ) {
      return false;
    }
  }
  return true;
}

function normalizeSites(sites) {
  const merged = Array.isArray(sites) ? [...sites] : [];
  for (const site of DEFAULT_SETTINGS.sites) {
    if (!merged.includes(site)) {
      merged.push(site);
    }
  }
  return merged;
}

async function ensureSettingsAndScripts() {
  const platformDefaults = await getDefaultShortcutsForPlatform();
  const stored = await chrome.storage.sync.get(["shortcuts", "sites"]);
  const normalizedSites = normalizeSites(stored.sites);
  const normalizedLegacyShortcuts = mergeShortcuts(stored.shortcuts, LEGACY_DEFAULT_SHORTCUTS);

  let normalizedShortcuts;

  if (!stored.shortcuts) {
    normalizedShortcuts = platformDefaults;
  } else if (
    shortcutSetsEqual(platformDefaults, MAC_DEFAULT_SHORTCUTS) &&
    shortcutSetsEqual(normalizedLegacyShortcuts, LEGACY_DEFAULT_SHORTCUTS)
  ) {
    normalizedShortcuts = MAC_DEFAULT_SHORTCUTS;
  } else {
    normalizedShortcuts = mergeShortcuts(stored.shortcuts, platformDefaults);
  }

  await chrome.storage.sync.set({
    shortcuts: normalizedShortcuts,
    sites: normalizedSites,
  });

  await registerContentScripts();
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set({
      ...DEFAULT_SETTINGS,
      shortcuts: await getDefaultShortcutsForPlatform(),
    });
  }
  await ensureSettingsAndScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.sites) {
    ensureSettingsAndScripts();
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureSettingsAndScripts();
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
  const normalizedSites = normalizeSites(sites);

  if (!normalizedSites || normalizedSites.length === 0) return;

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: "grid-overlay",
        matches: normalizedSites,
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

ensureSettingsAndScripts();


