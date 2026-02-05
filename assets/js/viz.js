// Visualizer (Canvas)
// - Center blob (semi-transparent rainbow)
// - Ripple rings (semi-transparent, optional follow center hue)
// - Outer spectrum bars (opaque rainbow)  ✅ NOW: log-frequency mapping
// - Progress arc ring (opaque)
// - Kick detection + Auto QoS (without changing bar density)
// - Mobile/desktop stable centering: CSS logical size via getBoundingClientRect()
// - FIX: prevent "boxed clipping" by using SAFE radii so nothing exceeds canvas bounds

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

    // Clear and stop
    try { ctx.setTransform(1,0,0,1,0,0); } catch {}
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // If enabled while playing, start immediately
  if (!audio.paused && !audio.ended) {
    ensureAudioGraph();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (rafId) cancelAnimationFrame(rafId);
    lastT = 0;
    draw();
  }
}

export function getVizEnabled() {
  return VIZ_ENABLED;
}

// =======================
// Config
// =======================
const CFG = {
  // Outer bars (density fixed)
  bins: 108,
  smoothing: 0.76,
  bassBoost: 1.2, // 仍保留：低頻有節拍感（若你覺得右邊還是偏強可降到 1.2~1.5）
  barBase: 26,
  barGain: 190,

  // Ring positioning
  ringOffset: 56,

  // Center blob
  centerRatio: 0.22,
  centerGain: 80,
  centerBassGain: 120,
  centerGlow: 140,
  wavePoints: 256,
  waveSmooth: 0.22,

  // Rainbow center
  centerRainbow: true,
  centerHueSpeed: 40,
  centerHueBassSwing: 25,
  centerSat: 100,
  centerLight: 55,

  // Ripples
  rippleFollowCenter: true,
  rippleCount: 5,
  rippleAmp: 60,
  rippleSpeed: 2.2,
  rippleGap: 30,
  rippleAlpha: 0.85,

  // Alpha controls (center + ripples)
  alphaCenter: 0.35,
  alphaRipples: 0.85,

  // ✅ Log-frequency mapping (power-law approximation)
  // gamma > 1: expands low-frequency region across more of the ring
  // 1.6 ~ 2.4 are common. Higher = more "spread" for bass.
  freqGamma: 2.4,
};

// Auto QoS (does NOT change bar bins)
const QoS = {
  minFps: 50,
  maxFps: 58,
  scale: 1.0,
  minScale: 0.70,
  maxScale: 1.20,
  baseWavePts: CFG.wavePoints,
  maxShadowBlur: 24,
};

// Kick detection tuning
const KICK = {
  bandRatio: 1/6,
  threshMul: 1.35,
  minDelta: 0.04,
  decay: 0.90,
  cooldownMs: 110,
  push: 50,
  gainMul: 0.50,
  rippleBoost: 0.6,
  glowBoost: 1.1,
};

// =======================
// Audio graph
// =======================
let audioCtx, analyser, srcNode;
let dataFreq, dataTime;

// =======================
// Render state
// =======================
let rafId = null;
let phase = 0;
let lastT = 0;

let huePhase = 0;

let volEnv = 0;
let bassPeak = 0;
const ATTACK = 0.45;
const RELEASE = 0.1;
const PEAK_DECAY = 0.93;

let kickEnv = 0;
let bassMeanLT = 0;
let lastKickT = 0;

// FPS tracker
let __fps_t = 0, __fps_frames = 0, __fps_val = 60;
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

// Angle LUT
let __angleLUT = null;
function ensureAngleLUT(bins) {
  if (!__angleLUT || __angleLUT.length !== bins) {
    __angleLUT = new Array(bins);
    for (let i = 0; i < bins; i++) {
      const a = (i / bins) * Math.PI * 2;
      __angleLUT[i] = { c: Math.cos(a), s: Math.sin(a) };
    }
  }
}

// =======================
// Canvas sizing (CSS logical size -> device pixels)
// =======================
let __cssW = 0, __cssH = 0;

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

  // Draw in CSS logical pixels (ctx scaled to match device pixels)
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
  dataTime = new Uint8Array(analyser.frequencyBinCount);

  resizeCanvasToDisplaySize();
}

// =======================
// Helpers
// =======================
function computeLevels(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const avg = (sum / (arr.length * 255)) || 0;

  const lowEnd = Math.max(8, Math.floor(arr.length / 6));
  let bsum = 0;
  for (let i = 0; i < lowEnd; i++) bsum += arr[i];
  const bass = (bsum / (lowEnd * 255)) || 0;

  return { avg, bass };
}

function smoothArray(a, k = 0.2) {
  if (!k) return a;
  const out = new Float32Array(a.length);
  let prev = a[0];
  for (let i = 0; i < a.length; i++) {
    prev = prev + (a[i] - prev) * (1 - Math.pow(1 - k, 2));
    out[i] = prev;
  }
  return out;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgba(c, a = 1) {
  const s = String(c || "").trim();
  if (s.startsWith("#")) {
    let r, g, b;
    if (s.length === 7) { r = parseInt(s.slice(1,3),16); g = parseInt(s.slice(3,5),16); b = parseInt(s.slice(5,7),16); }
    else if (s.length === 4) { r = parseInt(s[1]+s[1],16); g = parseInt(s[2]+s[2],16); b = parseInt(s[3]+s[3],16); }
    else return s;
    return `rgba(${r},${g},${b},${a})`;
  }
  return s;
}

// ✅ Log-frequency mapping (power-law approximation)
// t in [0,1] => idx in [0, n-1]
// gamma > 1 spreads low-frequency region across more of the visible bins
function logMapIndex(t, n, gamma) {
  const tt = Math.max(0, Math.min(1, t));
  const g = Math.max(1.0001, Number(gamma) || 2.0);
  const idx = Math.floor(Math.pow(tt, g) * (n - 1));
  return Math.max(0, Math.min(n - 1, idx));
}

// =======================
// Main draw
// =======================
function draw(now = 0) {
  if (!VIZ_ENABLED) return;
  if (!analyser) return;

  trackFPS(now);

  // CSS logical size
  const W = __cssW || Math.round(canvas.getBoundingClientRect().width) || 1;
  const H = __cssH || Math.round(canvas.getBoundingClientRect().height) || 1;

  // QoS.scale might change => update transform
  resizeCanvasToDisplaySize();

  const cx = W / 2, cy = H / 2;
  const short = Math.min(W, H);

  // Bars density fixed
  const bins = CFG.bins;
  ensureAngleLUT(bins);

  // Center waveform resolution adapts with QoS
  const N = Math.max(120, Math.round(QoS.baseWavePts * QoS.scale));

  const dt = lastT ? (now - lastT) / 1000 : 0;
  lastT = now;
  phase += dt * CFG.rippleSpeed;

  analyser.getByteFrequencyData(dataFreq);
  analyser.getByteTimeDomainData(dataTime);
  const { avg, bass } = computeLevels(dataFreq);

  // ---- Kick detection ----
  const totalBins = dataFreq.length;
  const lowEndKick = Math.max(8, Math.floor(totalBins * KICK.bandRatio));
  let lowSum = 0;
  for (let i = 0; i < lowEndKick; i++) lowSum += dataFreq[i] / 255;
  const bassShort = (lowSum / lowEndKick) || 0;

  const EMA = 0.02;
  bassMeanLT = (1 - EMA) * bassMeanLT + EMA * bassShort;

  const nowMs = performance.now();
  const canKick = (nowMs - lastKickT) > KICK.cooldownMs;
  const overThresh = bassShort > (bassMeanLT * KICK.threshMul);
  const diffOk = (bassShort - bassMeanLT) > KICK.minDelta;
  if (canKick && overThresh && diffOk) { kickEnv = 1; lastKickT = nowMs; }
  else { kickEnv *= KICK.decay; }

  // ---- Volume envelope ----
  const targetVol = Math.min(1, avg * 0.9 + bass * 0.8);
  const k = (targetVol > volEnv) ? ATTACK : RELEASE;
  volEnv = lerp(volEnv, targetVol, k);

  if (bass > bassPeak) bassPeak = bass;
  else bassPeak *= PEAK_DECAY;

  // ---- Center hue ----
  if (CFG.centerRainbow) {
    const speed = CFG.centerHueSpeed * (1 + 0.6 * bassPeak);
    huePhase = (huePhase + speed * dt) % 360;
  }

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Accent
  const ACCENT = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6da8ff";

  // ==============================
  // SAFE radius calculation (FIX)
  // ==============================
  const half = short / 2;

  const maxBar = CFG.barBase + CFG.barGain;

  const progressPad = 18;
  const barPad = 10;
  const shadowPad = Math.min(24, QoS.maxShadowBlur);
  const edgePad = progressPad + barPad + shadowPad + 8;

  const ring = Math.max(10, half - edgePad);

  let radius = ring - CFG.ringOffset;
  radius = Math.max(10, Math.min(radius, (half - edgePad) - maxBar));
  if (!isFinite(radius) || radius < 10) radius = Math.max(10, ring * 0.6);

  // =======================
  // Center blob
  // =======================
  (function drawCenterBlob() {
    const wave = new Float32Array(dataTime.length);
    for (let i = 0; i < dataTime.length; i++) wave[i] = (dataTime[i] - 128) / 128;
    const sm = smoothArray(wave, CFG.waveSmooth);

    const base = short * CFG.centerRatio;
    const beat = Math.min(1.4, 0.6 * volEnv + 1.2 * bassPeak);

    const gain = CFG.centerGain * (beat + KICK.gainMul * kickEnv);
    const bassPush = CFG.centerBassGain * (0.55 * bass + 0.45 * bassPeak) + (KICK.push * kickEnv);

    const step = sm.length / N;

    const baseHue = CFG.centerRainbow ? (huePhase + CFG.centerHueBassSwing * bassPeak) % 360 : 210;
    const hue = (baseHue + 180) % 360;

    const centerStroke = `hsl(${hue}, ${CFG.centerSat}%, ${CFG.centerLight + 5}%)`;
    const centerFill   = `hsla(${hue}, ${CFG.centerSat}%, ${CFG.centerLight}%, 0.85)`;
    const centerGlow   = `hsl(${hue}, ${CFG.centerSat}%, ${Math.min(70, CFG.centerLight + 15)}%)`;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = CFG.alphaCenter;

    ctx.shadowColor = centerGlow;
    ctx.shadowBlur = Math.min(
      (CFG.centerGlow * (0.5 + volEnv)) * (1 + KICK.glowBoost * kickEnv * 0.5),
      QoS.maxShadowBlur
    );

    const grad = ctx.createRadialGradient(cx, cy, base * 0.18, cx, cy, base + gain + bassPush + 20);
    grad.addColorStop(0.00, "rgba(255,255,255,0.40)");
    grad.addColorStop(0.25, centerFill);
    grad.addColorStop(1.00, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;

    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const idx = Math.floor((i * step + phase * 70) % sm.length);
      const w = sm[idx];
      const r = base + w * gain + bassPush;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = centerStroke;
    ctx.lineWidth = 2.4 + volEnv * 1.8;
    ctx.stroke();

    ctx.restore();
  })();

  // =======================
  // Ripples
  // =======================
  (function drawRipples() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const hue = CFG.centerRainbow ? (huePhase + 10) % 360 : null;
    const rippleColor = (CFG.rippleFollowCenter && CFG.centerRainbow)
      ? `hsla(${hue}, ${CFG.centerSat}%, ${CFG.centerLight + 10}%, 0.9)`
      : hexToRgba(ACCENT, 0.9);

    ctx.strokeStyle = rippleColor;
    ctx.lineWidth = 2.2;

    for (let i = 0; i < CFG.rippleCount; i++) {
      const baseR = (short * CFG.centerRatio) + i * CFG.rippleGap;
      const amp   = CFG.rippleAmp * (0.35 + volEnv * 0.65) * (1 + KICK.rippleBoost * kickEnv);
      const r = baseR + Math.sin(phase * (1 + i * 0.06) + i * 0.9) * amp;

      const dyn = CFG.rippleAlpha * (0.95 - i / (CFG.rippleCount + 1)) * (0.6 + 0.4 * (volEnv + bassPeak));
      ctx.globalAlpha = CFG.alphaRipples * dyn;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  })();

  // =======================
  // Outer rainbow bars (LOG-FREQ + SAFE)
  // =======================
  (function drawBars() {
    const n = dataFreq.length;
    const gamma = CFG.freqGamma;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;

    for (let i = 0; i < bins; i++) {
      const t = (bins <= 1) ? 0 : (i / (bins - 1));

      // ✅ log-frequency mapping: allocate more visible bins to low frequencies
      const fftIndex = logMapIndex(t, n, gamma);
      const v = dataFreq[fftIndex] / 255;

      // keep bass emphasis (optional)
      const lowWeight = Math.pow(1 - i / bins, 2) * (CFG.bassBoost - 1) + 1;
      const boosted = Math.min(1, v * lowWeight);

      const bar = CFG.barBase + boosted * CFG.barGain;

      const ang = __angleLUT[i];
      const x1 = cx + ang.c * radius;
      const y1 = cy + ang.s * radius;

      const x2 = cx + ang.c * (radius + bar);
      const y2 = cy + ang.s * (radius + bar);

      const hue = (i / bins) * 360;
      const light = 44 + boosted * 42;
      const color = `hsl(${hue}, 100%, ${light}%)`;

      ctx.strokeStyle = color;
      ctx.lineWidth = 3.0;
      ctx.shadowColor = color;
      ctx.shadowBlur = Math.min(6 + boosted * 30, QoS.maxShadowBlur);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  })();

  // =======================
  // Progress arc ring (SAFE)
  // =======================
  (function drawProgress() {
    const d = audio.duration || 0;
    const ct = audio.currentTime || 0;
    const p = d > 0 ? (ct / d) : 0;

    const s = -Math.PI / 2;
    const e = s + p * Math.PI * 2;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = Math.min(25, QoS.maxShadowBlur);
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, s, e, false);
    ctx.stroke();
    ctx.restore();
  })();

  rafId = requestAnimationFrame(draw);
}

// =======================
// Events
// =======================

// Resize: mobile address bar / rotation / desktop resize
window.addEventListener("resize", () => {
  if (audioCtx) resizeCanvasToDisplaySize();
}, { passive: true });

// Ensure audio graph only when viz enabled (user gesture requirement)
["click","keydown","pointerdown","touchstart"].forEach(ev =>
  window.addEventListener(ev, () => {
    if (!VIZ_ENABLED) return;
    try {
      ensureAudioGraph();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch {}
  }, { passive: true })
);

// Start rendering on play, but only when enabled
audio.addEventListener("play", () => {
  if (!VIZ_ENABLED) return;
  ensureAudioGraph();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  if (rafId) cancelAnimationFrame(rafId);
  lastT = 0;
  draw();
});
