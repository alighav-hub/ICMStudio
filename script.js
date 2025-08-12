/* Motion Blur Spline Image Editor */
(() => {
  const outputCanvas = document.getElementById('outputCanvas');
  const outputCtx = outputCanvas.getContext('2d');
  const splineCanvas = document.getElementById('splineCanvas');
  const splineCtx = splineCanvas.getContext('2d');
  const fileInput = document.getElementById('fileInput');
  const blurSizeSlider = document.getElementById('blurSize');
  const blurSizeVal = document.getElementById('blurSizeVal');
  const rotationSlider = document.getElementById('rotation');
  const rotationVal = document.getElementById('rotationVal');
  const uploadHint = document.getElementById('uploadHint');
  const originalCanvas = document.getElementById('originalCanvas');
  const originalCtx = originalCanvas.getContext('2d');

  const exportActualBtn = document.getElementById('exportActual');
  const exportMediumBtn = document.getElementById('exportMedium');
  const exportSmallBtn = document.getElementById('exportSmall');

  // State
  let originalImage = null; // HTMLImageElement
  let resizedImageBitmap = null; // ImageBitmap for performance
  let displayWidth = 0;
  let displayHeight = 0;
  

  // Spline state
  const splineFrameSize = 300; // canvas is 300x300
  const mobileFrameSize = 200; // target logical size for initial points area
  let basePoints = [ // initial 3 points inside ~200x200 area centered
    { x: 50, y: 150 },
    { x: 150, y: 50 },
    { x: 250, y: 150 },
  ];
  // Keep original (unrotated) base points to apply rotation relative to original
  const basePointsOriginal = basePoints.map(p => ({ x: p.x, y: p.y }));
  let rotatedPoints = basePoints.map(p => ({ x: p.x, y: p.y }));
  let selectedPointIndex = -1;
  let isDragging = false;
  let lastTapTime = 0;

  // UI init
  blurSizeVal.textContent = `${blurSizeSlider.value} px`;
  rotationVal.textContent = `${rotationSlider.value}°`;

  // Helpers
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist2(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return dx*dx + dy*dy; }
  function distance(a, b) { return Math.sqrt(dist2(a, b)); }

  function pointToSegmentDistance(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const abLen2 = abx * abx + aby * aby || 1;
    let t = (apx * abx + apy * aby) / abLen2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    return Math.hypot(p.x - cx, p.y - cy);
  }

  function setCanvasSizeForDisplay(canvas, width, height) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${Math.round(width)}px`;
    canvas.style.height = `${Math.round(height)}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function autoSizeCanvases() {
    // Fit within container with max width 800 and maintain aspect ratio, optimized for mobile
    const maxW = Math.min(800, Math.floor(window.innerWidth - 24));
    if (!originalImage) {
      const h = Math.max(200, Math.floor(maxW * 0.66));
      setCanvasSizeForDisplay(outputCanvas, maxW, h);
      setCanvasSizeForDisplay(originalCanvas, maxW, h);
      return;
    }
    const ratio = originalImage.width / originalImage.height;
    displayWidth = Math.min(maxW, originalImage.width);
    displayHeight = Math.round(displayWidth / ratio);
    setCanvasSizeForDisplay(outputCanvas, displayWidth, displayHeight);
    setCanvasSizeForDisplay(originalCanvas, displayWidth, displayHeight);
  }

  function resizeSourceToDisplay() {
    if (!originalImage) return;
    const ratio = originalImage.width / originalImage.height;
    const maxW = Math.min(800, Math.floor(window.innerWidth - 24));
    displayWidth = Math.min(maxW, originalImage.width);
    displayHeight = Math.round(displayWidth / ratio);
    if (resizedImageBitmap) resizedImageBitmap.close?.();
    const tmp = document.createElement('canvas');
    tmp.width = displayWidth;
    tmp.height = displayHeight;
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(originalImage, 0, 0, displayWidth, displayHeight);
    return createImageBitmap(tmp);
  }

  function drawSplineEditor() {
    const ctx = splineCtx;
    const W = splineCanvas.width; // these are CSS-adjusted by setTransform; width/height are device pixels but we use transform
    const H = splineCanvas.height;
    // Clear
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);
    ctx.restore();

    // Draw background grid / frame
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 300; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 300); ctx.stroke();
    }
    for (let y = 0; y <= 300; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(300, y); ctx.stroke();
    }

    // Draw Catmull-Rom spline
    const pts = rotatedPoints;
    if (pts.length >= 2) {
      const smooth = sampleCatmullRom(pts, 200);
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--path') || '#ccc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(smooth[0].x, smooth[0].y);
      for (let i = 1; i < smooth.length; i++) ctx.lineTo(smooth[i].x, smooth[i].y);
      ctx.stroke();
    }

    // Draw points
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--point') || '#e74c3c';
    const size = 5;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.fillRect(p.x - size/2, p.y - size/2, size, size);
    }
  }

  function sampleCatmullRom(points, samples) {
    // Open Catmull-Rom; extrapolate endpoints
    if (points.length === 2) return points.slice();
    const pts = points;
    const result = [];
    // Build segment lengths to map samples evenly along total length
    const segs = [];
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = distance(pts[i], pts[i+1]);
      segs.push(len);
      totalLen += len;
    }
    if (totalLen === 0) return pts.slice();
    for (let s = 0; s < samples; s++) {
      const t = (s) / (samples - 1);
      const targetDist = t * totalLen;
      let accum = 0;
      let segIndex = 0;
      for (; segIndex < segs.length; segIndex++) {
        if (accum + segs[segIndex] >= targetDist) break;
        accum += segs[segIndex];
      }
      const localT = segs[segIndex] === 0 ? 0 : (targetDist - accum) / segs[segIndex];
      const i1 = segIndex;
      const i2 = Math.min(segIndex + 1, pts.length - 1);
      const p0 = pts[i1 - 1] || mirrorPoint(pts[i1], pts[i2]);
      const p1 = pts[i1];
      const p2 = pts[i2];
      const p3 = pts[i2 + 1] || mirrorPoint(pts[i2], pts[i1]);
      result.push(catmullRom(p0, p1, p2, p3, localT));
    }
    return result;
  }

  function mirrorPoint(center, other) {
    // point mirrored across center: center + (center - other)
    return { x: center.x + (center.x - other.x), y: center.y + (center.y - other.y) };
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    // Catmull-Rom with tension 0.5 (centripetal not applied here)
    const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x) * t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x) * t3);
    const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y) * t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y) * t3);
    return { x, y };
  }

  function rotatePointsAroundCenter(angleDeg) {
    const angle = (angleDeg * Math.PI) / 180;
    const cx = splineFrameSize / 2;
    const cy = splineFrameSize / 2;
    rotatedPoints = basePointsOriginal.map(p => rotatePoint(p, cx, cy, angle));
  }

  function rotatePoint(p, cx, cy, angle) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  function resetBaseOriginalFromCurrent() {
    for (let i = 0; i < basePointsOriginal.length; i++) {
      basePointsOriginal[i].x = basePoints[i].x;
      basePointsOriginal[i].y = basePoints[i].y;
    }
  }

  function addPointAtPosition(pos) {
    // Work in rotated space for proximity to user's view
    const angle = (parseFloat(rotationSlider.value) * Math.PI) / 180;
    const cx = splineFrameSize / 2;
    const cy = splineFrameSize / 2;

    // Reject if closer than 10 px to any rotated point
    for (const rp of rotatedPoints) {
      if (distance(rp, pos) < 10) return false;
    }

    // Find best adjacent segment by minimal distance from pos to segment in rotated space
    let bestSegIndex = 0;
    let bestSegDist = Infinity;
    for (let i = 0; i < rotatedPoints.length - 1; i++) {
      const a = rotatedPoints[i];
      const b = rotatedPoints[i + 1];
      const segDist = pointToSegmentDistance(pos, a, b);
      if (segDist < bestSegDist) {
        bestSegDist = segDist;
        bestSegIndex = i;
      }
    }

    // Convert clicked rotated position back to original coordinate space
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const oPos = { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };

    // Insert between bestSegIndex and bestSegIndex+1
    const insertAt = bestSegIndex + 1;
    basePoints.splice(insertAt, 0, { x: oPos.x, y: oPos.y });
    basePointsOriginal.splice(insertAt, 0, { x: oPos.x, y: oPos.y });
    applyRotationAndUpdate();
    return true;
  }

  function removePointAtIndex(idx) {
    if (basePoints.length <= 2) return false; // keep at least two points
    basePoints.splice(idx, 1);
    basePointsOriginal.splice(idx, 1);
    applyRotationAndUpdate();
    return true;
  }

  function findPointAtPosition(pos, radius = 6) {
    for (let i = 0; i < rotatedPoints.length; i++) {
      const p = rotatedPoints[i];
      if (Math.abs(p.x - pos.x) <= radius && Math.abs(p.y - pos.y) <= radius) {
        return i;
      }
    }
    return -1;
  }

  function toLocalPos(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    const clientX = (evt.touches ? evt.touches[0].clientX : evt.clientX);
    const clientY = (evt.touches ? evt.touches[0].clientY : evt.clientY);
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onSplinePointerDown(evt) {
    evt.preventDefault();
    const pos = toLocalPos(evt, splineCanvas);
    const idx = findPointAtPosition(pos, 8);

    const now = Date.now();
    if (idx !== -1 && now - lastTapTime < 300) {
      // Double tap/click to remove
      removePointAtIndex(idx);
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (idx !== -1) {
      selectedPointIndex = idx;
      isDragging = true;
    } else {
      addPointAtPosition(pos);
    }
  }

  function onSplinePointerMove(evt) {
    if (!isDragging || selectedPointIndex === -1) return;
    evt.preventDefault();
    const pos = toLocalPos(evt, splineCanvas);

    // Move the corresponding base point so rotation is reapplied from original
    // Determine mapping: rotatedPoints[i] corresponds to basePointsOriginal[i] rotated by current angle
    // To preserve rotation relative application, update basePointsOriginal then re-derive basePoints by inverse rotation
    const angle = (parseFloat(rotationSlider.value) * Math.PI) / 180;
    const cx = splineFrameSize / 2;
    const cy = splineFrameSize / 2;

    // Convert rotated position back to original coordinates by rotating by -angle
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const ox = cx + dx * cos - dy * sin;
    const oy = cy + dx * sin + dy * cos;

    basePointsOriginal[selectedPointIndex].x = clamp(ox, 0, splineFrameSize);
    basePointsOriginal[selectedPointIndex].y = clamp(oy, 0, splineFrameSize);

    // Sync working base points and rotated points
    for (let i = 0; i < basePoints.length; i++) {
      basePoints[i].x = basePointsOriginal[i].x;
      basePoints[i].y = basePointsOriginal[i].y;
    }
    applyRotationAndUpdate();
  }

  function onSplinePointerUp(evt) {
    if (isDragging) {
      isDragging = false;
      selectedPointIndex = -1;
    }
  }

  function applyRotationAndUpdate() {
    rotatePointsAroundCenter(parseFloat(rotationSlider.value));
    drawSplineEditor();
    redrawOutput();
  }

  function setRotation(valueDeg) {
    rotationSlider.value = String(Math.round(valueDeg));
    rotationVal.textContent = `${rotationSlider.value}°`;
    applyRotationAndUpdate();
  }

  function setBlurSize(valuePx) {
    blurSizeSlider.value = String(Math.round(valuePx));
    blurSizeVal.textContent = `${blurSizeSlider.value} px`;
    redrawOutput();
  }

  function computeSplineDirectionSamples(count) {
    const pts = rotatedPoints;
    if (pts.length < 2) return Array(count).fill({ x: 1, y: 0 });
    // Build path samples along the spline, normalized direction vectors
    const smooth = sampleCatmullRom(pts, count);
    const dirs = [];
    for (let i = 0; i < smooth.length - 1; i++) {
      const a = smooth[i], b = smooth[i+1];
      let dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      dirs.push({ x: dx, y: dy });
    }
    // Duplicate last direction for equal length arrays
    if (dirs.length > 0) dirs.push(dirs[dirs.length - 1]);
    return dirs;
  }

  function extendImageEdges(ctx, srcCanvas, blurRadius) {
    // Create a larger canvas with repeated edge pixels by blurRadius on all sides
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const extW = w + blurRadius * 2;
    const extH = h + blurRadius * 2;

    ctx.canvas.width = extW;
    ctx.canvas.height = extH;

    // Fill center
    ctx.drawImage(srcCanvas, blurRadius, blurRadius);

    // Top and bottom strips
    ctx.drawImage(srcCanvas, 0, 0, w, 1, blurRadius, 0, w, blurRadius); // top repeat
    ctx.drawImage(srcCanvas, 0, h - 1, w, 1, blurRadius, blurRadius + h, w, blurRadius); // bottom repeat

    // Left and right strips
    ctx.drawImage(srcCanvas, 0, 0, 1, h, 0, blurRadius, blurRadius, h); // left repeat
    ctx.drawImage(srcCanvas, w - 1, 0, 1, h, blurRadius + w, blurRadius, blurRadius, h); // right repeat

    // Corners
    // top-left
    ctx.drawImage(srcCanvas, 0, 0, 1, 1, 0, 0, blurRadius, blurRadius);
    // top-right
    ctx.drawImage(srcCanvas, w - 1, 0, 1, 1, blurRadius + w, 0, blurRadius, blurRadius);
    // bottom-left
    ctx.drawImage(srcCanvas, 0, h - 1, 1, 1, 0, blurRadius + h, blurRadius, blurRadius);
    // bottom-right
    ctx.drawImage(srcCanvas, w - 1, h - 1, 1, 1, blurRadius + w, blurRadius + h, blurRadius, blurRadius);

    return { width: extW, height: extH };
  }

  function redrawOutput() {
    if (!originalImage || !resizedImageBitmap) {
      // Clear and hint
      autoSizeCanvases();
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
      return;
    }

    const blurSize = parseInt(blurSizeSlider.value, 10);
    setCanvasSizeForDisplay(outputCanvas, displayWidth, displayHeight);
    setCanvasSizeForDisplay(originalCanvas, displayWidth, displayHeight);
    originalCtx.clearRect(0, 0, displayWidth, displayHeight);
    originalCtx.drawImage(resizedImageBitmap, 0, 0);

    // Prepare a source canvas (resized image)
    const src = document.createElement('canvas');
    src.width = displayWidth;
    src.height = displayHeight;
    const sctx = src.getContext('2d');
    sctx.drawImage(resizedImageBitmap, 0, 0);

    // Extend edges to avoid transparency at movement direction
    const extCanvas = document.createElement('canvas');
    const extCtx = extCanvas.getContext('2d');
    extendImageEdges(extCtx, src, blurSize);

    // Sampling along spline: we will offset draws by fragments along the spline direction
    const numSamples = 20;
    const dirs = computeSplineDirectionSamples(numSamples);

    // Average with alpha normalization
    outputCtx.clearRect(0, 0, displayWidth, displayHeight);

    // Render samples with offsets from -0.5 to +0.5 to center the blur
    const alphaPerSample = 1 / numSamples;
    outputCtx.globalAlpha = 1;

    for (let i = 0; i < numSamples; i++) {
      const f = (i / (numSamples - 1)) - 0.5; // -0.5..0.5
      const dir = dirs[i] || { x: 1, y: 0 };
      const offX = Math.round(dir.x * blurSize * f);
      const offY = Math.round(dir.y * blurSize * f);

      outputCtx.globalAlpha = alphaPerSample; // normalization to keep brightness similar
      outputCtx.drawImage(
        extCanvas,
        blurSize + offX, blurSize + offY, displayWidth, displayHeight,
        0, 0, displayWidth, displayHeight
      );
    }

    outputCtx.globalAlpha = 1;
  }

  function triggerFileDialog() { fileInput.click(); }

  function onFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      originalImage = img;
      uploadHint.style.display = 'none';
      await resizeAndRender();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  }

  async function resizeAndRender() {
    autoSizeCanvases();
    resizedImageBitmap = await resizeSourceToDisplay();
    redrawOutput();
  }

  function exportImage(scaleFactor) {
    if (!originalImage || !resizedImageBitmap) return;
    // Render the current effect at scaled size
    const targetW = Math.round(displayWidth * scaleFactor);
    const targetH = Math.round(displayHeight * scaleFactor);

    // Prepare resized source at target
    const src = document.createElement('canvas');
    src.width = targetW;
    src.height = targetH;
    const sctx = src.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(originalImage, 0, 0, targetW, targetH);

    const blurSize = parseInt(blurSizeSlider.value, 10) * scaleFactor;

    const extCanvas = document.createElement('canvas');
    const extCtx = extCanvas.getContext('2d');
    extendImageEdges(extCtx, src, Math.ceil(blurSize));

    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const octx = out.getContext('2d');

    const numSamples = 20;
    const dirs = computeSplineDirectionSamples(numSamples);

    const alphaPerSample = 1 / numSamples;

    for (let i = 0; i < numSamples; i++) {
      const f = (i / (numSamples - 1)) - 0.5;
      const dir = dirs[i] || { x: 1, y: 0 };
      const offX = Math.round(dir.x * blurSize * f);
      const offY = Math.round(dir.y * blurSize * f);

      octx.globalAlpha = alphaPerSample;
      octx.drawImage(
        extCanvas,
        Math.ceil(blurSize) + offX, Math.ceil(blurSize) + offY, targetW, targetH,
        0, 0, targetW, targetH
      );
    }
    octx.globalAlpha = 1;

    const link = document.createElement('a');
    link.download = `motion-blur-${Date.now()}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  }

  // Event bindings
  outputCanvas.addEventListener('click', triggerFileDialog);
  originalCanvas.addEventListener('click', triggerFileDialog);
  outputCanvas.addEventListener('touchend', (e) => { e.preventDefault(); triggerFileDialog(); }, { passive: false });
  originalCanvas.addEventListener('touchend', (e) => { e.preventDefault(); triggerFileDialog(); }, { passive: false });
  fileInput.addEventListener('change', onFileSelected);

  blurSizeSlider.addEventListener('input', () => setBlurSize(parseInt(blurSizeSlider.value, 10)));
  rotationSlider.addEventListener('input', () => setRotation(parseFloat(rotationSlider.value)));

  // Spline interactions (mouse and touch)
  splineCanvas.addEventListener('mousedown', onSplinePointerDown);
  window.addEventListener('mousemove', onSplinePointerMove);
  window.addEventListener('mouseup', onSplinePointerUp);

  splineCanvas.addEventListener('touchstart', onSplinePointerDown, { passive: false });
  window.addEventListener('touchmove', onSplinePointerMove, { passive: false });
  window.addEventListener('touchend', onSplinePointerUp, { passive: false });

  // Export buttons
  exportActualBtn.addEventListener('click', () => exportImage(1));
  exportMediumBtn.addEventListener('click', () => exportImage(0.5));
  exportSmallBtn.addEventListener('click', () => exportImage(0.25));

  // Initialize spline canvas DPR scaling
  function initSplineCanvas() {
    const dpr = window.devicePixelRatio || 1;
    splineCanvas.width = Math.round(300 * dpr);
    splineCanvas.height = Math.round(300 * dpr);
    splineCanvas.style.width = '300px';
    splineCanvas.style.height = '300px';
    splineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', () => {
    autoSizeCanvases();
    if (originalImage) redrawOutput();
  });

  // Startup
  initSplineCanvas();
  rotatePointsAroundCenter(0);
  drawSplineEditor();
  autoSizeCanvases();
})();