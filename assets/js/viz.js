// 視覺化（彩虹等化條 + 低頻加權 + 響應式光暈 + 圓弧進度）
// 只改畫面，不改實際音訊輸出
const audio = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");

// —— 可調參數 ——
// bins: 條數；bassBoost: 低頻加權強度；glowScale: 光暈強度；smoothing: 頻譜平滑
const CFG = {
  bins: 96,
  bassBoost: 1.6,          // 1.0 = 不加權；越大越打鼓
  glowScale: 90,           // 環狀光暈強度（依音量倍增）
  smoothing: 0.8,          // 0~1：越大越平滑
  barBase: 24,             // 條的基礎長度
  barGain: 170,            // 條的增益
  ringRadiusRatio: 0.34,   // 內圈半徑佔畫布邊長
  ringOffset: 52,          // 進度弧與等化條之間的距離
};

let audioCtx, analyser, sourceNode, rafId, data;

function ensureAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = CFG.smoothing;

    sourceNode = audioCtx.createMediaElementSource(audio);
    // 只接到 analyser，再接目的地（不插濾波器，保持原音）
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    data = new Uint8Array(analyser.frequencyBinCount);

    // 針對高 DPI，確保畫面銳利
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const logical = Math.min(78, Math.min(window.innerWidth, window.innerHeight) * 0.78);
    // 只要別動 index.html 的寬高屬性即可，這裡動實際像素
    canvas.width  = Math.floor(canvas.width  * dpr);
    canvas.height = Math.floor(canvas.height * dpr);
    ctx.scale(dpr, dpr);
  }
}

// 計算平均音量與低頻能量（0~1）
function computeLevels(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const avg = (sum / (arr.length * 255)) || 0;

  // 低頻：取前 1/6 區段做均值
  const lowEnd = Math.max(8, Math.floor(arr.length / 6));
  let bsum = 0;
  for (let i = 0; i < lowEnd; i++) bsum += arr[i];
  const bass = (bsum / (lowEnd * 255)) || 0;

  return { avg, bass };
}

function draw() {
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  const radius = Math.min(W, H) * CFG.ringRadiusRatio;
  const ring = radius + CFG.ringOffset;
  const bins = CFG.bins;

  (function loop(){
    rafId = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, W, H);

    // 取樣：把原始頻譜塞到指定的 bins
    const step = Math.floor(data.length / bins) || 1;
    const { avg, bass } = computeLevels(data);

    // —— 七彩漸層的等化條（依角度轉 HSL 色相） + 低頻加權 —— //
    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // 顏色相加，讓光感更漂亮
    for (let i = 0; i < bins; i++) {
      // 基礎值
      const v = data[i * step] / 255;

      // 低頻加權：靠近第 0 條權重較高；平方讓過渡更平滑
      const lowWeight = Math.pow(1 - i / bins, 2) * (CFG.bassBoost - 1) + 1;
      const boosted = Math.min(1, v * lowWeight);

      // 條長度
      const bar = CFG.barBase + boosted * CFG.barGain;

      // 角度與座標
      const a = (i / bins) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * radius, y1 = cy + Math.sin(a) * radius;
      const x2 = cx + Math.cos(a) * (radius + bar), y2 = cy + Math.sin(a) * (radius + bar);

      // 彩虹顏色：色相依角度 0~360；亮度隨音量浮動
      const hue = (i / bins) * 360;
      const light = 40 + boosted * 40; // 40%~80%
      const color = `hsl(${hue}, 100%, ${light}%)`;

      // 發光隨當下條的能量增強
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4 + boosted * 28;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // —— 環狀光暈（glow）：根據整體音量擴散 —— //
    // 用平均音量 + 少許低頻加權做亮度基礎
    const vol = Math.min(1, avg * 0.7 + bass * 0.6);
    const glow = 8 + vol * CFG.glowScale;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // 讀取 CSS 主題色（影響進度弧線與光暈色調）
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || "#6da8ff";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.shadowBlur = glow * 1.4;
    ctx.shadowColor = accent;

    // 畫一圈柔光（完整 360°）
    ctx.beginPath();
    ctx.arc(cx, cy, ring + 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // —— 圓弧進度（維持原設計，用主題色） —— //
    const d = audio.duration || 0, ct = audio.currentTime || 0, p = d > 0 ? (ct / d) : 0;
    const s = -Math.PI / 2, e = s + p * Math.PI * 2;

    // 背景弧
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(cx, cy, ring, 0, Math.PI * 2); ctx.stroke();

    // 進度弧（主題色）
    const accent2 = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || "#6da8ff";
    ctx.strokeStyle = accent2;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, ring, s, e, false); ctx.stroke();
  })();
}

// 使用者互動後啟動 AudioContext（避免 Autoplay policy）
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
  draw();
});
