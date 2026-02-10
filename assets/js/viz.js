// viz.js — 2.5D Quantum Orbital (p-orbital / figure-eight) Visualizer
// - 36 electrons in 4 shells: 2 / 8 / 18 / 8 (Kr-like distribution)
// - Paths: figure-eight via Lissajous curves (quantum-orbital vibe)
// - Color = frequency, brightness/size/tail = amplitude
// - 2.5D depth: pseudo-z affects scale/alpha + depth sorting
// - Beat coupling: orbit speed & tail respond to bass/overall energy envelope
// - Softer nucleus glow, thinner/dimmer progress ring
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
  // Trails (motion glow)
  trailAlpha: 0.12,            // ↑ a bit = shorter trails (cleaner); lower = longer
  glowMax: 22,
  electronBaseSize: 2.2,
  electronSizeGain: 5.6,
  tailBase: 10,
  tailGain: 52,

  // Shells: 2, 8, 18, 8 => 36
  shells: [2, 8, 18, 8],

  // Orbit layout (relative to safe ring radius)
  orbitMin: 0.34,
  orbitMax: 0.60,
  orbitJitter: 14,             // amplitude -> radius modulation
  orbitLineAlpha: 0.05,        // subtle orbit guide

  // Figure-eight / quantum vibe
  // Lissajous: x = sin(a t + dx), y = sin(b t + dy), choose (a,b) = (1,2)
  lissaA: 1,
  lissaB: 2,
  lissaPhaseJitter: 0.9,       // per-electron phase variety
  lissaAspect: 0.88,           // squash/stretch

  // 2.5D projection (make depth stronger)
  zDepth: 1.15,                // ✅ increased
  zTiltY: 0.48,                // ✅ increased (perspective)
  zScaleMin: 0.62,
  zScaleMax: 1.28,
  zAlphaMin: 0.18,
  zAlphaMax: 1.00,

  // Motion + beat coupling
  baseSpeed: 0.65,             // baseline speed
  speedGain: 2.10,             // amplitude increases speed
  beatSpeedMul: 2.20,          // ✅ beat envelope multiplies speed
  shellSpeedMul: [0.85, 1.00, 1.15, 1.35], // outer shells slightly faster

  // Frequency mapping
  freqGamma: 2.1,              // log-frequency mapping exponent (>=1)
  smoothing: 0.78,

  // Nucleus (reduce)
  nucleusRatio: 0.16,          // ✅ smaller
  nucleusGlow: 60,             // ✅ less blur
  nucleusAlpha: 0.12,          // ✅ dimmer

  // Progress ring (reduce thickness & brightness)
  progressAlphaBg: 0.10,
  progressAlphaFg: 0.55,
  progressWidthBg: 6,          // ✅ thinner
  progressWidthFg: 4,          // ✅ thinner
  progressGlow: 10,            // ✅ less glow
};

// Auto QoS (does not change electron count)
const QoS = {
  minFps: 50,
  maxFps: 58,
  scale: 1.0,
  minScale: 0.70,
  maxScale: 1.20,
  maxShadowBlur: 22,
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

// Beat envelopes
let volEnv = 0;     // overall energy
let bassEnv = 0;    // low frequency energy
let beatEnv = 0;    // combined / emphasized envelope

// Electrons
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
// Energy / Beat extraction
// =======================
function computeEnergy() {
  // dataFreq contains 0..255
  let sum = 0;
  for (let i = 0; i < dataFreq.length; i++) sum += dataFreq[i];
  const avg = (sum / (dataFreq.length * 255)) || 0;

  const lowEnd = Math.max(8, Math.floor(dataFreq.length / 7));
  let bsum = 0;
  for (let i = 0; i < lowEnd; i++) bsum += dataFreq[i];
  const bass = (bsum / (lowEnd * 255)) || 0;

  // Envelope (fast attack, slower release)
  const ATT = 0.35;
  const REL = 0.08;

  const volTarget  = Math.min(1, avg * 0.95 + bass * 0.55);
  const bassTarget = Math.min(1, bass * 1.25);

  volEnv  = lerp(volEnv,  volTarget,  volTarget  > volEnv  ? ATT : REL);
  bassEnv = lerp(bassEnv, bassTarget, bassTarget > bassEnv ? ATT : REL);

  // Beat emphasized: bass dominates but overall helps
  const beatTarget = clamp01(bassEnv * 0.85 + volEnv * 0.35);
  beatEnv = lerp(beatEnv, beatTarget, beatTarget > beatEnv ? 0.40 : 0.12);

  return { avg, bass };
}

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

    // A "plane" for each shell (gives distinct orbital orientations)
    // We’ll keep this deterministic-ish for a nice look:
    // inner shells less tilted, outer more tilted.
    const tiltBase = 0.10 + 0.12 * s;
    const plane = {
      tiltX: (Math.random() * 2 - 1) * tiltBase,
      tiltY: (Math.random() * 2 - 1) * tiltBase,
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

        // parameter along the curve
        u: (j / count) * Math.PI * 2,

        // base angular velocity
        w: CFG.baseSpeed * (CFG.shellSpeedMul[s] ?? 1.0) * (0.80 + 0.35 * Math.random()),

        // per-electron phases for variety
        dx: (Math.random() * 2 - 1) * CFG.lissaPhaseJitter,
        dy: (Math.random() * 2 - 1) * CFG.lissaPhaseJitter,
        dz: Math.random() * Math.PI * 2,

        // per-electron curve shaping
        aspect: CFG.lissaAspect * (0.85 + 0.30 * Math.random()),

        // plane
        plane,

        // smoothed band energy
        e: 0,
      });

      globalIndex++;
    }
  }
}

// =======================
// Lissajous figure-eight (p-orbital vibe)
// =======================
// Returns local (x,y,zLike) in [-1..1] range-ish
function lissajous8(u, dx, dy, dz) {
  // Base "8": a=1, b=2
  const a = CFG.lissaA;
  const b = CFG.lissaB;

  const x = Math.sin(a * u + dx);
  const y = Math.sin(b * u + dy);

  // pseudo-z oscillation (for depth), not true 3D but enough for 2.5D
  // tie to curve position so it looks like it goes in/out of the screen
  const z = Math.sin(u + dz) * 0.95;

  return { x, y, z };
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
  computeEnergy();

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
  const progressPad = 12;
  const electronPad = 20;
  const shadowPad = Math.min(22, QoS.maxShadowBlur);
  const edgePad = progressPad + electronPad + shadowPad + 10;

  const ring = Math.max(12, half - edgePad);

  // Shell radii (inside ring)
  const rMin = ring * CFG.orbitMin;
  const rMax = ring * CFG.orbitMax;

  // Shell base radii
  const shellCount = CFG.shells.length;
  const shellBase = new Array(shellCount);
  for (let s = 0; s < shellCount; s++) {
    const tt = (shellCount <= 1) ? 0 : (s / (shellCount - 1));
    shellBase[s] = lerp(rMin, rMax, tt);
  }

  // =======================
  // Nucleus (smaller & dimmer)
  // =======================
  (function drawNucleus() {
    const nucleusR = Math.max(8, short * CFG.nucleusRatio);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = CFG.nucleusAlpha;

    const grad = ctx.createRadialGradient(cx, cy, nucleusR * 0.2, cx, cy, nucleusR * 1.15);
    grad.addColorStop(0.00, "rgba(255,255,255,0.30)");
    grad.addColorStop(0.35, "rgba(187,113,243,0.14)");
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
  // Orbit guides (very subtle)
  // =======================
  (function drawOrbitGuides() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.2;

    for (let s = 0; s < shellCount; s++) {
      const rr = shellBase[s];
      ctx.strokeStyle = `rgba(255,255,255,${CFG.orbitLineAlpha + 0.01 * s})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  })();

  // =======================
  // Compute electron positions + depth sort
  // =======================
  const drawList = [];

  for (const el of electrons) {
    // Band energy (smoothed)
    const idx = logMapIndex(el.tFreq, dataFreq.length, CFG.freqGamma);
    const v = dataFreq[idx] / 255; // 0..1
    el.e = lerp(el.e, v, 0.20);

    // ✅ Beat-coupled speed:
    // - baseline + per-shell
    // - amplitude -> speed
    // - beat envelope -> big speed swing
    const speedMul =
      1
      + (CFG.speedGain * el.e)
      + (CFG.beatSpeedMul * beatEnv);

    // Advance curve parameter u
    el.u += el.w * speedMul * dt;

    // Base radius for this shell + energy jitter (pulsing)
    const baseR = shellBase[el.shell];
    const r = baseR + (el.e * CFG.orbitJitter) * (0.35 + 0.65 * Math.sin(now * 0.001 + el.dz));

    // Lissajous 8 (local)
    const { x, y, z } = lissajous8(el.u, el.dx, el.dy, el.dz);

    // Apply aspect
    const lx = x * el.aspect;
    const ly = y * (2.0 - el.aspect) * 0.92;

    // Local point scaled by radius
    let px = lx * r;
    let py = ly * r;

    // Pseudo-z
    let pz = z;

    // Apply shell plane tilt (fake 3D variety)
    px += pz * el.plane.tiltX * r * 0.35;
    py += pz * el.plane.tiltY * r * 0.35;

    // Normalize z to 0..1 depth
    const zN = (pz * CFG.zDepth + 1) * 0.5; // 0..1
    const scale = lerp(CFG.zScaleMin, CFG.zScaleMax, zN);
    const alphaZ = lerp(CFG.zAlphaMin, CFG.zAlphaMax, zN);

    // Perspective tilt (stronger depth feel)
    const X = cx + px;
    const Y = cy + py + (zN - 0.5) * CFG.zTiltY * r;

    drawList.push({
      el, X, Y,
      zN,
      scale,
      alphaZ,
      sortZ: zN,
    });
  }

  // Back -> front
  drawList.sort((a, b) => a.sortZ - b.sortZ);

  // =======================
  // Draw electrons (glow + tail) — beat affects tail brightness/length too
  // =======================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const item of drawList) {
    const { el, X, Y, zN, scale, alphaZ } = item;

    // Frequency hue + energy lightness
    const hue = ((el.hue % 360) + 360) % 360;

    // ✅ beat adds brightness pop
    const light = 34 + el.e * 56 + zN * 8 + beatEnv * 10;

    // Base alpha
    const a = clamp01((0.15 + el.e * 0.85 + beatEnv * 0.18) * alphaZ);

    const color = `hsla(${hue}, 100%, ${light}%, ${a})`;

    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.min(QoS.maxShadowBlur, 6 + el.e * CFG.glowMax + beatEnv * 10 + zN * 6);

    // Size
    const size = (CFG.electronBaseSize + el.e * CFG.electronSizeGain + beatEnv * 1.8) * scale;

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X, Y, size, 0, Math.PI * 2);
    ctx.fill();

    // Tail direction: approximate tangent by small forward sample on curve
    const u2 = el.u + 0.04;
    const p1 = lissajous8(el.u,  el.dx, el.dy, el.dz);
    const p2 = lissajous8(u2,    el.dx, el.dy, el.dz);
    let tx = (p2.x - p1.x);
    let ty = (p2.y - p1.y);
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;

    // Tail length: energy + beat + depth
    const tail = (CFG.tailBase + el.e * CFG.tailGain + beatEnv * 36) * scale * (0.85 + 0.35 * zN);

    ctx.lineWidth = 2.0 * scale;
    ctx.strokeStyle = `hsla(${hue}, 100%, ${light}%, ${clamp01(0.10 + el.e * 0.60 + beatEnv * 0.35) * alphaZ})`;
    ctx.beginPath();
    ctx.moveTo(X, Y);
    ctx.lineTo(X + tx * tail, Y + ty * tail);
    ctx.stroke();
  }

  ctx.restore();

  // =======================
  // Progress ring (thinner & dimmer)
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
    ctx.strokeStyle = `rgba(255,255,255,${CFG.progressAlphaBg})`;
    ctx.lineWidth = CFG.progressWidthBg;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // foreground ring
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(187,113,243,${CFG.progressAlphaFg})`;
    ctx.lineWidth = CFG.progressWidthFg;
    ctx.lineCap = "round";
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = Math.min(QoS.maxShadowBlur, CFG.progressGlow);
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
