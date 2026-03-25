(function initOfflineViewer() {
  const IS_MAC = /\bMac\b/.test(navigator.platform) || /\bMac\b/.test(navigator.userAgent);
  const video = document.getElementById("offlineVideo");
  const canvas = document.getElementById("gridCanvas");
  const stageShell = document.getElementById("stageShell");
  const videoStage = document.getElementById("videoStage");
  const emptyState = document.getElementById("emptyState");
  const fileInput = document.getElementById("fileInput");
  const fileName = document.getElementById("fileName");
  const statusPill = document.getElementById("statusPill");
  const toggleGridBtn = document.getElementById("toggleGridBtn");
  const autoMapBtn = document.getElementById("autoMapBtn");
  const resetBtn = document.getElementById("resetBtn");
  const ctx = canvas.getContext("2d");
  const detector = window.createCourtDetector();

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
  const DEFAULT_SHORTCUTS = IS_MAC ? MAC_DEFAULT_SHORTCUTS : LEGACY_DEFAULT_SHORTCUTS;

  let shortcuts = mergeShortcuts(null);
  let currentObjectUrl = null;
  let gridVisible = false;
  let gridInitialized = false;
  let isAutoMapping = false;
  let draggingCorner = null;
  let draggingGrid = false;
  let lastMouse = null;
  let shiftPressed = false;
  let statusMessage = "";
  let statusTimeoutId = null;
  let corners = createCenteredGrid();

  chrome.storage.sync.get({ shortcuts: DEFAULT_SHORTCUTS }, (data) => {
    shortcuts = mergeShortcuts(data.shortcuts);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.shortcuts) {
      shortcuts = mergeShortcuts(changes.shortcuts.newValue);
    }
  });

  detector.warmup().then((state) => {
    if (!state.ready) {
      setStatus("ONNX runtime missing, using heuristic auto-map.");
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }

    currentObjectUrl = URL.createObjectURL(file);
    video.src = currentObjectUrl;
    fileName.textContent = file.name;
    statusPill.textContent = "Loading video...";
    emptyState.hidden = true;
    videoStage.hidden = false;
    stageShell.classList.remove("empty");
    setControlsEnabled(false);
  });

  video.addEventListener("loadedmetadata", () => {
    resizeCanvas();
    setControlsEnabled(true);
    showGrid(false);
    corners = createCenteredGrid();
    gridInitialized = false;
    statusPill.textContent = "Video ready";
    setStatus("Video loaded. Use Show grid or Auto-map.");
  });

  video.addEventListener("emptied", () => {
    gridVisible = false;
    gridInitialized = false;
    draw();
  });

  window.addEventListener("resize", resizeCanvas);
  video.addEventListener("loadeddata", resizeCanvas);

  toggleGridBtn.addEventListener("click", () => {
    showGrid(!gridVisible);
  });

  autoMapBtn.addEventListener("click", () => {
    autoMapGrid();
  });

  resetBtn.addEventListener("click", () => {
    corners = createCenteredGrid();
    gridInitialized = true;
    showGrid(true);
    setStatus("Grid reset to center.");
  });

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
      showGrid(true);
      setStatus("Grid reset to center.");
      return;
    }

    if (matchesShortcut(e, shortcuts.toggle)) {
      e.preventDefault();
      showGrid(!gridVisible);
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
    if (!shiftPressed || videoStage.hidden) return;

    const rect = canvas.getBoundingClientRect();
    if (!isInsideRect(e.clientX, e.clientY, rect)) return;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    lastMouse = { x: mx, y: my };

    draggingCorner = null;
    corners.forEach((corner, index) => {
      if (Math.hypot(mx - corner.x, my - corner.y) < 15) {
        draggingCorner = index;
      }
    });

    if (draggingCorner === null) {
      draggingGrid = true;
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (!shiftPressed || videoStage.hidden) return;

    const rect = canvas.getBoundingClientRect();
    if (!isInsideRect(e.clientX, e.clientY, rect)) return;

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

      corners = corners.map((corner) => ({
        x: corner.x + dx,
        y: corner.y + dy,
      }));

      lastMouse = { x: mx, y: my };
      draw();
    }
  });

  document.addEventListener("mouseup", () => {
    draggingCorner = null;
    draggingGrid = false;
  });

  document.addEventListener(
    "wheel",
    (e) => {
      if (!shiftPressed || videoStage.hidden) return;

      const rect = canvas.getBoundingClientRect();
      if (!isInsideRect(e.clientX, e.clientY, rect)) return;

      e.preventDefault();
      rotateCorners(e.deltaY * 0.0005);
      draw();
    },
    { passive: false },
  );

  function setControlsEnabled(enabled) {
    toggleGridBtn.disabled = !enabled;
    autoMapBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
  }

  function mergeShortcuts(stored) {
    const merged = {};
    for (const action of ["map", "reset", "toggle"]) {
      const def = DEFAULT_SHORTCUTS[action];
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

  function getEventKey(e) {
    if (typeof e.code === "string") {
      if (e.code.startsWith("Key")) {
        return e.code.slice(3).toLowerCase();
      }
      if (e.code.startsWith("Digit")) {
        return e.code.slice(5);
      }
    }

    return typeof e.key === "string" ? e.key.toLowerCase() : "";
  }

  function matchesShortcut(e, binding) {
    return (
      binding &&
      getEventKey(e) === binding.key.toLowerCase() &&
      !!e.altKey === !!binding.alt &&
      !!e.shiftKey === !!binding.shift &&
      !!e.ctrlKey === !!binding.ctrl &&
      !!e.metaKey === !!binding.meta
    );
  }

  function isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function createCenteredGrid() {
    const w = canvas.width || video.clientWidth || 1280;
    const h = canvas.height || video.clientHeight || 720;
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

  function resizeCanvas() {
    if (!video.videoWidth || !video.videoHeight) return;

    const rect = video.getBoundingClientRect();
    const previousWidth = canvas.width || rect.width;
    const previousHeight = canvas.height || rect.height;

    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    if (gridInitialized && previousWidth > 0 && previousHeight > 0) {
      const scaleX = rect.width / previousWidth;
      const scaleY = rect.height / previousHeight;
      corners = corners.map((corner) => ({
        x: corner.x * scaleX,
        y: corner.y * scaleY,
      }));
    } else {
      corners = createCenteredGrid();
    }

    draw();
  }

  function showGrid(visible) {
    gridVisible = visible;
    if (visible && !gridInitialized) {
      corners = createCenteredGrid();
      gridInitialized = true;
    }

    toggleGridBtn.textContent = visible ? "Hide grid" : "Show grid";
    statusPill.textContent = visible ? "Grid visible" : "Grid hidden";
    draw();
  }

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
    statusPill.textContent = message;

    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
      statusTimeoutId = null;
    }

    if (!persist) {
      statusTimeoutId = setTimeout(() => {
        statusMessage = "";
        statusPill.textContent = gridVisible ? "Grid visible" : "Video ready";
        draw();
      }, 2400);
    }

    draw();
  }

  async function autoMapGrid() {
    if (isAutoMapping || !video.videoWidth) return;

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
      setStatus("Automatic mapping failed. Use Shift+drag to adjust.");
    } finally {
      isAutoMapping = false;
      draw();
    }
  }

  function rotateCorners(angle) {
    const cx = corners.reduce((sum, corner) => sum + corner.x, 0) / 4;
    const cy = corners.reduce((sum, corner) => sum + corner.y, 0) / 4;

    corners = corners.map((corner) => {
      const dx = corner.x - cx;
      const dy = corner.y - cy;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      };
    });
  }

  function getTransform() {
    if (!hasValidCorners(corners)) return null;

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
    if (!transform || typeof transform.transform !== "function") return;

    ctx.shadowColor = "black";
    ctx.shadowBlur = 2;
    ctx.strokeStyle = shiftPressed ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.38)";

    for (let y = 1; y < 10; y += 1) {
      ctx.beginPath();
      ctx.lineWidth = 1 + (y / 10) * 2;

      for (let x = 0; x <= 5; x += 1) {
        const point = transform.transform(x / 5, y / 10);
        if (x === 0) ctx.moveTo(point[0], point[1]);
        else ctx.lineTo(point[0], point[1]);
      }

      ctx.stroke();
    }

    for (let x = 1; x < 5; x += 1) {
      ctx.beginPath();
      for (let y = 0; y <= 10; y += 1) {
        const point = transform.transform(x / 5, y / 10);
        if (y === 0) ctx.moveTo(point[0], point[1]);
        else ctx.lineTo(point[0], point[1]);
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    const middleA = transform.transform(0, 0.5);
    const middleB = transform.transform(1, 0.5);
    ctx.beginPath();
    ctx.moveTo(middleA[0], middleA[1]);
    ctx.lineTo(middleB[0], middleB[1]);
    ctx.strokeStyle = "rgba(255,0,0,0.65)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawCorners() {
    if (!shiftPressed) return;

    corners.forEach((corner) => {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#ff5959";
      ctx.fill();
    });
  }

  function drawStatus() {
    if (!statusMessage) return;

    ctx.save();
    ctx.font = "14px Segoe UI, sans-serif";
    const padding = 10;
    const width = ctx.measureText(statusMessage).width + padding * 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(16, 16, width, 34);
    ctx.fillStyle = "white";
    ctx.textBaseline = "middle";
    ctx.fillText(statusMessage, 16 + padding, 33);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!gridVisible) return;
    drawGrid();
    drawCorners();
    drawStatus();
  }
})();
