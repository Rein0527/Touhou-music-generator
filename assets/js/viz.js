// 視覺化：AudioContext + Canvas
(function () {
  const canvas = document.getElementById("viz");
  const ctx = canvas.getContext("2d");
  let audio = document.getElementById("audio");

  let audioCtx = null, analyser = null, srcNode = null, rafId = 0;
  let interacted = false;

  function ensureGraph() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
    }
    if (audio && !srcNode) {
      srcNode = audioCtx.createMediaElementSource(audio);
      srcNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
  }

  async function resumeOnGesture() {
    ensureGraph();
    try { if (audioCtx.state === "suspended") await audioCtx.resume(); } catch {}
    interacted = true;
  }

  ["click", "keydown", "pointerdown", "touchstart"].forEach(ev => {
    window.addEventListener(ev, () => { if (!interacted) resumeOnGesture(); }, { passive: true });
  });

  function drawViz() {
    cancelAnimationFrame(rafId);
    if (!analyser) return;

    const W = canvas.width, H = canvas.height, cx = W/2, cy = H/2;
    const radius = Math.min(W,H)*0.34, progressOuter = radius+52, progressThick=10, freqBins=64;
    const data = new Uint8Array(analyser.frequencyBinCount);

    (function loop(){
      rafId = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(data); ctx.clearRect(0,0,W,H);

      // 等化器
      const step = Math.floor(data.length/freqBins);
      for (let i=0;i<freqBins;i++){
        const v = data[i*step]/255, bar=24+v*160, a=(i/freqBins)*Math.PI*2;
        const x1=cx+Math.cos(a)*radius, y1=cy+Math.sin(a)*radius, x2=cx+Math.cos(a)*(radius+bar), y2=cy+Math.sin(a)*(radius+bar);
        ctx.strokeStyle = `rgba(0,0,0,${0.15 + v*0.35})`;
        ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      }

      // 進度環
      const d=audio.duration||0, ct=audio.currentTime||0, p=d>0?ct/d:0;
      const startA=-Math.PI/2, endA=startA+p*Math.PI*2;

      ctx.strokeStyle="rgba(0,0,0,.12)"; ctx.lineWidth=progressThick;
      ctx.beginPath(); ctx.arc(cx,cy,progressOuter,0,Math.PI*2); ctx.stroke();

      const g=ctx.createLinearGradient(cx-progressOuter,cy-progressOuter,cx+progressOuter,cy+progressOuter);
      g.addColorStop(0,"#e8458b"); g.addColorStop(1,"#7aa8ff");
      ctx.strokeStyle=g; ctx.lineCap="round";
      ctx.beginPath(); ctx.arc(cx,cy,progressOuter,startA,endA,false); ctx.stroke();

      const hx=cx+Math.cos(endA)*progressOuter, hy=cy+Math.sin(endA)*progressOuter;
      ctx.fillStyle="rgba(0,0,0,.65)"; ctx.beginPath(); ctx.arc(hx,hy,5.5,0,Math.PI*2); ctx.fill();
    })();
  }

  function onPlay() { ensureGraph(); drawViz(); }

  function bindAudio(el){
    if (audio === el) return;
    audio = el;
    if (audioCtx) { try{ srcNode && srcNode.disconnect(); }catch{} srcNode=null; ensureGraph(); }
  }

  audio.addEventListener("play", onPlay);

  window.__viz = { resumeOnGesture, bindAudio };
})();
