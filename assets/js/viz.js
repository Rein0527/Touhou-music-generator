// 視覺化（圓形頻譜 + 進度弧 + 閃電特效）
const audio = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");

let audioCtx, analyser, sourceNode, rafId;

// ----- HiDPI & Resize -------------------------------------------------------
let DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
function resizeCanvas() {
  DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width  = Math.round(cssW * DPR);
  canvas.height = Math.round(cssH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resizeCanvas, { passive:true });
resizeCanvas();

// ----- Audio Graph -----------------------------------------------------------
function ensureAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;                // 保留原本 FFT
    analyser.smoothingTimeConstant = 0.8;   // 平滑係數
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
}
async function ensureResumed() {
  try {
    ensureAudioGraph();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
  } catch {}
}

// ----- 配色 & 輔助 -----------------------------------------------------------
function getAccent() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || "#6da8ff";
}

// ----- 閃電特效（Lightning） -------------------------------------------------
let bolts = [];                  // 現存電弧
let lastSpawnAt = 0;             // 上次觸發時間
let emaEnergy = 0;               // 能量滑動平均
const MAX_BOLTS = 6;             // 最大同屏電弧
const COOLDOWN = 70;             // 觸發冷卻（毫秒）

function spawnBolt(cx, cy, baseR, len, a, power) {
  const seg = 10 + Math.floor(10 * power);  // 段數
  const jitter = 6 + 20 * power;            // 抖動幅度
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
    b.life -= dt;
    b.alpha *= 0.92;
    b.width *= 0.98;
    if (b.life <= 0 || b.alpha < 0.05) { bolts.splice(i,1); continue; }

    // 外層發光
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = b.alpha;
    ctx.lineWidth = b.width;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    const p0 = b.pts[0]; ctx.moveTo(p0[0], p0[1]);
    for (let k=1; k<b.pts.length; k++) ctx.lineTo(b.pts[k][0], b.pts[k][1]);
    ctx.stroke();

    // 內芯（更亮更細）
    ctx.shadowBlur = 0;
    ctx.globalAlpha = Math.min(1, b.alpha + 0.15);
    ctx.lineWidth = Math.max(1, b.width * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

// ----- 視覺化主迴圈 ---------------------------------------------------------
let BINS = 64;                         // 預設 64 根
let peak = new Float32Array(BINS).fill(0); // 峰值小帽
let lastTS = performance.now(), frames = 0, fps = 60;

function draw() {
  const W = (canvas.width / DPR), H = (canvas.height / DPR), cx = W/2, cy = H/2;
  const radius = Math.min(W,H)*0.34;
  const ring = radius + 52;
  const data = new Uint8Array(analyser.frequencyBinCount);

  let prev = performance.now();
  (function loop(){
    rafId = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0,0,W,H);

    // FPS 偵測 → 低於 45 自動降級 bins（64 → 48）
    frames++; const now = performance.now();
    if (now - lastTS >= 1000) { fps = frames; frames = 0; lastTS = now; }
    const bins = (fps < 45) ? Math.min(BINS, 48) : BINS;
    if (peak.length !== bins) peak = new Float32Array(bins).fill(0);

    const step = Math.floor(data.length / bins);

    // —— 畫頻譜 + 峰值小帽，同時計算能量（用於閃電觸發） ——
    let energy = 0, hi = 0;
    for (let i=0; i<bins; i++){
      const v = data[i*step] / 255;     // 0~1
      energy += v;
      if (i > bins * 0.55) hi += v;     // 稍微偏重中高頻（打點）
      const bar = 24 + v * 160;         // 主柱高度
      const a = (i / bins) * Math.PI * 2;

      // 柱子
      const x1 = cx + Math.cos(a) * radius,      y1 = cy + Math.sin(a) * radius;
      const x2 = cx + Math.cos(a) * (radius+bar),y2 = cy + Math.sin(a) * (radius+bar);
      ctx.strokeStyle = `rgba(255,255,255,${0.28 + 0.58*v})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();

      // 峰值小帽（peak hold）
      peak[i] = Math.max(peak[i], bar);
      const px1 = cx + Math.cos(a) * (radius + peak[i]);
      const py1 = cy + Math.sin(a) * (radius + peak[i]);
      const px2 = cx + Math.cos(a) * (radius + peak[i] + 8);
      const py2 = cy + Math.sin(a) * (radius + peak[i] + 8);
      ctx.strokeStyle = "rgba(255,255,255,.75)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px1,py1); ctx.lineTo(px2,py2); ctx.stroke();
      peak[i] = Math.max(0, peak[i] - 0.9 - v*0.6); // 漸消
    }

    // —— 閃電觸發（瞬態偵測） ——
    const avg = energy / bins;
    emaEnergy = emaEnergy ? (emaEnergy * 0.9 + avg * 0.1) : avg;
    const impulse = (avg - emaEnergy) + (hi / bins) * 0.15; // 強度指標
    const threshold = 0.08;                                 // 觸發門檻
    const now2 = performance.now();
    if (impulse > threshold && (now2 - lastSpawnAt) > COOLDOWN) {
      lastSpawnAt = now2;
      const power = Math.min(1, impulse * 6);              // 0~1
      const n = 1 + Math.floor(2.5 * power);               // 一次 1~3 道
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const len = 70 + 220 * power + Math.random() * 50;
        spawnBolt(cx, cy, radius, len, a, power);
      }
    }

    // —— 進度圓弧 ——
    const d=audio.duration||0, ct=audio.currentTime||0, p=d>0?ct/d:0;
    const s=-Math.PI/2, e=s+p*Math.PI*2;

    // 背景圓弧
    ctx.strokeStyle="rgba(255,255,255,.18)";
    ctx.lineWidth=10;
    ctx.beginPath(); ctx.arc(cx,cy,ring,0,Math.PI*2); ctx.stroke();

    // 主題色（CSS 變數 --accent）
    const accent = getAccent();

    // 前景進度弧
    ctx.strokeStyle = accent;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx,cy,ring,s,e,false); ctx.stroke();

    // 動態光暈（跟平均音量膨脹）
    const glowR = ring + 16 + avg * 30;
    const g = ctx.createRadialGradient(cx,cy,ring, cx,cy, glowR);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `${accent}33`.replace('#','%23'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx,cy,glowR,0,Math.PI*2); ctx.fill();

    // —— 畫電弧（最後疊加） ——
    const nowFrame = performance.now();
    const dt = nowFrame - prev; prev = nowFrame;
    renderBolts(dt);
  })();
}

// 使用者互動後啟動（避免 Autoplay policy）
['click','keydown','pointerdown','touchstart'].forEach(ev =>
  window.addEventListener(ev, () => { ensureResumed(); }, { passive:true })
);

// 播放時開啟繪製
audio.addEventListener("play", () => {
  ensureResumed();
  cancelAnimationFrame(rafId);
  draw();
});
