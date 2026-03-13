function createCourtDetector() {
  const MODEL_SIZE = 640;
  const ROI_TOP_RATIO = 0.08;
  const ROI_BOTTOM_RATIO = 0.95;
  const MIN_POINT_COUNT = 150;
  const MODEL_URL = chrome.runtime.getURL("models/yolov8s-field-50.onnx");
  const ORT_DIST_URL = chrome.runtime.getURL("node_modules/onnxruntime-web/dist/");
  const DEBUG_PREFIX = "[court-detector]";
  let debugSnapshot = null;

  let modelSessionPromise = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function debugLog(message, extra) {
    if (typeof extra === "undefined") {
      console.log(DEBUG_PREFIX, message);
      return;
    }

    console.log(DEBUG_PREFIX, message, extra);
    try {
      console.log(`${DEBUG_PREFIX} ${message} JSON`, JSON.stringify(extra));
    } catch (error) {
      console.log(`${DEBUG_PREFIX} ${message} JSON`, "[unserializable]");
    }
  }

  function setDebugSnapshot(snapshot) {
    debugSnapshot = snapshot;
    window.__courtDetectorDebug = snapshot;
  }

  function average(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
  }

  function resizeFrameToCanvas(video, width = MODEL_SIZE, height = MODEL_SIZE) {
    const sourceWidth = video.videoWidth || video.clientWidth;
    const sourceHeight = video.videoHeight || video.clientHeight;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, width, height);

    return {
      canvas,
      ctx,
      width,
      height,
      scaleX: (video.clientWidth || sourceWidth) / width,
      scaleY: (video.clientHeight || sourceHeight) / height,
    };
  }

  function rgbToHsv(r, g, b) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;

    let hue = 0;

    if (delta !== 0) {
      if (max === red) {
        hue = ((green - blue) / delta) % 6;
      } else if (max === green) {
        hue = (blue - red) / delta + 2;
      } else {
        hue = (red - green) / delta + 4;
      }
    }

    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;

    return {
      hue,
      saturation: max === 0 ? 0 : delta / max,
      value: max,
    };
  }

  function collectCourtLinePointsFromImage(imageData, width, height) {
    const points = [];
    const data = imageData.data;
    const yStart = Math.floor(height * ROI_TOP_RATIO);
    const yEnd = Math.floor(height * ROI_BOTTOM_RATIO);

    for (let y = yStart; y < yEnd; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const { hue, saturation, value } = rgbToHsv(r, g, b);

        const isBlueTape =
          hue >= 180 &&
          hue <= 265 &&
          saturation >= 0.18 &&
          value >= 0.2 &&
          b > r * 1.05 &&
          b > g * 0.95;

        if (isBlueTape) {
          points.push({ x, y });
        }
      }
    }

    return points;
  }

  function createInputTensor(ctx, width, height) {
    const { data } = ctx.getImageData(0, 0, width, height);
    const tensor = new Float32Array(3 * width * height);
    const channelSize = width * height;

    for (let i = 0; i < width * height; i += 1) {
      const pixelIndex = i * 4;
      tensor[i] = data[pixelIndex] / 255;
      tensor[channelSize + i] = data[pixelIndex + 1] / 255;
      tensor[channelSize * 2 + i] = data[pixelIndex + 2] / 255;
    }

    return tensor;
  }

  async function getModelSession() {
    if (!window.ort) {
      throw new Error("onnxruntime-web is not bundled in the extension yet.");
    }

    if (!modelSessionPromise) {
      window.ort.env.wasm.wasmPaths = ORT_DIST_URL;
      window.ort.env.wasm.numThreads = 1;

      modelSessionPromise = window.ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    }

    const session = await modelSessionPromise;
    debugLog("session ready", {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      inputMetadata: session.inputMetadata,
      outputMetadata: session.outputMetadata,
    });

    return session;
  }

  function getSessionInputName(session) {
    if (Array.isArray(session.inputNames) && session.inputNames.length > 0) {
      return session.inputNames[0];
    }

    const names = Object.keys(session.inputMetadata || {});
    if (names.length === 0) {
      throw new Error("Model input metadata is missing.");
    }

    return names[0];
  }

  function iou(boxA, boxB) {
    const x1 = Math.max(boxA.x1, boxB.x1);
    const y1 = Math.max(boxA.y1, boxB.y1);
    const x2 = Math.min(boxA.x2, boxB.x2);
    const y2 = Math.min(boxA.y2, boxB.y2);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = Math.max(0, boxA.x2 - boxA.x1) * Math.max(0, boxA.y2 - boxA.y1);
    const areaB = Math.max(0, boxB.x2 - boxB.x1) * Math.max(0, boxB.y2 - boxB.y1);
    const union = areaA + areaB - intersection;

    return union <= 0 ? 0 : intersection / union;
  }

  function selectDetectionTensor(outputs) {
    return Object.values(outputs).find((tensor) => tensor.dims.length === 3);
  }

  function selectProtoTensor(outputs) {
    return Object.values(outputs).find((tensor) => tensor.dims.length === 4);
  }

  function parsePredictions(detectionTensor, protoTensor) {
    debugLog("selected tensors", {
      detectionDims: detectionTensor.dims,
      protoDims: protoTensor.dims,
    });

    const protoChannels = protoTensor.dims[1];
    const dims = detectionTensor.dims;
    const raw = detectionTensor.data;

    let candidateCount;
    let featureCount;
    let readValue;

    const dimA = dims[1];
    const dimB = dims[2];
    const minFeatureCount = 4 + protoChannels + 1;

    if (dimA >= minFeatureCount && dimA < dimB) {
      featureCount = dimA;
      candidateCount = dimB;
      readValue = (candidateIndex, featureIndex) =>
        raw[featureIndex * candidateCount + candidateIndex];
    } else if (dimB >= minFeatureCount && dimB < dimA) {
      candidateCount = dimA;
      featureCount = dimB;
      readValue = (candidateIndex, featureIndex) =>
        raw[candidateIndex * featureCount + featureIndex];
    } else if (dimA < dimB) {
      featureCount = dimA;
      candidateCount = dimB;
      readValue = (candidateIndex, featureIndex) =>
        raw[featureIndex * candidateCount + candidateIndex];
    } else {
      candidateCount = dimA;
      featureCount = dimB;
      readValue = (candidateIndex, featureIndex) =>
        raw[candidateIndex * featureCount + featureIndex];
    }

    const classCount = featureCount - 4 - protoChannels;
    if (classCount <= 0) {
      throw new Error("Unexpected YOLO segmentation output shape.");
    }

    debugLog("prediction layout", {
      candidateCount,
      featureCount,
      protoChannels,
      classCount,
    });

    const candidates = [];

    for (let i = 0; i < candidateCount; i += 1) {
      let bestClassScore = 0;
      for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
        bestClassScore = Math.max(bestClassScore, readValue(i, 4 + classIndex));
      }

      if (bestClassScore < 0.35) {
        continue;
      }

      const cx = readValue(i, 0);
      const cy = readValue(i, 1);
      const width = readValue(i, 2);
      const height = readValue(i, 3);
      const x1 = cx - width / 2;
      const y1 = cy - height / 2;
      const x2 = cx + width / 2;
      const y2 = cy + height / 2;

      const maskCoefficients = new Float32Array(protoChannels);
      for (let maskIndex = 0; maskIndex < protoChannels; maskIndex += 1) {
        maskCoefficients[maskIndex] = readValue(i, 4 + classCount + maskIndex);
      }

      candidates.push({
        score: bestClassScore,
        x1,
        y1,
        x2,
        y2,
        maskCoefficients,
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    const selected = [];
    for (const candidate of candidates) {
      const overlaps = selected.some((kept) => iou(candidate, kept) > 0.5);
      if (!overlaps) {
        selected.push(candidate);
      }
      if (selected.length >= 10) {
        break;
      }
    }

    if (selected.length === 0) {
      throw new Error("Model did not detect any court mask.");
    }

    debugLog("top detection", {
      score: selected[0].score,
      x1: selected[0].x1,
      y1: selected[0].y1,
      x2: selected[0].x2,
      y2: selected[0].y2,
    });

    return selected[0];
  }

  function decodeMask(protoTensor, detection) {
    const [, channels, maskHeight, maskWidth] = protoTensor.dims;
    const proto = protoTensor.data;
    const mask = new Float32Array(maskWidth * maskHeight);

    for (let y = 0; y < maskHeight; y += 1) {
      for (let x = 0; x < maskWidth; x += 1) {
        let value = 0;

        for (let channel = 0; channel < channels; channel += 1) {
          const protoIndex = channel * maskHeight * maskWidth + y * maskWidth + x;
          value += detection.maskCoefficients[channel] * proto[protoIndex];
        }

        mask[y * maskWidth + x] = sigmoid(value);
      }
    }

    return {
      data: mask,
      width: maskWidth,
      height: maskHeight,
      bbox: detection,
    };
  }

  function collectBoundaryPointsFromMask(maskInfo, targetWidth, targetHeight) {
    const points = [];
    const { data, width, height, bbox } = maskInfo;
    const xStart = clamp(Math.floor((bbox.x1 / MODEL_SIZE) * width), 0, width - 1);
    const xEnd = clamp(Math.ceil((bbox.x2 / MODEL_SIZE) * width), 1, width);
    const yStart = clamp(Math.floor((bbox.y1 / MODEL_SIZE) * height), 0, height - 1);
    const yEnd = clamp(Math.ceil((bbox.y2 / MODEL_SIZE) * height), 1, height);

    for (let y = yStart + 1; y < yEnd - 1; y += 1) {
      for (let x = xStart + 1; x < xEnd - 1; x += 1) {
        const index = y * width + x;
        if (data[index] < 0.45) {
          continue;
        }

        const hasOutsideNeighbor =
          data[index - 1] < 0.5 ||
          data[index + 1] < 0.5 ||
          data[index - width] < 0.5 ||
          data[index + width] < 0.5;

        if (hasOutsideNeighbor) {
          points.push({
            x: (x / width) * targetWidth,
            y: (y / height) * targetHeight,
          });
          continue;
        }

        if ((x + y) % 3 === 0) {
          points.push({
            x: (x / width) * targetWidth,
            y: (y / height) * targetHeight,
          });
        }
      }
    }

    return points;
  }

  function collectMaskPoints(maskInfo, targetWidth, targetHeight) {
    const points = [];
    const { data, width, height, bbox } = maskInfo;
    const xStart = clamp(Math.floor((bbox.x1 / MODEL_SIZE) * width), 0, width - 1);
    const xEnd = clamp(Math.ceil((bbox.x2 / MODEL_SIZE) * width), 1, width);
    const yStart = clamp(Math.floor((bbox.y1 / MODEL_SIZE) * height), 0, height - 1);
    const yEnd = clamp(Math.ceil((bbox.y2 / MODEL_SIZE) * height), 1, height);

    for (let y = yStart; y < yEnd; y += 1) {
      for (let x = xStart; x < xEnd; x += 1) {
        const index = y * width + x;
        if (data[index] < 0.45) {
          continue;
        }

        if ((x + y) % 2 === 0) {
          points.push({
            x: (x / width) * targetWidth,
            y: (y / height) * targetHeight,
          });
        }
      }
    }

    return points;
  }

  function createDebugMaskCanvas(maskInfo, sourceWidth, sourceHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(sourceWidth, sourceHeight);
    const { data, width, height } = maskInfo;

    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const srcX = Math.min(width - 1, Math.max(0, Math.floor((x / sourceWidth) * width)));
        const srcY = Math.min(height - 1, Math.max(0, Math.floor((y / sourceHeight) * height)));
        const maskValue = data[srcY * width + srcX];
        const idx = (y * sourceWidth + x) * 4;
        imageData.data[idx] = 0;
        imageData.data[idx + 1] = Math.round(maskValue * 255);
        imageData.data[idx + 2] = Math.round(maskValue * 255);
        imageData.data[idx + 3] = 160;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildLineFromPoints(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const norm = Math.hypot(dx, dy);

    if (norm < 1e-6) {
      return null;
    }

    const a = dy / norm;
    const b = -dx / norm;
    const c = -(a * p1.x + b * p1.y);
    return { a, b, c };
  }

  function lineDistance(line, point) {
    return Math.abs(line.a * point.x + line.b * point.y + line.c);
  }

  function lineToSlopeIntercept(line) {
    if (Math.abs(line.b) < 1e-6) {
      return {
        slope: Number.POSITIVE_INFINITY,
        intercept: -line.c / line.a,
      };
    }

    return {
      slope: -line.a / line.b,
      intercept: -line.c / line.b,
    };
  }

  function lineAngle(line) {
    return Math.atan2(-line.a, line.b);
  }

  function fitLineLeastSquares(points) {
    const n = points.length;
    if (n < 2) {
      return null;
    }

    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;

    for (const point of points) {
      sumX += point.x;
      sumY += point.y;
      sumXX += point.x * point.x;
      sumXY += point.x * point.y;
    }

    const denominator = n * sumXX - sumX * sumX;
    if (Math.abs(denominator) < 1e-6) {
      const meanX = sumX / n;
      return { a: 1, b: 0, c: -meanX };
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return buildLineFromPoints(
      { x: 0, y: intercept },
      { x: 1, y: slope + intercept },
    );
  }

  function fitDominantLine(points, iterations, threshold) {
    if (points.length < 2) {
      return null;
    }

    let bestLine = null;
    let bestInliers = [];

    for (let i = 0; i < iterations; i += 1) {
      const first = points[(Math.random() * points.length) | 0];
      const second = points[(Math.random() * points.length) | 0];
      const candidate = buildLineFromPoints(first, second);

      if (!candidate) {
        continue;
      }

      const inliers = [];
      for (const point of points) {
        if (lineDistance(candidate, point) < threshold) {
          inliers.push(point);
        }
      }

      if (inliers.length > bestInliers.length) {
        bestLine = candidate;
        bestInliers = inliers;
      }
    }

    if (!bestLine || bestInliers.length < 40) {
      return null;
    }

    return {
      line: fitLineLeastSquares(bestInliers) || bestLine,
      inliers: bestInliers,
    };
  }

  function removeInliers(points, inliers) {
    const keys = new Set(inliers.map((point) => `${point.x}:${point.y}`));
    return points.filter((point) => !keys.has(`${point.x}:${point.y}`));
  }

  function detectLines(points, lineCount) {
    let remaining = points.slice();
    const lines = [];

    for (let i = 0; i < lineCount; i += 1) {
      const result = fitDominantLine(remaining, 250, 3.5);
      if (!result) {
        break;
      }

      lines.push(result.line);
      remaining = removeInliers(remaining, result.inliers);
    }

    return lines;
  }

  function splitLineFamilies(lines) {
    if (lines.length < 4) {
      throw new Error("Not enough detected lines to split into families.");
    }

    const annotated = lines.map((line) => ({
      line,
      angle: lineAngle(line),
    }));

    let bestGroups = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let mask = 1; mask < (1 << annotated.length) - 1; mask += 1) {
      const first = [];
      const second = [];

      for (let i = 0; i < annotated.length; i += 1) {
        if ((mask & (1 << i)) !== 0) {
          first.push(annotated[i]);
        } else {
          second.push(annotated[i]);
        }
      }

      if (first.length < 2 || second.length < 2) {
        continue;
      }

      const firstMean = average(first.map((item) => item.angle));
      const secondMean = average(second.map((item) => item.angle));
      const firstSpread = average(first.map((item) => Math.abs(item.angle - firstMean)));
      const secondSpread = average(second.map((item) => Math.abs(item.angle - secondMean)));
      const familyGap = Math.abs(firstMean - secondMean);

      if (familyGap < 0.35) {
        continue;
      }

      const score = firstSpread + secondSpread;
      if (score < bestScore) {
        bestScore = score;
        bestGroups = [first.map((item) => item.line), second.map((item) => item.line)];
      }
    }

    if (!bestGroups) {
      throw new Error("Could not split lines into two court-edge families.");
    }

    return bestGroups;
  }

  function lineOffset(line, point) {
    return line.a * point.x + line.b * point.y + line.c;
  }

  function selectOuterPair(lines, points) {
    if (lines.length < 2) {
      throw new Error("Not enough lines in family.");
    }

    const candidates = lines.map((line) => {
      const offsets = points.map((point) => lineOffset(line, point));
      const meanOffset = average(offsets);
      return { line, meanOffset };
    });

    let minItem = candidates[0];
    let maxItem = candidates[0];

    for (const item of candidates) {
      if (item.meanOffset < minItem.meanOffset) {
        minItem = item;
      }
      if (item.meanOffset > maxItem.meanOffset) {
        maxItem = item;
      }
    }

    return [minItem.line, maxItem.line];
  }

  function intersectLines(lineA, lineB) {
    const denominator = lineA.a * lineB.b - lineB.a * lineA.b;

    if (Math.abs(denominator) < 1e-6) {
      return null;
    }

    const x = (lineB.c * lineA.b - lineA.c * lineB.b) / denominator;
    const y = (lineA.c * lineB.a - lineB.c * lineA.a) / denominator;

    return { x, y };
  }

  function reorderCornersClockwise(corners) {
    const center = corners.reduce(
      (acc, corner) => ({
        x: acc.x + corner.x / corners.length,
        y: acc.y + corner.y / corners.length,
      }),
      { x: 0, y: 0 },
    );

    const sorted = corners
      .map((corner) => ({
        ...corner,
        angle: Math.atan2(corner.y - center.y, corner.x - center.x),
      }))
      .sort((a, b) => a.angle - b.angle);

    let topLeftIndex = 0;
    let topLeftScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < sorted.length; i += 1) {
      const score = sorted[i].x + sorted[i].y;
      if (score < topLeftScore) {
        topLeftScore = score;
        topLeftIndex = i;
      }
    }

    return sorted
      .slice(topLeftIndex)
      .concat(sorted.slice(0, topLeftIndex))
      .map(({ x, y }) => ({ x, y }));
  }

  function isValidCorner(corner) {
    return (
      corner &&
      Number.isFinite(corner.x) &&
      Number.isFinite(corner.y)
    );
  }

  function validateCorners(corners, limitWidth, limitHeight) {
    if (!Array.isArray(corners) || corners.length !== 4) {
      return false;
    }

    for (const corner of corners) {
      if (!isValidCorner(corner)) {
        return false;
      }

      if (
        corner.x < 0 ||
        corner.y < 0 ||
        corner.x > limitWidth ||
        corner.y > limitHeight
      ) {
        return false;
      }
    }

    const unique = new Set(
      corners.map((corner) => `${Math.round(corner.x)}:${Math.round(corner.y)}`),
    );
    return unique.size === 4;
  }

  function scaleCorners(corners, scaleX, scaleY, limitWidth, limitHeight) {
    return corners.map((corner) => ({
      x: clamp(corner.x * scaleX, 0, limitWidth),
      y: clamp(corner.y * scaleY, 0, limitHeight),
    }));
  }

  function polygonArea(corners) {
    let area = 0;
    for (let i = 0; i < corners.length; i += 1) {
      const next = corners[(i + 1) % corners.length];
      area += corners[i].x * next.y - next.x * corners[i].y;
    }
    return Math.abs(area) / 2;
  }

  function estimateCornersFromMaskExtremes(
    points,
    sourceWidth,
    sourceHeight,
    scaleX,
    scaleY,
    limitWidth,
    limitHeight,
  ) {
    if (points.length < MIN_POINT_COUNT) {
      throw new Error("Not enough mask points for corner estimation.");
    }

    let topLeft = points[0];
    let topRight = points[0];
    let bottomRight = points[0];
    let bottomLeft = points[0];

    for (const point of points) {
      if (point.x + point.y < topLeft.x + topLeft.y) {
        topLeft = point;
      }
      if (point.x - point.y > topRight.x - topRight.y) {
        topRight = point;
      }
      if (point.x + point.y > bottomRight.x + bottomRight.y) {
        bottomRight = point;
      }
      if (point.x - point.y < bottomLeft.x - bottomLeft.y) {
        bottomLeft = point;
      }
    }

    const corners = reorderCornersClockwise([
      topLeft,
      topRight,
      bottomRight,
      bottomLeft,
    ]);

    if (!validateCorners(corners, sourceWidth, sourceHeight)) {
      throw new Error("Extreme-point corners are invalid.");
    }

    const area = polygonArea(corners);
    debugLog("mask extreme corners", {
      corners: corners.map((corner) => ({
        x: Number(corner.x.toFixed(2)),
        y: Number(corner.y.toFixed(2)),
      })),
      area: Number(area.toFixed(2)),
    });

    if (area < sourceWidth * sourceHeight * 0.08) {
      throw new Error("Extreme-point quadrilateral is too small.");
    }

    const scaledCorners = scaleCorners(
      corners,
      scaleX,
      scaleY,
      limitWidth,
      limitHeight,
    );

    if (!validateCorners(scaledCorners, limitWidth, limitHeight)) {
      throw new Error("Scaled extreme-point corners are invalid.");
    }

    return scaledCorners;
  }

  function detectCornersFromPoints(
    points,
    scaleX,
    scaleY,
    limitWidth,
    limitHeight,
  ) {
    debugLog("corner input point count", points.length);

    if (points.length < MIN_POINT_COUNT) {
      throw new Error("Not enough court-line points were found.");
    }

    const lines = detectLines(points, 8);
    debugLog(
      "detected line count",
      lines.map((line) => ({
        a: Number(line.a.toFixed(4)),
        b: Number(line.b.toFixed(4)),
        c: Number(line.c.toFixed(2)),
      })),
    );

    if (lines.length < 4) {
      throw new Error("Could not fit enough dominant court lines.");
    }

    const [familyA, familyB] = splitLineFamilies(lines);
    const pairA = selectOuterPair(familyA, points);
    const pairB = selectOuterPair(familyB, points);

    debugLog("selected outer families", {
      familyA: familyA.length,
      familyB: familyB.length,
      pairA: pairA.map((line) => ({
        a: Number(line.a.toFixed(4)),
        b: Number(line.b.toFixed(4)),
        c: Number(line.c.toFixed(2)),
      })),
      pairB: pairB.map((line) => ({
        a: Number(line.a.toFixed(4)),
        b: Number(line.b.toFixed(4)),
        c: Number(line.c.toFixed(2)),
      })),
    });

    const intersections = [];

    for (const lineA of pairA) {
      for (const lineB of pairB) {
        const point = intersectLines(lineA, lineB);
        if (point) {
          intersections.push(point);
        }
      }
    }

    if (intersections.length !== 4) {
      throw new Error("Could not compute all four court corners.");
    }

    const ordered = scaleCorners(
      reorderCornersClockwise(intersections),
      scaleX,
      scaleY,
      limitWidth,
      limitHeight,
    );

    if (!validateCorners(ordered, limitWidth, limitHeight)) {
      throw new Error("Detected corners are invalid.");
    }

    debugLog("ordered corners", ordered);

    return ordered;
  }

  function summarizeOutputs(outputs) {
    return Object.fromEntries(
      Object.entries(outputs).map(([name, tensor]) => [
        name,
        {
          dims: tensor.dims,
          type: tensor.type,
          size: tensor.size,
        },
      ]),
    );
  }

  function lineSummary(lines) {
    return lines.map((line) => ({
      a: Number(line.a.toFixed(4)),
      b: Number(line.b.toFixed(4)),
      c: Number(line.c.toFixed(2)),
    }));
  }

  async function detectWithModel(video) {
    const frame = resizeFrameToCanvas(video);
    const session = await getModelSession();
    const inputName = getSessionInputName(session);
    const tensorData = createInputTensor(frame.ctx, frame.width, frame.height);
    const inputTensor = new window.ort.Tensor(
      "float32",
      tensorData,
      [1, 3, frame.height, frame.width],
    );

    const outputs = await session.run({ [inputName]: inputTensor });
    const outputSummary = summarizeOutputs(outputs);
    debugLog("raw model outputs", outputSummary);

    const detectionTensor = selectDetectionTensor(outputs);
    const protoTensor = selectProtoTensor(outputs);

    if (!detectionTensor || !protoTensor) {
      throw new Error("Unexpected ONNX outputs. Expected YOLO segmentation tensors.");
    }

    const detection = parsePredictions(detectionTensor, protoTensor);
    const mask = decodeMask(protoTensor, detection);
    const maskPoints = collectMaskPoints(mask, frame.width, frame.height);
    const points = collectBoundaryPointsFromMask(mask, frame.width, frame.height);
    debugLog("mask fill point count", maskPoints.length);
    debugLog("mask boundary point count", points.length);

    setDebugSnapshot({
      phase: "mask-decoded",
      outputs: outputSummary,
      topDetection: {
        score: Number(detection.score.toFixed(4)),
        x1: Number(detection.x1.toFixed(2)),
        y1: Number(detection.y1.toFixed(2)),
        x2: Number(detection.x2.toFixed(2)),
        y2: Number(detection.y2.toFixed(2)),
      },
      maskFillPointCount: maskPoints.length,
      maskBoundaryPointCount: points.length,
      maskCanvas: createDebugMaskCanvas(mask, frame.width, frame.height).toDataURL(),
    });

    try {
      const corners = estimateCornersFromMaskExtremes(
        maskPoints,
        frame.width,
        frame.height,
        frame.scaleX,
        frame.scaleY,
        video.clientWidth,
        video.clientHeight,
      );
      setDebugSnapshot({
        ...debugSnapshot,
        phase: "mask-extremes-success",
        corners,
      });
      return corners;
    } catch (error) {
      debugLog("mask extreme corner estimation failed", {
        message: error.message,
      });
    }

    const corners = detectCornersFromPoints(
      points,
      frame.scaleX,
      frame.scaleY,
      video.clientWidth,
      video.clientHeight,
    );
    setDebugSnapshot({
      ...debugSnapshot,
      phase: "line-fallback-success",
      corners,
    });
    return corners;
  }

  function detectWithHeuristics(video) {
    const frame = resizeFrameToCanvas(video);
    const imageData = frame.ctx.getImageData(0, 0, frame.width, frame.height);
    const points = collectCourtLinePointsFromImage(imageData, frame.width, frame.height);
    debugLog("heuristic point count", points.length);

    return detectCornersFromPoints(
      points,
      frame.scaleX,
      frame.scaleY,
      video.clientWidth,
      video.clientHeight,
    );
  }

  async function detect(video) {
    try {
      debugLog("trying ONNX model inference");
      return await detectWithModel(video);
    } catch (error) {
      console.warn("Model-based court detection failed, falling back to heuristics.", error);
      debugLog("model inference failed", {
        message: error.message,
        stack: error.stack,
      });
      return detectWithHeuristics(video);
    }
  }

  async function warmup() {
    try {
      await getModelSession();
      return { ready: true, mode: "onnx" };
    } catch (error) {
      return { ready: false, mode: "heuristic", error: error.message };
    }
  }

  return { detect, warmup };
}

window.createCourtDetector = createCourtDetector;
