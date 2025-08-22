const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const audio = document.getElementById("audio");

let audioCtx, analyser, sourceNode, rafId;

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

function startViz() {
  ensureAudioGraph();
  cancelAnimationFrame(rafId);
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  const radius = Math.min(W, H) * 0.34;
  const progressOuter = radius + 52;
  const freqBins = 64;
  const data = new Uint8Array(analyser.frequencyBinCount);

  (function loop() {
    rafId = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, W, H);

    // 等化器
    const step = Math.floor(data.length / freqBins);
    for (let i = 0; i < freqBins; i++) {
      const v = data[i * step] / 255;
      const bar = 24 + v * 160;
      const a = (i / freqBins) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * radius;
      const y1 = cy + Math.sin(a) * radius;
      const x2 = cx + Math.cos(a) * (radius + bar);
      const y2 = cy + Math.sin(a) * (radius + bar);
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + v * 0.55})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 進度環
    const d = audio.duration || 0, ct = audio.currentTime || 0, p = d > 0 ? ct / d : 0;
    const startAngle = -Math.PI / 2, endAngle = startAngle + p * Math.PI * 2;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, progressOuter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#6da8ff";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, progressOuter, startAngle, endAngle, false);
    ctx.stroke();
  })();
}

audio.addEventListener("play", () => {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  startViz();
});
