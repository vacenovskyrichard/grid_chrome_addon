function initGrid(canvas, video) {
  const ctx = canvas.getContext("2d");
  const detector = window.createCourtDetector();
  let isAutoMapping = false;
  let statusMessage = "";
  let statusTimeoutId = null;

  // ── Visibility is per-tab, lives only in memory ───────────────────────────
  // Starts hidden on every new tab. The user enables it when they need it.
  let gridVisible = false;
  // Tracks whether a grid has ever been placed on this tab yet.
  // On the very first "show", we auto-create the centered default — so the
  // user immediately sees something without needing to press Reset too.
  let gridInitialized = false;

  // ── Shortcuts live in chrome.storage so they persist across sessions ──────
  const DEFAULT_SHORTCUTS = {
    map:    { key: "m", alt: true,  shift: false, ctrl: false },
    reset:  { key: "r", alt: true,  shift: false, ctrl: false },
    toggle: { key: "h", alt: true,  shift: false, ctrl: false },
  };

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

  let shortcuts = mergeShortcuts(null);

  chrome.storage.sync.get({ shortcuts: DEFAULT_SHORTCUTS }, (data) => {
    shortcuts = mergeShortcuts(data.shortcuts);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.shortcuts) {
      shortcuts = mergeShortcuts(changes.shortcuts.newValue);
    }
  });

  // ── Popup communication ───────────────────────────────────────────────────
  // The popup queries this tab's grid state when it opens, and can toggle it.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "getGridVisible") {
      sendResponse({ gridVisible });
      return true;
    }
    if (message.type === "setGridVisible") {
      showGrid(message.value);
      sendResponse({ ok: true });
      return true;
    }
  });

  // ── Show/hide logic ───────────────────────────────────────────────────────
  // Centralised function: turning on for the first time auto-creates the grid.
  function showGrid(visible) {
    gridVisible = visible;
    if (visible && !gridInitialized) {
      corners = createCenteredGrid();
      gridInitialized = true;
    }
    draw();
  }

  detector.warmup().then((state) => {
    if (!state.ready) {
      console.info("Court detector fallback mode:", state.error);
      setStatus("ONNX runtime missing, using heuristic auto-map.");
    }
  });

  function createCenteredGrid() {
    const w = canvas.width;
    const h = canvas.height;
    const gridWidth = w * 0.5;
    const gridHeight = h * 0.5;
    const cx = w / 2;
    const cy = h / 2;

    return [
      { x: cx - gridWidth / 2, y: cy - gridHeight / 2 },
      { x: cx + gridWidth / 2, y: cy - gridHeight / 2 },
      { x: cx + gridWidth / 2, y: cy + gridHeight / 2 },
      { x: cx - gridWidth / 2, y: cy + gridHeight / 2 },
    ];
  }

  let corners = createCenteredGrid();

  let draggingCorner = null;
  let draggingGrid = false;
  let lastMouse = null;

  let shiftPressed = false;

  function hasValidCorners(value) {
    return (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every(
        (corner) =>
          corner &&
          Number.isFinite(corner.x) &&
          Number.isFinite(corner.y),
      )
    );
  }

  function setStatus(message, persist = false) {
    statusMessage = message;
    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
      statusTimeoutId = null;
    }

    if (!persist) {
      statusTimeoutId = setTimeout(() => {
        statusMessage = "";
        draw();
      }, 2500);
    }

    draw();
  }

  async function autoMapGrid() {
    if (isAutoMapping) return;
    if (!video.videoWidth || !video.videoHeight) {
      setStatus("Video frame is not ready yet.");
      return;
    }

    // Auto-map always shows the grid (and initialises if needed)
    if (!gridVisible) showGrid(true);

    isAutoMapping = true;
    setStatus("Auto-mapping court...", true);

    try {
      const detectedCorners = await detector.detect(video);
      if (!hasValidCorners(detectedCorners)) {
        throw new Error("Detector returned invalid corners.");
      }

      corners = detectedCorners;
      gridInitialized = true;
      setStatus("Court mapped automatically.");
    } catch (error) {
      console.error(error);
      setStatus("Automatic mapping failed. Use Shift+drag to adjust manually.");
    } finally {
      isAutoMapping = false;
      draw();
    }
  }

  function matchesShortcut(e, binding) {
    if (!binding) return false;
    return (
      e.key.toLowerCase() === binding.key.toLowerCase() &&
      !!e.altKey   === !!binding.alt   &&
      !!e.shiftKey === !!binding.shift &&
      !!e.ctrlKey  === !!binding.ctrl
    );
  }

  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;

    if (e.key === "Shift") {
      shiftPressed = true;
      draw();
      return;
    }

    if (matchesShortcut(e, shortcuts.map)) {
      e.preventDefault();
      autoMapGrid();
      return;
    }

    if (matchesShortcut(e, shortcuts.reset)) {
      e.preventDefault();
      corners = createCenteredGrid();
      gridInitialized = true;
      // Reset always shows the grid — no point resetting an invisible grid
      showGrid(true);
      return;
    }

    if (matchesShortcut(e, shortcuts.toggle)) {
      e.preventDefault();
      showGrid(!gridVisible);
      return;
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      shiftPressed = false;
      draggingCorner = null;
      draggingGrid = false;
      draw();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!shiftPressed) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    lastMouse = { x: mx, y: my };

    corners.forEach((c, i) => {
      const d = Math.hypot(mx - c.x, my - c.y);
      if (d < 15) draggingCorner = i;
    });

    if (draggingCorner === null) {
      draggingGrid = true;
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (!shiftPressed) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (draggingCorner !== null) {
      corners[draggingCorner].x = mx;
      corners[draggingCorner].y = my;

      draw();
      return;
    }

    if (draggingGrid && lastMouse) {
      const dx = mx - lastMouse.x;
      const dy = my - lastMouse.y;

      corners.forEach((c) => {
        c.x += dx;
        c.y += dy;
      });

      lastMouse = { x: mx, y: my };

      draw();
    }
  });

  document.addEventListener("mouseup", () => {
    draggingCorner = null;
    draggingGrid = false;
  });

  document.addEventListener("wheel", (e) => {
    if (!shiftPressed) return;

    rotateCorners(e.deltaY * 0.0005);
    draw();
  });

  function rotateCorners(angle) {
    const cx = corners.reduce((s, c) => s + c.x, 0) / 4;
    const cy = corners.reduce((s, c) => s + c.y, 0) / 4;

    corners = corners.map((c) => {
      const dx = c.x - cx;
      const dy = c.y - cy;

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      };
    });
  }

  function getTransform() {
    if (!hasValidCorners(corners)) {
      return null;
    }

    return PerspT(
      [0, 0, 1, 0, 1, 1, 0, 1],
      [
        corners[0].x,
        corners[0].y,
        corners[1].x,
        corners[1].y,
        corners[2].x,
        corners[2].y,
        corners[3].x,
        corners[3].y,
      ],
    );
  }

  function drawGrid() {
    const transform = getTransform();
    if (!transform || typeof transform.transform !== "function") {
      return;
    }

    ctx.shadowColor = "black";
    ctx.shadowBlur = 2;

    ctx.strokeStyle = shiftPressed ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.35)";

    for (let y = 1; y < 10; y++) {
      ctx.beginPath();

      ctx.lineWidth = 1 + (y / 10) * 2;

      for (let x = 0; x <= 5; x++) {
        let px = x / 5;
        let py = y / 10;

        let p = transform.transform(px, py);

        if (x === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }

      ctx.stroke();
    }

    for (let x = 1; x < 5; x++) {
      ctx.beginPath();

      for (let y = 0; y <= 10; y++) {
        let px = x / 5;
        let py = y / 10;

        let p = transform.transform(px, py);

        if (y === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }

      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    const m1 = transform.transform(0, 0.5);
    const m2 = transform.transform(1, 0.5);

    ctx.beginPath();
    ctx.moveTo(m1[0], m1[1]);
    ctx.lineTo(m2[0], m2[1]);

    ctx.strokeStyle = "rgba(255,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawCorners() {
    if (!shiftPressed) return;

    corners.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "red";
      ctx.fill();
    });
  }

  function drawStatus() {
    if (!statusMessage) return;

    ctx.save();
    ctx.font = "14px sans-serif";
    const padding = 10;
    const metrics = ctx.measureText(statusMessage);
    const boxWidth = metrics.width + padding * 2;

    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(16, 16, boxWidth, 34);

    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.fillText(statusMessage, 16 + padding, 33);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gridVisible) return; // nothing to paint — cheapest possible off state

    drawGrid();
    drawCorners();
    drawStatus();
  }

  window.addEventListener("grid-redraw", () => {
    draw();
  });

  draw();
}
