// 中央波動（七彩可變+半透明）+ 彩虹等化條（不透明）+ 同心波紋（半透明，可跟隨中心色）
// + 外圈光暈（不透明）+ 圓弧進度（加強版）+ 鼓點偵測
const audio  = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx    = canvas.getContext("2d");

// —— 可調參數 —— //
const CFG = {
  // 外圈等化條
  bins: 96,
  smoothing: 0.82,
  bassBoost: 1.8,
  barBase: 26,
  barGain: 190,
  ringRadiusRatio: 0.34,
  ringOffset: 56,

  // 中央波動（核心）
  centerRatio: 0.22,
  centerGain: 80,
  centerBassGain: 120,
  centerGlow: 140,
  wavePoints: 256,
  waveSmooth: 0.22,

  // —— 中心七彩設定 —— //
  centerRainbow: true,        // 開關：中心球七彩
  centerHueSpeed: 40,         // 每秒旋轉幾度（越大變色越快）
  centerHueBassSwing: 25,     // 受低頻峰值擺動的角度（0~60常用）
  centerSat: 100,             // 飽和度（%）
  centerLight: 55,            // 亮度（%）
  rippleFollowCenter: true,   // 同心波紋顏色是否跟隨中心七彩

  // 同心波紋
  rippleCount: 5,
  rippleAmp: 60,
  rippleSpeed: 2.2,
  rippleGap: 30,
  rippleAlpha: 0.75,

  // 外圈光暈
  glowScale: 110,

  // —— 透明度控制（只作用在中心球與波紋） —— //
  alphaCenter: 0.6,   // 中心球
  alphaRipples: 0.85, // 波紋
};

// —— 鼓點強化參數 —— //
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

let audioCtx, analyser, srcNode;
let dataFreq, dataTime;
let rafId;

let phase = 0;
let lastT = 0;

// 七彩相位
let huePhase = 0;

// 音量/節拍包絡
let volEnv = 0;
let bassPeak = 0;
const ATTACK = 0.45;
const RELEASE = 0.1;
const PEAK_DECAY = 0.93;

// 鼓點狀態
let kickEnv = 0;
let bassMeanLT = 0;
let lastKickT = 0;

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

  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width  = Math.floor(canvas.width  * dpr);
  canvas.height = Math.floor(canvas.height * dpr);
  ctx.scale(dpr, dpr);
}

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

function draw(now = 0) {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const short = Math.min(W, H);
  const radius = short * CFG.ringRadiusRatio;
  const ring = radius + CFG.ringOffset;
  const bins = CFG.bins;

  const dt = lastT ? (now - lastT) / 1000 : 0;
  lastT = now;
  phase += dt * CFG.rippleSpeed;

  analyser.getByteFrequencyData(dataFreq);
  analyser.getByteTimeDomainData(dataTime);
  const { avg, bass } = computeLevels(dataFreq);

  // —— 鼓點偵測 —— //
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

  // —— 音量包絡 —— //
  const targetVol = Math.min(1, avg * 0.9 + bass * 0.8);
  const k = (targetVol > volEnv) ? ATTACK : RELEASE;
  volEnv = lerp(volEnv, targetVol, k);

  if (bass > bassPeak) bassPeak = bass;
  else bassPeak *= PEAK_DECAY;

  // —— 中心七彩相位推進 —— //
  if (CFG.centerRainbow) {
    const speed = CFG.centerHueSpeed * (1 + 0.6 * bassPeak); // 低頻來時轉快一點
    huePhase = (huePhase + speed * dt) % 360;
  }

  ctx.clearRect(0, 0, W, H);

  // 主題色（保留給等化條/外圈/進度弧用）
  const ACCENT = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || "#6da8ff";

  // —— 中央波動（七彩 + 半透明 + 鼓點加成） —— //
  (function drawCenterBlob() {
    const wave = new Float32Array(dataTime.length);
    for (let i = 0; i < dataTime.length; i++) wave[i] = (dataTime[i] - 128) / 128;
    const sm = smoothArray(wave, CFG.waveSmooth);

    const base = short * CFG.centerRatio;
    const beat = Math.min(1.4, 0.6 * volEnv + 1.2 * bassPeak);

    const gain = CFG.centerGain * (beat + KICK.gainMul * kickEnv);
    const bassPush = CFG.centerBassGain * (0.55 * bass + 0.45 * bassPeak) + (KICK.push * kickEnv);

    const N = CFG.wavePoints;
    const step = sm.length / N;

    // 決定中心色
    const hue = CFG.centerRainbow ? (huePhase + CFG.centerHueBassSwing * bassPeak) % 360 : 210;
    const centerStroke = `hsl(${hue}, ${CFG.centerSat}%, ${CFG.centerLight + 5}%)`;
    const centerFill   = `hsla(${hue}, ${CFG.centerSat}%, ${CFG.centerLight}%, 0.85)`;
    const centerGlow   = `hsl(${hue}, ${CFG.centerSat}%, ${Math.min(70, CFG.centerLight + 15)}%)`;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = CFG.alphaCenter;

    // 鼓點時光暈更亮
    ctx.shadowColor = centerGlow;
    ctx.shadowBlur = (CFG.centerGlow * (0.5 + volEnv)) * (1 + KICK.glowBoost * kickEnv * 0.5);

    // 漸層（中心白 → 主色 → 透明）
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
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // 外緣描邊：用同色
    ctx.strokeStyle = centerStroke;
    ctx.lineWidth = 3.2 + volEnv * 2.4;
    ctx.stroke();
    ctx.restore();
  })();

  // —— 同心波紋（可跟隨中心色 + 半透明 + 鼓點加成） —— //
  (function drawRipples() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const hue = CFG.centerRainbow ? (huePhase + 10) % 360 : null;
    const rippleColor = CFG.rippleFollowCenter && CFG.centerRainbow
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

  // —— 彩虹等化條（不透明） —— //
  (function drawBars() {
    const step = Math.floor(dataFreq.length / bins) || 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;

    for (let i = 0; i < bins; i++) {
      const v = dataFreq[i * step] / 255;
      const lowWeight = Math.pow(1 - i / bins, 2) * (CFG.bassBoost - 1) + 1;
      const boosted = Math.min(1, v * lowWeight);
      const bar = CFG.barBase + boosted * CFG.barGain;

      const a = (i / bins) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * radius, y1 = cy + Math.sin(a) * radius;
      const x2 = cx + Math.cos(a) * (radius + bar), y2 = cy + Math.sin(a) * (radius + bar);

      const hue = (i / bins) * 360;
      const light = 44 + boosted * 42;
      const color = `hsl(${hue}, 100%, ${light}%)`;

      ctx.strokeStyle = color;
      ctx.lineWidth = 3.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6 + boosted * 30;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  })();

  // —— 外圈光暈（不透明） —— //
  (function drawOuterGlow() {
    const glow = 10 + (0.6 * volEnv + 0.9 * bassPeak) * CFG.glowScale;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    const accent = ACCENT;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 13;
    ctx.lineCap = "round";
    ctx.shadowBlur = glow * 1.35;
    ctx.shadowColor = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, ring + 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  })();

  // —— 圓弧進度（加強版） —— //
  (function drawProgress() {
    const d = audio.duration || 0, ct = audio.currentTime || 0, p = d > 0 ? (ct / d) : 0;
    const s = -Math.PI / 2, e = s + p * Math.PI * 2;

    // 背景弧
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 進度弧（不透明 + 光暈）
    ctx.save();
    const accent2 = ACCENT;
    ctx.strokeStyle = accent2;
    ctx.lineWidth = 15;
    ctx.lineCap = "round";
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 25;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(cx, cy, ring, s, e, false);
    ctx.stroke();
    ctx.restore();
  })();

  rafId = requestAnimationFrame(draw);
}

// HEX 轉 RGBA（未用到會原樣返回）
function hexToRgba(c, a = 1) {
  const s = c.trim();
  if (s.startsWith("#")) {
    let r, g, b;
    if (s.length === 7) { r = parseInt(s.slice(1,3),16); g = parseInt(s.slice(3,5),16); b = parseInt(s.slice(5,7),16); }
    else if (s.length === 4) { r = parseInt(s[1]+s[1],16); g = parseInt(s[2]+s[2],16); b = parseInt(s[3]+s[3],16); }
    else { return s; }
    return `rgba(${r},${g},${b},${a})`;
  }
  return s;
}

// 啟動 AudioContext（需使用者互動）
['click','keydown','pointerdown','touchstart'].forEach(ev =>
  window.addEventListener(ev, () => {
    try {
      ensureAudioGraph();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch {}
  }, { passive:true })
);

audio.addEventListener("play", () => {
  ensureAudioGraph();
  if (audioCtx.state === "suspended") audioCtx.resume();
  cancelAnimationFrame(rafId);
  lastT = 0;
  draw();
});
