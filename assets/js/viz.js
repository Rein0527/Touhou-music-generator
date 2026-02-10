// viz.js — 2.5D Quantum Orbital Visualizer (p-orbital "8")
// Features:
// - 36 electrons in 4 shells: 2 / 8 / 18 / 8
// - Path: Lissajous figure-eight (p-orbital vibe)
// - Beat coupling: vibration / uncertainty (NOT speed)
// - Beat orbital splitting: dual "8" lobes (two phase-shifted curves) that separate on beats
// - Probability cloud: each electron rendered as a small Gaussian-ish cloud (multiple samples)
// - Stronger 2.5D depth: pseudo-z affects scale/alpha; depth sorting
// - Softer nucleus; thinner/dimmer progress ring
// - Stable sizing: getBoundingClientRect + DPR clamp

const audio  = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx    = canvas.getContext("2d");

/* =======================
   Public toggle API
======================= */
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

/* =======================
   Config
======================= */
const CFG = {
  // Shells: Kr distribution => 36
  shells: [2, 8, 18, 8],

  // Audio mapping
  smoothing: 0.78,
  freqGamma: 2.1,            // log-frequency mapping exponent

  // Trails (motion persistence)
  trailAlpha: 0.12,          // higher = shorter trails (cleaner)
  bgFade: "rgba(0,0,0,",     // fade layer prefix

  // Motion (speed is stable, NOT beat-coupled)
  baseSpeed: 0.78,
  shellSpeedMul: [0.85, 1.0, 1.12, 1.28], // gentle differences by shell

  // Lissajous "8" curve
  lissaA: 1,
  lissaB: 2,
  lissaAspectBase: 0.90,
  lissaAspectJitter: 0.18,

  // Orbit radii
  orbitMin: 0.34,
  orbitMax: 0.60,

  // Beat-driven vibration (core requirement)
  vibRadial: 28,             // radial vibration strength (px)
  vibTangential: 18,         // tangential jitter strength (px)
  vibZ: 0.45,                // z wobble strength
  vibNoise: 0.55,            // per-electron noisy wobble mix

  // Orbital splitting (double "8")
  splitStrength: 0.75,       // how far the second orbital shifts (0..1)
  splitPhase: Math.PI / 2,   // phase offset between the two "8" curves
  splitMixBase: 0.0,         // baseline split visibility (0 for off when no beat)
  splitMixGain: 1.0,         // beat controls additional visibility

  // Probability cloud (uncertainty)
  cloudSamples: 7,           // number of "probability samples" per electron
  cloudSpread: 6.5,          // base spread (px)
  cloudBeatGain: 16.0,       // beat increases spread (uncertainty "thickness")
  cloudEnergyGain: 10.0,     // amplitude increases spread
  cloudAlpha: 0.16,          // per-sample alpha (lower = softer)
  cloudKernel: [1.0, 0.55, 0.33, 0.22, 0.18, 0.14, 0.12], // weights for samples

  // Electron appearance
  electronBaseSize: 2.2,
  electronSizeGain: 4.8,
  glowMax: 20,
  tailBase: 10,
  tailGain: 38,

  // 2.5D depth (stronger)
  zDepth: 1.25,
  zTiltY: 0.52,
  zScaleMin: 0.60,
  zScaleMax: 1.34,
  zAlphaMin: 0.18,
  zAlphaMax: 1.00,

  // Nucleus (reduced)
  nucleusRatio: 0.16,
  nucleusAlpha: 0.11,
  nucleusGlow: 52,

  // Orbit guide
  orbitLineAlpha: 0.05,

  // Progress ring (thin/dim)
  progressAlphaBg: 0.10,
  progressAlphaFg: 0.50,
  progressWidthBg: 6,
  progressWidthFg: 4,
  progressGlow: 10,
};

// QoS-ish DPR clamp
const RENDER = {
  maxDpr: 1.6,
  minDpr: 1.0,
};

/* =======================
   Audio graph
======================= */
let audioCtx, analyser, srcNode;
let dataFreq;

/* =======================
   State
======================= */
let rafId = null;
let lastT = 0;

let __cssW = 0, __cssH = 0;

let electrons = null;

// beat envelopes
let volEnv = 0;
let bassEnv = 0;
let beatEnv = 0;

/* =======================
   Utils
======================= */
function lerp(a,b,t){ return a + (b-a) * t; }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function logMapIndex(t, n, gamma) {
  const tt = clamp01(t);
  const g = Math.max(1.0001, Number(gamma) || 2.0);
  const idx = Math.floor(Math.pow(tt, g) * (n - 1));
  return Math.max(0, Math.min(n - 1, idx));
}

// small deterministic-ish hash noise (0..1)
function hash01(x){
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// approx gaussian from 2 uniforms
function gauss01(seedA, seedB){
  // Box-Muller-ish but cheaper: sum of uniforms ~ gaussian
  const u1 = hash01(seedA);
  const u2 = hash01(seedB);
  return (u1 + u2 - 1); // ~[-1,1] bell-ish
}

/* =======================
   Sizing
======================= */
function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  __cssW = cssW; __cssH = cssH;

  const raw = window.devicePixelRatio || 1;
  const dpr = Math.max(RENDER.minDpr, Math.min(RENDER.maxDpr, raw));

  const needW = Math.floor(cssW * dpr);
  const needH = Math.floor(cssH * dpr);

  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
  }

  // draw in CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

/* =======================
   Energy & beat envelope
======================= */
function computeEnergy() {
  // overall avg
  let sum = 0;
  for (let i = 0; i < dataFreq.length; i++) sum += dataFreq[i];
  const avg = (sum / (dataFreq.length * 255)) || 0;

  // bass avg
  const lowEnd = Math.max(8, Math.floor(dataFreq.length / 7));
  let bsum = 0;
  for (let i = 0; i < lowEnd; i++) bsum += dataFreq[i];
  const bass = (bsum / (lowEnd * 255)) || 0;

  // envelope (fast attack, slow-ish release)
  const ATT = 0.35;
  const REL = 0.10;

  const volTarget  = clamp01(avg * 0.95 + bass * 0.45);
  const bassTarget = clamp01(bass * 1.25);

  volEnv  = lerp(volEnv,  volTarget,  volTarget  > volEnv  ? ATT : REL);
  bassEnv = lerp(bassEnv, bassTarget, bassTarget > bassEnv ? ATT : REL);

  // beat emphasis: mostly bass, some overall
  const beatTarget = clamp01(bassEnv * 0.90 + volEnv * 0.30);
  beatEnv = lerp(beatEnv, beatTarget, beatTarget > beatEnv ? 0.40 : 0.14);

  return { avg, bass };
}

/* =======================
   Electrons init
======================= */
function initElectrons() {
  const shells = CFG.shells.slice();
  const total = shells.reduce((a,b)=>a+b, 0);

  electrons = [];
  let g = 0;

  for (let s = 0; s < shells.length; s++) {
    const count = shells[s];

    const tiltBase = 0.10 + 0.12 * s;
    const plane = {
      tiltX: (Math.random() * 2 - 1) * tiltBase,
      tiltY: (Math.random() * 2 - 1) * tiltBase,
      phi: Math.random() * Math.PI * 2,
    };

    for (let j = 0; j < count; j++) {
      const t = (total <= 1) ? 0 : (g / (total - 1));
      const hue = 260 - 240 * t;

      electrons.push({
        shell: s,
        tFreq: t,
        hue,

        // curve parameter
        u: (j / count) * Math.PI * 2 + Math.random() * 0.25,

        // stable angular speed (not beat coupled)
        w: CFG.baseSpeed * (CFG.shellSpeedMul[s] ?? 1.0) * (0.80 + 0.35 * Math.random()),

        // per-electron phases
        dx: (Math.random() * 2 - 1) * 0.9,
        dy: (Math.random() * 2 - 1) * 0.9,
        dz: Math.random() * Math.PI * 2,

        aspect: CFG.lissaAspectBase * (1 + (Math.random() * 2 - 1) * CFG.lissaAspectJitter),

        plane,

        // smoothed band energy
        e: 0,
      });

      g++;
    }
  }
}

/* =======================
   Lissajous "8"
======================= */
function lissajous8(u, dx, dy) {
  const a = CFG.lissaA;
  const b = CFG.lissaB;
  const x = Math.sin(a * u + dx);
  const y = Math.sin(b * u + dy);
  return { x, y };
}

/* =======================
   Draw
======================= */
function draw(now = 0) {
  if (!VIZ_ENABLED) return;
  if (!analyser) return;

  resizeCanvasToDisplaySize();

  const W = __cssW || 1;
  const H = __cssH || 1;
  const cx = W / 2, cy = H / 2;
  const short = Math.min(W, H);
  const half = short / 2;

  const dt = lastT ? (now - lastT) / 1000 : 0;
  lastT = now;

  analyser.getByteFrequencyData(dataFreq);
  computeEnergy();

  if (!electrons) initElectrons();

  const ACCENT = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#bb71f3";

  // TRAIL fade (instead of clearRect)
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `${CFG.bgFade}${CFG.trailAlpha})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // SAFE ring
  const progressPad = 12;
  const electronPad = 20;
  const shadowPad = 22;
  const edgePad = progressPad + electronPad + shadowPad + 10;
  const ring = Math.max(12, half - edgePad);

  // Shell radii
  const rMin = ring * CFG.orbitMin;
  const rMax = ring * CFG.orbitMax;

  const shellCount = CFG.shells.length;
  const shellBase = new Array(shellCount);
  for (let s = 0; s < shellCount; s++) {
    const tt = (shellCount <= 1) ? 0 : (s / (shellCount - 1));
    shellBase[s] = lerp(rMin, rMax, tt);
  }

  // Nucleus (smaller & dimmer)
  (function drawNucleus(){
    const r = Math.max(8, short * CFG.nucleusRatio);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = CFG.nucleusAlpha;

    const grad = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r * 1.10);
    grad.addColorStop(0.0, "rgba(255,255,255,0.26)");
    grad.addColorStop(0.4, "rgba(187,113,243,0.10)");
    grad.addColorStop(1.0, "rgba(0,0,0,0)");

    ctx.fillStyle = grad;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = CFG.nucleusGlow;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  })();

  // Orbit guide (very subtle)
  (function drawOrbitGuides(){
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

  // Orbital split mix (0..1)
  const splitMix = clamp01(CFG.splitMixBase + CFG.splitMixGain * beatEnv);

  // Build draw list with depth sort
  const drawList = [];

  for (let i = 0; i < electrons.length; i++) {
    const el = electrons[i];

    // band energy
    const bi = logMapIndex(el.tFreq, dataFreq.length, CFG.freqGamma);
    const v = dataFreq[bi] / 255;
    el.e = lerp(el.e, v, 0.20);

    // stable speed
    el.u += el.w * dt;

    // beat-driven vibration (radial + tangential + z)
    const n0 = hash01(i * 3.1 + now * 0.0007);
    const n1 = hash01(i * 7.7 + now * 0.0011);
    const noise = (n0 * 2 - 1) * CFG.vibNoise + (n1 * 2 - 1) * (1 - CFG.vibNoise);

    const vibR = beatEnv * CFG.vibRadial * Math.sin(el.dz + now * 0.006 + noise);
    const vibT = beatEnv * CFG.vibTangential * Math.cos(el.dz + now * 0.004 - noise);
    const vibZ = beatEnv * CFG.vibZ * Math.sin(el.u + el.dz + noise);

    const baseR = shellBase[el.shell];
    const r = baseR + vibR + el.e * CFG.orbitJitter * (0.25 + 0.75 * Math.sin(now * 0.001 + el.dz));

    // Two orbitals (split): main + phase-shifted
    // When splitMix>0, we blend a second curve that is rotated (phase offset)
    const pA = lissajous8(el.u, el.dx, el.dy);
    const pB = lissajous8(el.u + CFG.splitPhase, el.dx, el.dy);

    // Interpolate between curves: gives "orbital splitting" under beat
    const x0 = pA.x, y0 = pA.y;
    const x1 = pB.x, y1 = pB.y;

    // splitStrength makes the second lobe separate more instead of simple blend
    const sx = lerp(x0, x1 * (1 + CFG.splitStrength), splitMix);
    const sy = lerp(y0, y1 * (1 + CFG.splitStrength), splitMix);

    // Apply aspect
    const lx = sx * el.aspect;
    const ly = sy * (2.0 - el.aspect) * 0.92;

    // Base local point
    let px = lx * r;
    let py = ly * r;

    // Tangential jitter (rotate 90° in local space)
    px += -ly * vibT;
    py +=  lx * vibT;

    // Pseudo-z combines curve position + vibZ
    let pz = Math.sin(el.u + el.dz) * 0.95 + vibZ;

    // Plane tilt
    px += pz * el.plane.tiltX * r * 0.35;
    py += pz * el.plane.tiltY * r * 0.35;

    // Depth normalize
    const zN = clamp01((pz * CFG.zDepth + 1) * 0.5);
    const scale = lerp(CFG.zScaleMin, CFG.zScaleMax, zN);
    const alphaZ = lerp(CFG.zAlphaMin, CFG.zAlphaMax, zN);

    // Perspective
    const X = cx + px;
    const Y = cy + py + (zN - 0.5) * CFG.zTiltY * r;

    drawList.push({ el, X, Y, zN, scale, alphaZ });
  }

  drawList.sort((a, b) => a.zN - b.zN);

  // Draw electrons: probability cloud + core dot + small tail
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let k = 0; k < drawList.length; k++) {
    const it = drawList[k];
    const el = it.el;

    const hue = ((el.hue % 360) + 360) % 360;

    // brightness follows energy + beat pop + depth
    const light = 32 + el.e * 54 + beatEnv * 12 + it.zN * 8;

    // alpha follows energy + beat + depth alpha
    const alphaBase = clamp01((0.10 + el.e * 0.75 + beatEnv * 0.22) * it.alphaZ);

    // Cloud spread grows with beat + energy (uncertainty)
    const spread =
      (CFG.cloudSpread + CFG.cloudEnergyGain * el.e + CFG.cloudBeatGain * beatEnv) * it.scale;

    // 1) Probability cloud (multiple samples around the mean)
    // Use deterministic gaussian-ish offsets so it shimmers but not flickery.
    const samples = CFG.cloudSamples;
    for (let s = 0; s < samples; s++) {
      const w = CFG.cloudKernel[s] ?? CFG.cloudKernel[CFG.cloudKernel.length - 1] ?? 0.12;

      const gx = gauss01(k * 11.3 + s * 3.7 + now * 0.0009, k * 2.1 + s * 9.1 + now * 0.0013);
      const gy = gauss01(k * 5.9  + s * 1.6 + now * 0.0011, k * 8.2 + s * 6.4 + now * 0.0008);

      const dx = gx * spread;
      const dy = gy * spread;

      const a = alphaBase * CFG.cloudAlpha * w;
      if (a <= 0.001) continue;

      const cloudColor = `hsla(${hue}, 100%, ${light}%, ${a})`;
      ctx.fillStyle = cloudColor;
      ctx.shadowColor = cloudColor;
      ctx.shadowBlur = Math.min(22, 6 + CFG.glowMax * el.e + 10 * beatEnv);

      const r = (1.2 + 1.6 * el.e + 0.8 * beatEnv) * it.scale * (0.85 + 0.25 * it.zN);
      ctx.beginPath();
      ctx.arc(it.X + dx, it.Y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2) Electron "core" point
    const coreAlpha = clamp01(alphaBase * 0.95);
    const coreColor = `hsla(${hue}, 100%, ${light + 6}%, ${coreAlpha})`;
    ctx.fillStyle = coreColor;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = Math.min(22, 8 + CFG.glowMax * el.e + 14 * beatEnv + 6 * it.zN);

    const size = (CFG.electronBaseSize + CFG.electronSizeGain * el.e + 2.0 * beatEnv) * it.scale;
    ctx.beginPath();
    ctx.arc(it.X, it.Y, size, 0, Math.PI * 2);
    ctx.fill();

    // 3) Small tail (direction from local tangent using forward sample)
    const u2 = el.u + 0.04;
    const p1 = lissajous8(el.u, el.dx, el.dy);
    const p2 = lissajous8(u2,   el.dx, el.dy);
    let tx = (p2.x - p1.x);
    let ty = (p2.y - p1.y);
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen; ty /= tlen;

    const tail = (CFG.tailBase + CFG.tailGain * el.e + 24 * beatEnv) * it.scale * (0.85 + 0.35 * it.zN);
    ctx.lineWidth = 2.0 * it.scale;

    const tailA = clamp01((0.06 + 0.45 * el.e + 0.35 * beatEnv) * it.alphaZ);
    ctx.strokeStyle = `hsla(${hue}, 100%, ${light}%, ${tailA})`;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = Math.min(18, 6 + 10 * beatEnv);

    ctx.beginPath();
    ctx.moveTo(it.X, it.Y);
    ctx.lineTo(it.X + tx * tail, it.Y + ty * tail);
    ctx.stroke();
  }

  ctx.restore();

  // Progress ring (thin & dim)
  (function drawProgress(){
    const d = audio.duration || 0;
    const ct = audio.currentTime || 0;
    const p = d > 0 ? (ct / d) : 0;

    const s = -Math.PI / 2;
    const e = s + p * Math.PI * 2;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `rgba(255,255,255,${CFG.progressAlphaBg})`;
    ctx.lineWidth = CFG.progressWidthBg;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(187,113,243,${CFG.progressAlphaFg})`;
    ctx.lineWidth = CFG.progressWidthFg;
    ctx.lineCap = "round";
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = CFG.progressGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, s, e, false);
    ctx.stroke();
    ctx.restore();
  })();

  rafId = requestAnimationFrame(draw);
}

/* =======================
   Events
======================= */
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
