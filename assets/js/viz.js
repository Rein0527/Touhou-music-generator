// viz.js — 2.5D Atom Electrons Visualizer (Kr config 2,8,18,8)
// Updates:
// - 4 orthogonal orbital planes (per shell fixed)
// - Progress ring thinner/dimmer
// - Longer tails
// - Stronger 3D depth
// - Smaller/dimmer nucleus glow
// - More varied electron colors (freq base + dynamic hue drift)

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
  // Visual / trails
  trailAlpha: 0.085,       // lower = longer trails (was 0.10)
  glowMax: 26,
  electronBaseSize: 2.6,
  electronSizeGain: 5.2,

  // ✅ longer tails
  tailBase: 14,            // was 10
  tailGain: 72,            // was 46

  // Shell (Kr): 2, 8, 18, 8  => 36
  shells: [2, 8, 18, 8],

  // Orbit layout (relative to safe ring radius)
  orbitMin: 0.38,
  orbitMax: 0.62,
  shellGapJitter: 14,      // slightly stronger orbit jitter (was 12)
  orbitEccMin: 0.10,
  orbitEccMax: 0.30,

  // ✅ 3D projection (stronger)
  zDepth: 1.25,            // was 0.85
  zTiltY: 0.52,            // was 0.32
  zScaleMin: 0.62,         // was 0.70
  zScaleMax: 1.28,         // was 1.15
  zAlphaMin: 0.18,         // was 0.25
  zAlphaMax: 1.00,

  // Motion
  baseSpeed: 0.55,
  speedGain: 1.35,
  shellSpeedMul: [0.72, 1.00, 1.18, 1.34],

  // Frequency mapping
  freqGamma: 2.0,
  smoothing: 0.76,

  // ✅ Nucleus (smaller/dimmer)
  nucleusRatio: 0.18,      // was 0.22
  nucleusGlow: 48,         // was 120
  nucleusAlpha: 0.10,      // was 0.20

  // ✅ Progress ring thinner/dimmer
  progressWidthBg: 6,      // was 12
  progressWidthFg: 4,      // was 10
  progressBgAlpha: 0.12,
  progressFgAlpha: 0.42,
  progressGlow: 0,         // was glowy; now basically off

  // Orbits visibility
  orbitLineBaseAlpha: 0.035, // subtle
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
// 4 orthogonal planes (per shell fixed)
// In 2.5D: we fake plane orientation by mapping z -> x/y influence.
// These 4 are designed to feel like mutually perpendicular orbital planes.
// =======================
const ORTHO_PLANES = [
  // Shell 0: mostly "XY" (thin z influence)
  { px: 0.06, py: 0.06, phase: 0.0 },
  // Shell 1: "XZ-like" (z pushes x more)
  { px: 0.55, py: 0.08, phase: 1.2 },
  // Shell 2: "YZ-like" (z pushes y more)
  { px: 0.08, py: 0.55, phase: 2.4 },
  // Shell 3: diagonal plane (orthogonal-ish feel vs first three)
  { px: 0.40, py: -0.40, phase: 3.6 },
];

// =======================
// Electrons init (Kr shells)
// =======================
function initElectrons() {
  const shells = CFG.shells.slice();
  const total = shells.reduce((a,b)=>a+b, 0);

  electrons = [];
  let globalIndex = 0;

  for (let s = 0; s < shells.length; s++) {
    const count = shells[s];
    const plane = ORTHO_PLANES[s % ORTHO_PLANES.length];

    for (let j = 0; j < count; j++) {
      const t = (total <= 1) ? 0 : (globalIndex / (total - 1)); // 0..1 low->high

      // Base hue from frequency (low->high)
      const baseHue = 260 - 240 * t;

      electrons.push({
        shell: s,
        j,
        tFreq: t,
        baseHue,
        a: (j / count) * Math.PI * 2,  // evenly spread
        w: CFG.baseSpeed * (CFG.shellSpeedMul[s] ?? 1.0) * (0.85 + 0.30 * Math.random()),
        ecc: lerp(CFG.orbitEccMin, CFG.orbitEccMax, Math.random()),
        phi: Math.random() * Math.PI * 2,
        plane,
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

  if (!electrons) initElectrons();

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
  const progressPad = 10;
  const electronPad = 26;
  const shadowPad = Math.min(22, QoS.maxShadowBlur);
  const edgePad = progressPad + electronPad + shadowPad + 8;

  const ring = Math.max(12, half - edgePad);
  const rMin = ring * CFG.orbitMin;
  const rMax = ring * CFG.orbitMax;

  // Nucleus
  const nucleusR = Math.max(7, short * CFG.nucleusRatio);

  // =======================
  // Nucleus glow (smaller/dimmer)
  // =======================
  (function drawNucleus() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = CFG.nucleusAlpha;

    const grad = ctx.createRadialGradient(cx, cy, nucleusR * 0.2, cx, cy, nucleusR * 1.15);
    grad.addColorStop(0.00, "rgba(255,255,255,0.22)");
    grad.addColorStop(0.35, `rgba(187,113,243,0.10)`);
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
  const shellCount = CFG.shells.length;

  const shellBase = new Array(shellCount);
  for (let s = 0; s < shellCount; s++) {
    const tt = (shellCount <= 1) ? 0 : (s / (shellCount - 1));
    shellBase[s] = lerp(rMin, rMax, tt);
  }

  // A slowly changing time for color drift
  const tSec = now * 0.001;

  const drawList = new Array(total);
  for (let i = 0; i < total; i++) {
    const el = electrons[i];

    // Map frequency -> amplitude
    const idx = logMapIndex(el.tFreq, dataFreq.length, CFG.freqGamma);
    const v = dataFreq[idx] / 255; // 0..1
    el.e = lerp(el.e, v, 0.22);

    // Orbit radius + energy jitter
    const baseR = shellBase[el.shell];
    const r = baseR + el.e * CFG.shellGapJitter * (0.4 + 0.6 * Math.sin(el.phi + tSec * 2.1));

    // Update angle: energy increases speed
    el.a += (el.w * (1 + CFG.speedGain * el.e)) * dt;

    // Ellipse in local plane
    const ca = Math.cos(el.a);
    const sa = Math.sin(el.a);
    const rx = r * (1 + el.ecc);
    const ry = r * (1 - el.ecc);

    let x = ca * rx;
    let y = sa * ry;

    // Pseudo-z for depth movement
    // Include shell plane phase for orthogonal feel
    const zRaw = Math.sin(el.a + el.phi + el.plane.phase);
    // normalized depth 0..1
    const zN = clamp01((zRaw * CFG.zDepth + 1) * 0.5);

    // Apply plane influence (orthogonal planes)
    // z pushes x/y differently per shell, to mimic different orbit planes
    x += zRaw * el.plane.px * r * 0.40;
    y += zRaw * el.plane.py * r * 0.40;

    // Perspective projection: z shifts Y and affects scale/alpha
    const scale = lerp(CFG.zScaleMin, CFG.zScaleMax, zN);
    const alphaZ = lerp(CFG.zAlphaMin, CFG.zAlphaMax, zN);

    const X = cx + x;
    const Y = cy + y + (zN - 0.5) * CFG.zTiltY * r * 0.75;

    // ✅ More varied colors:
    // baseHue from frequency + shell offset + slow drift + energy jitter + depth tint
    const hueDrift =
      22 * Math.sin(tSec * 0.9 + el.shell * 1.3) +
      16 * Math.sin(tSec * 1.7 + el.a * 0.8) +
      14 * (el.e - 0.5) +
      10 * (zN - 0.5);

    const hue = (el.baseHue + el.shell * 18 + hueDrift) % 360;

    drawList[i] = {
      el,
      X, Y,
      zN,
      scale,
      alphaZ,
      hue,
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
    ctx.lineWidth = givesLineWidthForOrbits();

    for (let s = 0; s < shellCount; s++) {
      const rr = shellBase[s];
      const a = CFG.orbitLineBaseAlpha + 0.01 * s;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  })();

  // =======================
  // Draw electrons (glow + longer tail)
  // =======================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const item of drawList) {
    const { el, X, Y, zN, scale, alphaZ, hue } = item;

    const light = 36 + el.e * 58 + zN * 8;
    const a = clamp01((0.14 + el.e * 0.92) * alphaZ);

    const color = `hsla(${((hue % 360) + 360) % 360}, 100%, ${light}%, ${a})`;

    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.min(QoS.maxShadowBlur, 6 + el.e * CFG.glowMax + zN * 10);

    // Electron size
    const size = (CFG.electronBaseSize + el.e * CFG.electronSizeGain) * scale;

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X, Y, size, 0, Math.PI * 2);
    ctx.fill();

    // Tail (tangent direction)
    const ta = el.a;
    const tx = -Math.sin(ta);
    const ty =  Math.cos(ta);

    const tail = (CFG.tailBase + el.e * CFG.tailGain) * scale;
    ctx.lineWidth = 2.0 * scale;
    ctx.strokeStyle = `hsla(${((hue % 360) + 360) % 360}, 100%, ${light}%, ${clamp01(0.10 + el.e * 0.70) * alphaZ})`;
    ctx.beginPath();
    ctx.moveTo(X, Y);
    ctx.lineTo(X + tx * tail, Y + ty * tail);
    ctx.stroke();
  }

  ctx.restore();

  // =======================
  // Progress ring (thin + dim, no glow)
  // =======================
  (function drawProgress() {
    const d = audio.duration || 0;
    const ct = audio.currentTime || 0;
    const p = d > 0 ? (ct / d) : 0;

    const start = -Math.PI / 2;
    const end = start + p * Math.PI * 2;

    // background
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = CFG.progressBgAlpha;
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = CFG.progressWidthBg;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // foreground
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = CFG.progressFgAlpha;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = CFG.progressWidthFg;
    ctx.lineCap = "round";
    ctx.shadowBlur = 0; // ✅ no glow
    ctx.beginPath();
    ctx.arc(cx, cy, ring, start, end, false);
    ctx.stroke();
    ctx.restore();
  })();

  rafId = requestAnimationFrame(draw);
}

function givesLineWidthForOrbits() {
  // Keep it subtle and stable across DPI scaling
  return 1.2;
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

audio.addEventListener("pause", () => {});
audio.addEventListener("ended", () => {});
