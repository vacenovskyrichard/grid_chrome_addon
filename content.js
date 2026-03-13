function initWhenVideoReady() {
  const video = document.querySelector("video");

  if (!video) {
    setTimeout(initWhenVideoReady, 500);
    return;
  }

  const canvas = document.createElement("canvas");

  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.zIndex = "9999";
  canvas.style.pointerEvents = "none";

  video.parentElement.style.position = "relative";
  video.parentElement.appendChild(canvas);

  function resizeCanvas() {
    const rect = video.getBoundingClientRect();

    canvas.width = rect.width;
    canvas.height = rect.height;

    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    // požádej grid.js o překreslení
    window.dispatchEvent(new Event("grid-redraw"));
  }

  resizeCanvas();

  window.addEventListener("resize", resizeCanvas);
  video.addEventListener("fullscreenchange", resizeCanvas);

  const observer = new MutationObserver(() => {
    resizeCanvas();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  initGrid(canvas, video);
}

initWhenVideoReady();
