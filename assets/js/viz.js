// 視覺化（圓形七彩頻譜 + 進度弧 + 閃電特效，無峰值小帽）
const audio  = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx    = canvas.getContext("2d");

let audioCtx, analyser, sourceNode, rafId;

// ---------------- HiDPI & Resize ----------------
let DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
function resizeCanvas() {
  DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const cssW = canvas.clientWidth  || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width  = Math.round(cssW * DPR);
  canvas.height = Math.round(cssH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resizeCanvas, { passive: true });
resizeCanvas();

// ---------------- Audio Graph -------------------
function ensureAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
}
async function ensureResumed() {
  try {
    ensureAudioGraph();
    if (audioCtx.state === "suspended") await audioCtx.resume();
  } catch {}
}

// ---------------- Helpers ----------------------
function getAccent() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--accent").trim() || "#6da8ff";
}

// ---------------- Lightning --------------------
let bolts = [];                 // 現存電弧
let lastSpawnAt = 0;            // 上次觸發時間
let emaEnergy = 0;              // 能量滑動平均
const MAX_BOLTS = 6;            // 最大電弧數
const COOLDOWN  = 70;           // 觸發冷卻(ms)

function spawnBolt(cx, cy, baseR, len, a, power) {
  const seg    = 10 + Math.floor(10 * power);
  const jitter = 6 + 20 * power;
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const r = baseR + t * len;
    const ang = a + (Math.random() - 0.5) * 0.06; // 微偏
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    pts.push([ cx + Math.cos(ang) * r + jx, cy + Math.sin(ang) * r + jy ]);
  }
  bolts.push({ pts, life: 220 + 180 * Math.random(), alpha: 0.85, width: 2 + 1.5 * power });
  if (bolts.length > MAX_BOLTS) bolts.shift();
}

function renderBolts(dt) {
  if (!bolts.length) return;
  const accent = getAccent();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life  -= dt;
    b.alpha *= 0.92;
    b.width *= 0.98;
    if (b.life <= 0 || b.alpha < 0.05) { bolts.splice(i,1); continue; }

    // 外層發光
    ctx.shadowColor = accent;
    ctx.shadowBlur  = 14;
    ctx.globalAlpha = b.alpha;
    ctx.lineWidth   = b.width;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    const p0 = b.pts[0]; ctx.moveTo(p0[0], p0[1]);
    for (let k = 1; k < b.pts.length; k++) ctx.lineTo(b.pts[k][0], b.pts[k][1]);
    ctx.stroke();

    // 內芯
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = Math.min(1, b.alpha + 0.15);
    ctx.lineWidth   = Math.max(1, b.width * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

// --------------- Main Draw Loop ---------------
let BINS = 64;                       // 64 根；低 FPS 時自動降到 48
let lastTS = performance.now(), frames = 0, fps = 60;

function draw() {
  const W = (canvas.width / DPR), H = (canvas.height / DPR), cx = W/2, cy = H/2;
  const radius = Math.min(W,H) * 0.34;
  const ring   = radius + 52;
  const data   = new Uint8Array(analyser.frequencyBinCount);

  let prev = performance.now();
  (function loop(){
    rafId = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0,0,W,H);

    // FPS 偵測（每秒）
    frames++; const now = performance.now();
    if (now - lastTS >= 1000) { fps = frames; frames = 0; lastTS = now; }
    const bins = (fps < 45) ? Math.min(BINS, 48) : BINS;

    const step = Math.floor(data.length / bins);

    // 彩虹色相偏移（每秒旋轉 30 度）
    const tsec = performance.now() / 1000;
    const hueOffset = (tsec * 30) % 360;

    // —— 畫七彩頻譜，並計算能量（供閃電觸發） ——
    let energy = 0, hi = 0;
    for (let i=0; i<bins; i++){
      const v = data[i*step] / 255;     // 0~1
      energy += v;
      if (i > bins * 0.55) hi += v;     // 偏重中高頻
      const bar = 24 + v * 160;         // 主柱高度
      const a   = (i / bins) * Math.PI * 2;

      const x1 = cx + Math.cos(a) * radius,       y1 = cy + Math.sin(a) * radius;
      const x2 = cx + Math.cos(a) * (radius+bar), y2 = cy + Math.sin(a) * (radius+bar);

      // 七彩上色（HSL），透明度跟音量走
      const hue   = (i / bins) * 360 + hueOffset;
      const alpha = 0.25 + 0.65 * v;
      ctx.strokeStyle = `hsla(${hue.toFixed(1)}, 88%, 55%, ${alpha.toFixed(3)})`;
      ctx.lineWidth   = 3.5;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }

    // —— 閃電觸發（瞬態偵測） ——
    const avg = energy / bins;
    emaEnergy = emaEnergy ? (emaEnergy * 0.9 + avg * 0.1) : avg;
    const impulse   = (avg - emaEnergy) + (hi / bins) * 0.15;
    const threshold = 0.08;
    const now2 = performance.now();
    if (impulse > threshold && (now2 - lastSpawnAt) > COOLDOWN) {
      lastSpawnAt = now2;
      const power = Math.min(1, impulse * 6);
      const n = 1 + Math.floor(2.5 * power);  // 1~3 道
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const len = 70 + 220 * power + Math.random() * 50;
        spawnBolt(cx, cy, radius, len, a, power);
      }
    }

    // —— 進度圓弧 ——
    const d = audio.duration || 0, ct = audio.currentTime || 0, p = d > 0 ? ct/d : 0;
    const s = -Math.PI/2, e = s + p * Math.PI * 2;

    // 背景圓弧
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth   = 10;
    ctx.beginPath(); ctx.arc(cx,cy,ring,0,Math.PI*2); ctx.stroke();

    // 主題色（CSS 變數 --accent）
    const accent = getAccent();

    // 前景進度弧
    ctx.strokeStyle = accent;
    ctx.lineCap     = "round";
    ctx.beginPath(); ctx.arc(cx,cy,ring,s,e,false); ctx.stroke();

    // 動態光暈（平均音量）
    const glowR = ring + 16 + avg * 30;
    const g = ctx.createRadialGradient(cx,cy,ring, cx,cy, glowR);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `${accent}33`.replace('#','%23'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx,cy,glowR,0,Math.PI*2); ctx.fill();

    // —— 電弧（最後疊加） ——
    const nowFrame = performance.now();
    const dt = nowFrame - prev; prev = nowFrame;
    renderBolts(dt);
  })();
}

// 使用者互動後啟動（避免 Autoplay 限制）
["click","keydown","pointerdown","touchstart"].forEach(ev =>
  window.addEventListener(ev, () => { ensureResumed(); }, { passive:true })
);

// 播放時開啟繪製
audio.addEventListener("play", () => {
  ensureResumed();
  cancelAnimationFrame(rafId);
  draw();
});
