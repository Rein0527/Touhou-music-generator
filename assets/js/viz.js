// 只負責視覺化（等化器 + 進度環顯示）；進度拖曳改由下方水平進度條處理
const audio = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");

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

function draw() {
  const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2;
  const radius = Math.min(W,H)*0.34;
  const ring = radius + 52;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const bins = 64;

  (function loop(){
    rafId = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0,0,W,H);

    const step = Math.floor(data.length/bins);
    for (let i=0;i<bins;i++){
      const v = data[i*step]/255;
      const bar = 24 + v*160;
      const a = (i/bins)*Math.PI*2;
      const x1=cx+Math.cos(a)*radius, y1=cy+Math.sin(a)*radius;
      const x2=cx+Math.cos(a)*(radius+bar), y2=cy+Math.sin(a)*(radius+bar);
      ctx.strokeStyle = `rgba(255,255,255,${0.3+0.55*v})`;
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }

    // 僅顯示弧形進度（視覺），實際拖曳在下方水平條
    const d=audio.duration||0, ct=audio.currentTime||0, p=d>0?ct/d:0;
    const s=-Math.PI/2, e=s+p*Math.PI*2;
    ctx.strokeStyle="rgba(255,255,255,.18)"; ctx.lineWidth=10;
    ctx.beginPath(); ctx.arc(cx,cy,ring,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle="#6da8ff"; ctx.lineCap="round";
    ctx.beginPath(); ctx.arc(cx,cy,ring,s,e,false); ctx.stroke();
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
