// viz.js — 2.5D Atom Electrons Visualizer (Kr config 2,8,18,8)
// - 36 electrons in 4 shells: 2 / 8 / 18 / 8
// - Each electron maps to a frequency band (log-frequency mapping)
// - Color = frequency (hue), brightness/size/trail = amplitude
// - 2.5D depth: electrons have pseudo-z -> scale/alpha + depth sorting
// - Stable sizing: getBoundingClientRect + DPR + QoS scale
// - SAFE radii to avoid clipping

const audio  = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx    = canvas.getContext("2d");

// =======================
// Public toggle API
// =======================
export let VIZ_ENABLED = false;

export function setVizEnabled(v) {
  VIZ_ENABLED = !!v;

  if (!VIZ_ENABLED) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    try { ctx.setTransform(1,0,0,1,0,0); } catch {}
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (!audio.paused && !audio.ended) {
    ensureAudioGraph();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (rafId) cancelAnimationFrame(rafId);
    lastT = 0;
    draw(0);
  }
}

export function getVizEnabled() {
  return VIZ_ENABLED;
}

// =======================
// Config
// =======================
const CFG = {
  // Visual
  trailAlpha: 0.10,        // lower = longer trails
  glowMax: 26,
  electronBaseSize: 2.6,
  electronSizeGain: 5.2,
  tailBase: 10,
  tailGain: 46,

  // Shell (Kr): 2, 8, 18, 8  => 36
  shells: [2, 8, 18, 8],

  // Orbit layout (relative to safe ring radius)
  orbitMin: 0.38,
  orbitMax: 0.62,
  shellGapJitter: 12,      // px jitter from energy
  orbitEccMin: 0.10,
  orbitEccMax: 0.28,

  // 2.5D projection
  zDepth: 0.85,            // overall depth strength
  zTiltY: 0.32,            // perspective tilt on Y
  zScaleMin: 0.70,
  zScaleMax: 1.15,
  zAlphaMin: 0.25,
  zAlphaMax: 1.00,

  // Motion
  baseSpeed: 0.55,         // base angular speed
  speedGain: 1.25,         // amplitude adds speed
  shellSpeedMul: [0.75, 1.00, 1.15, 1.30], // inner slower, outer faster

  // Frequency mapping
  freqGamma: 2.0,          // log-frequency mapping exponent (>=1)
  smoothing: 0.76,

  // Center nucleus (keep a subtle nucleus glow)
  nucleusRatio: 0.22,
  nucleusGlow: 120,
  nucleusAlpha: 0.20,

  // Progress ring
  progressWidthBg: 12,
  progressWidthFg: 10,
};

// Auto QoS (does not change electron count)
const QoS = {
  minFps: 50,
  maxFps: 58,
  scale: 1.0,
  minScale: 0.70,
  maxScale: 1.20,
  maxShadowBlur: 24,
};

// =======================
// Audio graph
// =======================
let audioCtx, analyser, srcNode;
let dataFreq;

// =======================
// State
// =======================
let rafId = null;
let lastT = 0;

let __cssW = 0, __cssH = 0;
let __fps_t = 0, __fps_frames = 0, __fps_val = 60;

// electrons array
let electrons = null;

// =======================
// Utilities
// =======================
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function trackFPS(now){
  if (!__fps_t) __fps_t = now;
  __fps_frames++;
  const dt = now - __fps_t;
  if (dt >= 500){
    __fps_val = (__fps_frames * 1000) / dt;
    __fps_frames = 0;
    __fps_t = now;
    if (__fps_val < QoS.minFps) QoS.scale = Math.max(QoS.minScale, QoS.scale - 0.05);
    else if (__fps_val > QoS.maxFps) QoS.scale = Math.min(QoS.maxScale, QoS.scale + 0.05);
  }
}

// log-frequency mapping (power-law approximation)
function logMapIndex(t, n, gamma) {
  const tt = clamp01(t);
  const g = Math.max(1.0001, Number(gamma) || 2.0);
  const idx = Math.floor(Math.pow(tt, g) * (n - 1));
  return Math.max(0, Math.min(n - 1, idx));
}

// =======================
// Canvas sizing
// =======================
function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  __cssW = cssW; __cssH = cssH;

  const rawDpr = window.devicePixelRatio || 1;
  const dpr = Math.max(1, Math.min(1.6, rawDpr));
  const scale = dpr * QoS.scale;

  const needW = Math.floor(cssW * scale);
  const needH = Math.floor(cssH * scale);

  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
  }

  // draw in CSS logical pixels
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function ensureAudioGraph() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = CFG.smoothing;

  srcNode = audioCtx.createMediaElementSource(audio);
  srcNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  dataFreq = new Uint8Array(analyser.frequencyBinCount);

  resizeCanvasToDisplaySize();
}

// =======================
// Electrons init (Kr shells)
// =======================
function initElectrons() {
  const shells = CFG.shells.slice();
  const total = shells.reduce((a,b)=>a+b, 0);
  if (total !== 36) {
    // still proceed, but your config expected 36
    console.warn("Electron total != 36:", total);
  }

  electrons = [];
  let globalIndex = 0;

  for (let s = 0; s < shells.length; s++) {
    const count = shells[s];

    // Each shell has its own orbital plane tilt / phase (fake 3D variety)
    const plane = {
      tiltX: (Math.random() * 0.6 - 0.3),
      tiltY: (Math.random() * 0.6 - 0.3),
      phi: Math.random() * Math.PI * 2,
    };

    for (let j = 0; j < count; j++) {
      const t = (total <= 1) ? 0 : (globalIndex / (total - 1)); // 0..1 low->high
      const hue = 260 - 240 * t; // low freq purple -> high freq green/yellow

      electrons.push({
        shell: s,
        j,
        tFreq: t,
        hue,
        // angle spread evenly but with per-shell offset
        a: (j / count) * Math.PI * 2 + Math.random() * 0.25,
        // base angular velocity
        w: CFG.baseSpeed * (CFG.shellSpeedMul[s] ?? 1.0) * (0.85 + 0.30 * Math.random()),
        // ellipse eccentricity
        ecc: lerp(CFG.orbitEccMin, CFG.orbitEccMax, Math.random()),
        // per-electron phase for depth
        phi: Math.random() * Math.PI * 2,
        // plane
        plane,
        // smoothed energy
        e: 0,
      });

      globalIndex++;
    }
  }
}

// =======================
// Drawing
// =======================
function draw(now = 0) {
  if (!VIZ_ENABLED) return;
  if (!analyser) return;

  trackFPS(now);

  const W = __cssW || Math.round(canvas.getBoundingClientRect().width) || 1;
  const H = __cssH || Math.round(canvas.getBoundingClientRect().height) || 1;
  resizeCanvasToDisplaySize();

  const cx = W / 2, cy = H / 2;
  const short = Math.min(W, H);
  const half = short / 2;

  const dt = lastT ? (now - lastT) / 1000 : 0;
  lastT = now;

  analyser.getByteFrequencyData(dataFreq);

  // Ensure electrons
  if (!electrons) initElectrons();

  // Accent
  const ACCENT = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#bb71f3";

  // ----- TRAIL: fade previous frame slightly (glowy motion)
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0,0,0,${CFG.trailAlpha})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // ==============================
  // SAFE radii (avoid clipping)
  // ==============================
  const progressPad = 16;
  const electronPad = 20;
  const shadowPad = Math.min(24, QoS.maxShadowBlur);
  const edgePad = progressPad + electronPad + shadowPad + 8;

  const ring = Math.max(12, half - edgePad);

  // Shell radii (inside ring)
  const rMin = ring * CFG.orbitMin;
  const rMax = ring * CFG.orbitMax;

  // Nucleus
  const nucleusR = Math.max(8, short * CFG.nucleusRatio);

  // =======================
  // Nucleus glow (subtle)
  // =======================
  (function drawNucleus() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = CFG.nucleusAlpha;

    const grad = ctx.createRadialGradient(cx, cy, nucleusR * 0.2, cx, cy, nucleusR * 1.35);
    grad.addColorStop(0.00, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.35, `rgba(187,113,243,0.22)`);
    grad.addColorStop(1.00, "rgba(0,0,0,0)");

    ctx.fillStyle = grad;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = Math.min(QoS.maxShadowBlur, CFG.nucleusGlow);

    ctx.beginPath();
    ctx.arc(cx, cy, nucleusR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  })();

  // =======================
  // Compute per-electron positions (with pseudo-z), then depth-sort
  // =======================
  const total = electrons.length;
  const shells = CFG.shells;
  const shellCount = shells.length;

  // Precompute shell base radii
  const shellBase = new Array(shellCount);
  for (let s = 0; s < shellCount; s++) {
    const tt = (shellCount <= 1) ? 0 : (s / (shellCount - 1));
    shellBase[s] = lerp(rMin, rMax, tt);
  }

  // Update energies and positions
  const drawList = new Array(total);
  for (let i = 0; i < total; i++) {
    const el = electrons[i];

    // Map frequency -> amplitude
    const idx = logMapIndex(el.tFreq, dataFreq.length, CFG.freqGamma);
    const v = dataFreq[idx] / 255; // 0..1
    el.e = lerp(el.e, v, 0.22);

    // Orbit radius + energy jitter
    const baseR = shellBase[el.shell];
    const r = baseR + el.e * CFG.shellGapJitter * (0.5 + 0.5 * Math.sin(el.phi + now * 0.001));

    // Update angle: energy increases speed a bit
    el.a += (el.w * (1 + CFG.speedGain * el.e)) * dt;

    // Ellipse in local plane
    const ca = Math.cos(el.a);
    const sa = Math.sin(el.a);
    const rx = r * (1 + el.ecc);
    const ry = r * (1 - el.ecc);

    // Local 3D-ish point
    let x = ca * rx;
    let y = sa * ry;

    // Pseudo-z uses phase + angle for depth movement
    let z = Math.sin(el.a + el.phi);

    // Apply shell plane tilt (fake 3D: rotate a bit)
    const px = el.plane.tiltX;
    const py = el.plane.tiltY;
    // tilt affects how much z influences x/y
    x += z * px * r * 0.25;
    y += z * py * r * 0.25;

    // Project 2.5D: z shifts y + affects scale/alpha
    const zN = (z * CFG.zDepth + 1) * 0.5; // 0..1
    const scale = lerp(CFG.zScaleMin, CFG.zScaleMax, zN);
    const alphaZ = lerp(CFG.zAlphaMin, CFG.zAlphaMax, zN);

    const X = cx + x;
    const Y = cy + y + (zN - 0.5) * CFG.zTiltY * r * 0.55;

    drawList[i] = {
      el,
      X, Y,
      zN,
      scale,
      alphaZ,
      // sort key: back first
      sortZ: zN,
    };
  }

  // Depth sort (back -> front)
  drawList.sort((a, b) => a.sortZ - b.sortZ);

  // =======================
  // Draw orbit rings (subtle)
  // =======================
  (function drawOrbits() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.4;

    for (let s = 0; s < shellCount; s++) {
      const rr = shellBase[s];
      ctx.strokeStyle = `rgba(255,255,255,${0.05 + 0.03 * s})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  })();

  // =======================
  // Draw electrons (glow + tail)
  // =======================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const item of drawList) {
    const { el, X, Y, zN, scale, alphaZ } = item;

    // Color: frequency hue, amplitude controls brightness
    const hue = ((el.hue % 360) + 360) % 360;
    const light = 38 + el.e * 55 + zN * 6;
    const a = clamp01((0.18 + el.e * 0.85) * alphaZ);

    const color = `hsla(${hue}, 100%, ${light}%, ${a})`;

    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.min(QoS.maxShadowBlur, 8 + el.e * CFG.glowMax + zN * 6);

    // Electron size
    const size = (CFG.electronBaseSize + el.e * CFG.electronSizeGain) * scale;

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X, Y, size, 0, Math.PI * 2);
    ctx.fill();

    // Tail (tangent direction in screen space)
    // Approx tangent by angle derivative: (-sin, cos) in local orbit
    const ta = el.a;
    const tx = -Math.sin(ta);
    const ty =  Math.cos(ta);

    const tail = (CFG.tailBase + el.e * CFG.tailGain) * scale;
    ctx.lineWidth = 2.0 * scale;
    ctx.strokeStyle = `hsla(${hue}, 100%, ${light}%, ${clamp01(0.10 + el.e * 0.65) * alphaZ})`;
    ctx.beginPath();
    ctx.moveTo(X, Y);
    ctx.lineTo(X + tx * tail, Y + ty * tail);
    ctx.stroke();
  }

  ctx.restore();

  // =======================
  // Progress ring (safe)
  // =======================
  (function drawProgress() {
    const d = audio.duration || 0;
    const ct = audio.currentTime || 0;
    const p = d > 0 ? (ct / d) : 0;

    const start = -Math.PI / 2;
    const end = start + p * Math.PI * 2;

    // background ring
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = CFG.progressWidthBg;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // foreground ring
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = CFG.progressWidthFg;
    ctx.lineCap = "round";
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = Math.min(QoS.maxShadowBlur, 18);
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, start, end, false);
    ctx.stroke();
    ctx.restore();
  })();

  rafId = requestAnimationFrame(draw);
}

// =======================
// Events
// =======================
window.addEventListener("resize", () => {
  if (audioCtx) resizeCanvasToDisplaySize();
}, { passive: true });

["click","keydown","pointerdown","touchstart"].forEach(ev =>
  window.addEventListener(ev, () => {
    if (!VIZ_ENABLED) return;
    try {
      ensureAudioGraph();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch {}
  }, { passive: true })
);

audio.addEventListener("play", () => {
  if (!VIZ_ENABLED) return;
  ensureAudioGraph();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  if (rafId) cancelAnimationFrame(rafId);
  lastT = 0;
  draw(0);
});

audio.addEventListener("pause", () => {
  // keep last frame trails; no special action
});

audio.addEventListener("ended", () => {
  // keep last frame trails; no special action
});
